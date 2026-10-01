/** Offline G01 inventory adapter. No renderer/connector access or live-data cutover. */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { SQLInputValue } from 'node:sqlite';
import type * as NodeSqlite from 'node:sqlite';
import { z } from 'zod';
import {
  compareRecordTimestamps,
  recordVersionSchema,
  vaultCompanySchema as companySchema,
  vaultMarketSchema as marketSchema,
  vaultMembershipSchema as membershipSchema,
  type VaultCompany,
  type VaultMarket,
  type VaultMembership,
} from '@mi/contracts';
import { createEvidenceStore, evidenceSchemaSql } from './vault-evidence-store';
import { createResearchStore } from './vault-research-store';
import { acquireVaultOwner, canonicalVaultPath, vaultFileFence } from './vault-owner';
import {
  currentVaultSchemaVersion,
  initializeVaultSchema,
  inspectVaultSchema,
} from './vault-schema';

// Native resolution also avoids Vite5's obsolete builtin list. No third-party binding.
const { DatabaseSync, backup } = createRequire(process.execPath)(
  'node:sqlite',
) as typeof NodeSqlite;
export type { VaultCompany, VaultMarket, VaultMembership } from '@mi/contracts';
type RecordData = VaultCompany | VaultMarket | VaultMembership;
type Table = 'companies' | 'markets' | 'memberships';
const pageOptions = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
    afterId: recordVersionSchema.innerType().shape.id.optional(),
  })
  .strict();
const historyOptions = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
    afterRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  })
  .strict();

/** Internal owner or read-only handle. Never expose writers or paths directly to a connector. */
export function openVault(file: string, vaultId: string, mode: 'owner' | 'reader' = 'owner') {
  if (mode !== 'owner' && mode !== 'reader') throw new Error('Invalid vault mode.');
  file = canonicalVaultPath(file);
  recordVersionSchema.innerType().shape.vaultId.parse(vaultId);
  const existed = existsSync(file);
  if (!existed && mode === 'reader') throw new Error('Read-only vault must already exist.');
  // Inspect unsupported/mismatched files read-only, before journal/header changes.
  if (existed) {
    const reader = new DatabaseSync(file, { readOnly: true, allowExtension: false });
    try {
      const version = inspectVaultSchema(reader, vaultId);
      if (mode === 'reader' && version !== currentVaultSchemaVersion)
        throw new Error('Read-only vault needs an explicit owner-side schema upgrade.');
    } finally {
      reader.close();
    }
  }
  const owner = mode === 'owner' ? acquireVaultOwner(file) : null;
  let db: InstanceType<typeof DatabaseSync>;
  try {
    db = new DatabaseSync(file, {
      readOnly: mode === 'reader',
      defensive: true,
      allowExtension: false,
      enableForeignKeyConstraints: true,
      timeout: 2000,
    });
  } catch (error) {
    owner?.close();
    throw error;
  }
  let state: { generation: number; nonce: string } | null = null;
  function advanceGeneration() {
    const previous = db
      .prepare('SELECT generation FROM writer_state WHERE singleton=1')
      .get()?.generation;
    if (
      typeof previous !== 'number' ||
      !Number.isSafeInteger(previous) ||
      previous >= Number.MAX_SAFE_INTEGER
    )
      throw new Error('Vault writer generation cannot advance.');
    const next = { generation: previous + 1, nonce: randomUUID() };
    db.prepare('UPDATE writer_state SET generation=?,owner_nonce=? WHERE singleton=1').run(
      next.generation,
      next.nonce,
    );
    return next;
  }
  let assertFile: () => void;
  try {
    db.exec('PRAGMA trusted_schema=OFF;');
    if (owner) {
      db.exec('BEGIN IMMEDIATE;');
      owner.assertOwned();
      initializeVaultSchema(db, vaultId, !existed, evidenceSchemaSql);
      state = advanceGeneration();
      db.exec('COMMIT; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    } else inspectVaultSchema(db, vaultId);
    assertFile = vaultFileFence(file);
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK;');
    db.close();
    owner?.close();
    throw error;
  }
  let closed = false;
  let ownershipLost = false;
  function assertOpen() {
    if (closed) throw new Error('Vault is closed.');
  }
  function assertWriter(captured = state) {
    assertOpen();
    if (!owner) throw new Error('Vault is read-only.');
    if (ownershipLost || !captured || captured !== state)
      throw new Error('Vault writer generation is fenced.');
    try {
      owner.assertOwned();
      assertFile();
    } catch (error) {
      ownershipLost = true;
      throw error;
    }
    const current = db
      .prepare('SELECT generation,owner_nonce FROM writer_state WHERE singleton=1')
      .get();
    if (current?.generation !== captured.generation || current.owner_nonce !== captured.nonce) {
      ownershipLost = true;
      throw new Error('Vault writer generation is fenced.');
    }
  }
  function decode<T extends RecordData>(
    row: Record<string, unknown> | undefined,
    schema: z.ZodType<T>,
  ): T | null {
    if (!row) return null;
    const value = schema.parse(JSON.parse(String(row.body)));
    if (value.record.id !== row.id)
      throw new Error('Stored record identity does not match its indexed ID.');
    if (value.record.vaultId !== vaultId || value.record.revision !== row.revision)
      throw new Error('Stored record version does not match its vault.');
    if ((schema as z.ZodTypeAny) === marketSchema) {
      const expected =
        (value as VaultMarket).scopeDraft?.seeds.flatMap((seed, ordinal) =>
          seed.companyId ? [{ ordinal, company_id: seed.companyId }] : [],
        ) ?? [];
      const indexed = db
        .prepare(
          'SELECT ordinal,company_id FROM market_scope_seeds WHERE market_id=? AND market_revision=? ORDER BY ordinal',
        )
        .all(value.record.id, value.record.revision);
      if (JSON.stringify(indexed) !== JSON.stringify(expected))
        throw new Error('Stored scope seed links do not match their historical index.');
    }
    return value;
  }
  function save(
    table: Table,
    value: RecordData,
    expectedRevision: number,
    assertWrite: () => void,
  ) {
    assertWrite();
    if (value.record.vaultId !== vaultId) throw new Error('Record belongs to a different vault.');
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      value.record.revision !== expectedRevision + 1
    )
      throw new Error('Record revision must advance exactly once.');
    db.exec('BEGIN IMMEDIATE;');
    try {
      assertWrite();
      const previous = db
        .prepare(`SELECT id,revision,body FROM ${table} WHERE id=?`)
        .get(value.record.id);
      if ((previous?.revision ?? 0) !== expectedRevision)
        throw new Error('Record revision conflict. Reload before saving.');
      if (table === 'markets') {
        for (const seed of (value as VaultMarket).scopeDraft?.seeds ?? [])
          if (
            seed.companyId &&
            !db.prepare('SELECT 1 FROM companies WHERE id=?').get(seed.companyId)
          )
            throw new Error('Market scope seed references a missing company.');
      }
      if (previous) {
        const old =
          table === 'companies'
            ? decode(previous, companySchema)!
            : table === 'markets'
              ? decode(previous, marketSchema)!
              : decode(previous, membershipSchema)!;
        if (old.record.createdAt !== value.record.createdAt)
          throw new Error('Record creation time is immutable.');
        // These are complete replacements, not patches. Require callers to carry
        // retained context forward; clearing hints is an explicit empty array.
        for (const field of ['profile', 'identityHints', 'scopeDraft', 'legacyScope'])
          if (field in old && !(field in value))
            throw new Error('Replacement save must retain existing inventory context.');
        if (compareRecordTimestamps(old.record.updatedAt, value.record.updatedAt) > 0)
          throw new Error('Record update time must not move backwards.');
        if (
          table === 'memberships' &&
          'companyId' in old &&
          'companyId' in value &&
          (old.companyId !== value.companyId || old.marketId !== value.marketId)
        )
          throw new Error('Membership endpoints are immutable.');
      }
      const body = JSON.stringify(value);
      if (table === 'memberships') {
        const membership = value as VaultMembership;
        db.prepare(
          'INSERT INTO memberships(id,revision,body,company_id,market_id) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body',
        ).run(
          value.record.id,
          value.record.revision,
          body,
          membership.companyId,
          membership.marketId,
        );
      } else
        db.prepare(
          `INSERT INTO ${table}(id,revision,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body`,
        ).run(value.record.id, value.record.revision, body);
      db.prepare('INSERT INTO record_history VALUES(?,?,?,?)').run(
        table,
        value.record.id,
        value.record.revision,
        body,
      );
      if (table === 'markets') {
        const seeds = (value as VaultMarket).scopeDraft?.seeds ?? [];
        for (const [ordinal, seed] of seeds.entries())
          if (seed.companyId)
            db.prepare("INSERT INTO market_scope_seeds VALUES('market',?,?,?,?)").run(
              value.record.id,
              value.record.revision,
              ordinal,
              seed.companyId,
            );
      }
      if (table === 'companies') {
        const company = value as VaultCompany;
        db.prepare('DELETE FROM company_search WHERE company_id=?').run(company.record.id);
        db.prepare('INSERT INTO company_search(company_id,name,official_domain) VALUES(?,?,?)').run(
          company.record.id,
          company.name,
          company.officialDomain,
        );
        db.prepare('DELETE FROM company_identity_search WHERE company_id=?').run(company.record.id);
        db.prepare(
          'INSERT INTO company_identity_search(company_id,aliases,domains) VALUES(?,?,?)',
        ).run(
          company.record.id,
          [company.name, ...(company.identityHints?.aliases ?? [])].join(' ').trim(),
          [company.officialDomain ?? '', ...(company.identityHints?.domains ?? [])]
            .join(' ')
            .trim(),
        );
      }
      assertWrite();
      db.exec('UPDATE vault_meta SET revision=revision+1 WHERE singleton=1; COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }
  function readRecord<T extends RecordData>(table: Table, schema: z.ZodType<T>, id: string) {
    assertOpen();
    recordVersionSchema.innerType().shape.id.parse(id);
    return decode(db.prepare(`SELECT id,revision,body FROM ${table} WHERE id=?`).get(id), schema);
  }
  function readRevision() {
    const revision = db
      .prepare('SELECT revision FROM vault_meta WHERE singleton=1')
      .get()?.revision;
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
      throw new Error('Invalid vault revision.');
    return revision;
  }
  function recordPage<T extends RecordData>(
    sql: string,
    parameters: SQLInputValue[],
    limit: number,
    schema: z.ZodType<T>,
  ) {
    assertOpen();
    // Revision and records must describe one SQLite read snapshot, even if a
    // separate process commits while a page is being read.
    db.exec('BEGIN;');
    try {
      const vaultRevision = readRevision();
      const rows = db.prepare(sql).all(...parameters, limit + 1);
      const items = rows.slice(0, limit).map((row) => decode(row, schema)!);
      const nextCursor = rows.length > limit ? items.at(-1)!.record.id : null;
      db.exec('COMMIT;');
      return { items, nextCursor, vaultRevision };
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }
  function history<T extends RecordData>(
    table: Table,
    schema: z.ZodType<T>,
    id: string,
    options: z.input<typeof historyOptions> = {},
  ) {
    assertOpen();
    recordVersionSchema.innerType().shape.id.parse(id);
    const page = historyOptions.parse(options);
    db.exec('BEGIN;');
    try {
      const vaultRevision = readRevision();
      const rows = db
        .prepare(
          'SELECT id,revision,body FROM record_history WHERE kind=? AND id=? AND revision>? ORDER BY revision LIMIT ?',
        )
        .all(table, id, page.afterRevision, page.limit + 1);
      const items = rows.slice(0, page.limit).map((row) => decode(row, schema)!);
      const nextRevision = rows.length > page.limit ? items.at(-1)!.record.revision : null;
      db.exec('COMMIT;');
      return { items, nextRevision, vaultRevision };
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }
  const noWrite = () => {
    throw new Error('Read handle cannot write without a captured owner capability.');
  };
  const evidence = createEvidenceStore(db, vaultId, assertOpen, readRevision, noWrite);
  const research = createResearchStore(db, vaultId, assertOpen, readRevision, noWrite, evidence);
  return {
    getSourceVersion: evidence.getSourceVersion,
    getPassage: evidence.getPassage,
    getObservation: evidence.getObservation,
    getMetricDefinition: evidence.getMetricDefinition,
    listObservations: evidence.listObservations,
    comparableObservations: evidence.comparableObservations,
    getClaim: research.getClaim,
    getFinding: research.getFinding,
    getReport: research.getReport,
    listClaims: research.listClaims,
    listFindings: research.listFindings,
    listReports: research.listReports,
    status() {
      assertOpen();
      return {
        vaultId,
        schemaVersion: currentVaultSchemaVersion,
        revision: readRevision(),
        mode,
        writerGeneration: db.prepare('SELECT generation FROM writer_state WHERE singleton=1').get()
          ?.generation,
      };
    },
    writer() {
      assertWriter();
      const captured = state;
      const check = () => assertWriter(captured);
      const writes = createEvidenceStore(db, vaultId, assertOpen, readRevision, check);
      const researchWrites = createResearchStore(
        db,
        vaultId,
        assertOpen,
        readRevision,
        check,
        evidence,
      );
      return {
        saveCompany(value: VaultCompany, expectedRevision: number) {
          check();
          save('companies', companySchema.parse(value), expectedRevision, check);
        },
        saveMarket(value: VaultMarket, expectedRevision: number) {
          check();
          save('markets', marketSchema.parse(value), expectedRevision, check);
        },
        saveMembership(value: VaultMembership, expectedRevision: number) {
          check();
          save('memberships', membershipSchema.parse(value), expectedRevision, check);
        },
        saveSourceVersion: writes.saveSourceVersion,
        savePassage: writes.savePassage,
        saveMetricDefinition: writes.saveMetricDefinition,
        saveObservation: writes.saveObservation,
        saveClaim: researchWrites.saveClaim,
        saveFinding: researchWrites.saveFinding,
        saveReport: researchWrites.saveReport,
      };
    },
    advanceWriterGeneration() {
      assertWriter();
      db.exec('BEGIN IMMEDIATE;');
      try {
        assertWriter();
        const next = advanceGeneration();
        db.exec('COMMIT;');
        state = next;
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK;');
        throw error;
      }
      return state.generation;
    },
    getCompany: (id: string) => readRecord('companies', companySchema, id),
    getMarket: (id: string) => readRecord('markets', marketSchema, id),
    getMembership: (id: string) => readRecord('memberships', membershipSchema, id),
    listMarkets(options: z.input<typeof pageOptions> = {}) {
      const page = pageOptions.parse(options);
      return recordPage(
        'SELECT id,revision,body FROM markets WHERE id>? ORDER BY id LIMIT ?',
        [page.afterId ?? ''],
        page.limit,
        marketSchema,
      );
    },
    listMarketCompanies(marketId: string, options: z.input<typeof pageOptions> = {}) {
      assertOpen();
      const page = pageOptions.parse(options);
      return recordPage(
        'SELECT c.id,c.revision,c.body FROM companies c JOIN memberships m ON m.company_id=c.id WHERE m.market_id=? AND c.id>? ORDER BY c.id LIMIT ?',
        [marketId, page.afterId ?? ''],
        page.limit,
        companySchema,
      );
    },
    searchCompanies(query: string, options: z.input<typeof pageOptions> = {}) {
      assertOpen();
      const page = pageOptions.parse(options);
      if (query.length > 500) throw new Error('Search must be at most 500 characters.');
      const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
      if (terms.length > 16) throw new Error('Search must have at most 16 terms.');
      if (!terms.length)
        return recordPage(
          `SELECT id,revision,body FROM companies WHERE id>? ${query.trim() ? 'AND 0=1' : ''} ORDER BY id LIMIT ?`,
          [page.afterId ?? ''],
          page.limit,
          companySchema,
        );
      const literal = terms.map((term) => `"${term}"`).join(' AND ');
      return recordPage(
        'SELECT c.id,c.revision,c.body FROM companies c WHERE c.id IN (SELECT company_id FROM company_search WHERE company_search MATCH ? UNION SELECT company_id FROM company_identity_search WHERE company_identity_search MATCH ?) AND c.id>? ORDER BY c.id LIMIT ?',
        [literal, literal, page.afterId ?? ''],
        page.limit,
        companySchema,
      );
    },
    companyHistory(id: string, options: z.input<typeof historyOptions> = {}) {
      return history('companies', companySchema, id, options);
    },
    marketHistory(id: string, options: z.input<typeof historyOptions> = {}) {
      return history('markets', marketSchema, id, options);
    },
    membershipHistory(id: string, options: z.input<typeof historyOptions> = {}) {
      return history('memberships', membershipSchema, id, options);
    },
    integrity() {
      assertOpen();
      return String(db.prepare('PRAGMA integrity_check').get()?.integrity_check);
    },
    async backup(destination: string) {
      assertOpen();
      if (
        !path.isAbsolute(destination) ||
        path.resolve(destination).toLowerCase() === path.resolve(file).toLowerCase() ||
        existsSync(destination)
      )
        throw new Error('Backup must use a new absolute local destination.');
      await backup(db, destination);
    },
    close() {
      if (!closed) {
        db.close();
        closed = true;
        owner?.close();
      }
    },
  };
}
