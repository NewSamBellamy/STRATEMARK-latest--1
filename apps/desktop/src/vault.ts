/** Offline G01 inventory adapter. No renderer/connector access or live-data cutover. */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { SQLInputValue } from 'node:sqlite';
import type * as NodeSqlite from 'node:sqlite';
import { z } from 'zod';
import { compareRecordTimestamps, recordVersionSchema } from '@mi/contracts';

// Native resolution also avoids Vite5's obsolete builtin list. No third-party binding.
const { DatabaseSync, backup } = createRequire(process.execPath)(
  'node:sqlite',
) as typeof NodeSqlite;
const SCHEMA_VERSION = 1;
const label = z.string().trim().min(1).max(240);
const companySchema = z
  .object({
    record: recordVersionSchema,
    name: label,
    officialDomain: z
      .string()
      .max(253)
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/i)
      .nullable(),
  })
  .strict();
const marketSchema = z.object({ record: recordVersionSchema, name: label }).strict();
const membershipSchema = z
  .object({
    record: recordVersionSchema,
    marketId: z.string().min(1).max(128),
    companyId: z.string().min(1).max(128),
    roles: z
      .array(z.enum(['company', 'infrastructure', 'distribution']))
      .min(1)
      .max(3)
      .refine((roles) => new Set(roles).size === roles.length),
  })
  .strict();
export type VaultCompany = z.infer<typeof companySchema>;
export type VaultMarket = z.infer<typeof marketSchema>;
export type VaultMembership = z.infer<typeof membershipSchema>;
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

const SCHEMA = `
CREATE TABLE vault_meta (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  vault_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>=0 AND revision<=9007199254740991)
) STRICT;
CREATE TABLE companies (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), body TEXT NOT NULL CHECK(json_valid(body))
) STRICT;
CREATE TABLE markets (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), body TEXT NOT NULL CHECK(json_valid(body))
) STRICT;
CREATE TABLE memberships (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), body TEXT NOT NULL CHECK(json_valid(body)),
  company_id TEXT NOT NULL REFERENCES companies(id), market_id TEXT NOT NULL REFERENCES markets(id),
  UNIQUE(company_id, market_id)
) STRICT;
CREATE TABLE record_history (
  kind TEXT NOT NULL CHECK(kind IN ('companies','markets','memberships')),
  id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
  body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(kind,id,revision)
) STRICT;
CREATE TRIGGER history_no_update BEFORE UPDATE ON record_history BEGIN SELECT RAISE(ABORT,'History is append-only'); END;
CREATE TRIGGER history_no_delete BEFORE DELETE ON record_history BEGIN SELECT RAISE(ABORT,'History is append-only'); END;
CREATE VIRTUAL TABLE company_search USING fts5(company_id UNINDEXED, name, official_domain);
`;

/** Trusted local path and identity only. G01 owner lock must precede production use. */
export function openVault(file: string, vaultId: string) {
  if (!path.isAbsolute(file)) throw new Error('Vault path must be an absolute local path.');
  recordVersionSchema.innerType().shape.vaultId.parse(vaultId);
  const existed = existsSync(file);
  function inspect(db: InstanceType<typeof DatabaseSync>) {
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (typeof version !== 'number' || version > SCHEMA_VERSION)
      throw new Error('Vault schema was saved by a newer version.');
    if (version !== SCHEMA_VERSION)
      throw new Error('Unrecognized vault schema. Original data was not changed.');
    const meta = db.prepare('SELECT vault_id FROM vault_meta WHERE singleton=1').get();
    if (meta?.vault_id !== vaultId) throw new Error('Vault identity does not match.');
    if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
      throw new Error('Vault integrity check failed.');
    if (db.prepare('PRAGMA foreign_key_check').all().length !== 0)
      throw new Error('Vault foreign key check failed.');
  }
  // Inspect unsupported/mismatched files read-only, before journal/header changes.
  if (existed) {
    const reader = new DatabaseSync(file, { readOnly: true, allowExtension: false });
    try {
      inspect(reader);
    } finally {
      reader.close();
    }
  }
  const db = new DatabaseSync(file, {
    defensive: true,
    allowExtension: false,
    enableForeignKeyConstraints: true,
    timeout: 2000,
  });
  try {
    db.exec('PRAGMA trusted_schema=OFF; BEGIN IMMEDIATE;');
    if (existed) inspect(db);
    else {
      // Recheck after obtaining the SQLite write lock: another initializer may
      // have created the same file between our existence check and open.
      const version = db.prepare('PRAGMA user_version').get()?.user_version;
      if (version === SCHEMA_VERSION) inspect(db);
      else {
        const tables = db
          .prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")
          .get()?.count;
        if (version !== 0 || tables !== 0) throw new Error('Unrecognized vault schema.');
        db.exec(SCHEMA);
        db.prepare('INSERT INTO vault_meta VALUES(1,?,0)').run(vaultId);
        db.exec(`PRAGMA user_version=${SCHEMA_VERSION};`);
      }
    }
    db.exec('COMMIT; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK;');
    db.close();
    throw error;
  }
  let closed = false;
  function assertOpen() {
    if (closed) throw new Error('Vault is closed.');
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
    return value;
  }
  function save(table: Table, value: RecordData, expectedRevision: number) {
    assertOpen();
    if (value.record.vaultId !== vaultId) throw new Error('Record belongs to a different vault.');
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      value.record.revision !== expectedRevision + 1
    )
      throw new Error('Record revision must advance exactly once.');
    db.exec('BEGIN IMMEDIATE;');
    try {
      const previous = db
        .prepare(`SELECT id,revision,body FROM ${table} WHERE id=?`)
        .get(value.record.id);
      if ((previous?.revision ?? 0) !== expectedRevision)
        throw new Error('Record revision conflict. Reload before saving.');
      if (previous) {
        const old =
          table === 'companies'
            ? decode(previous, companySchema)!
            : table === 'markets'
              ? decode(previous, marketSchema)!
              : decode(previous, membershipSchema)!;
        if (old.record.createdAt !== value.record.createdAt)
          throw new Error('Record creation time is immutable.');
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
      if (table === 'companies') {
        const company = value as VaultCompany;
        db.prepare('DELETE FROM company_search WHERE company_id=?').run(company.record.id);
        db.prepare('INSERT INTO company_search(company_id,name,official_domain) VALUES(?,?,?)').run(
          company.record.id,
          company.name,
          company.officialDomain,
        );
      }
      db.exec('UPDATE vault_meta SET revision=revision+1 WHERE singleton=1; COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }
  function readCompany(id: string) {
    assertOpen();
    return decode(
      db.prepare('SELECT id,revision,body FROM companies WHERE id=?').get(id),
      companySchema,
    );
  }
  function readRevision() {
    const revision = db
      .prepare('SELECT revision FROM vault_meta WHERE singleton=1')
      .get()?.revision;
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
      throw new Error('Invalid vault revision.');
    return revision;
  }
  function companyPage(sql: string, parameters: SQLInputValue[], limit: number) {
    assertOpen();
    // Revision and records must describe one SQLite read snapshot, even if a
    // separate process commits while a page is being read.
    db.exec('BEGIN;');
    try {
      const vaultRevision = readRevision();
      const rows = db.prepare(sql).all(...parameters, limit + 1);
      const items = rows.slice(0, limit).map((row) => decode(row, companySchema)!);
      const nextCursor = rows.length > limit ? items.at(-1)!.record.id : null;
      db.exec('COMMIT;');
      return { items, nextCursor, vaultRevision };
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }
  return {
    status() {
      assertOpen();
      return { vaultId, schemaVersion: SCHEMA_VERSION, revision: readRevision() };
    },
    saveCompany(value: VaultCompany, expectedRevision: number) {
      save('companies', companySchema.parse(value), expectedRevision);
    },
    saveMarket(value: VaultMarket, expectedRevision: number) {
      save('markets', marketSchema.parse(value), expectedRevision);
    },
    saveMembership(value: VaultMembership, expectedRevision: number) {
      save('memberships', membershipSchema.parse(value), expectedRevision);
    },
    getCompany: readCompany,
    listMarketCompanies(marketId: string, options: z.input<typeof pageOptions> = {}) {
      assertOpen();
      const page = pageOptions.parse(options);
      return companyPage(
        'SELECT c.id,c.revision,c.body FROM companies c JOIN memberships m ON m.company_id=c.id WHERE m.market_id=? AND c.id>? ORDER BY c.id LIMIT ?',
        [marketId, page.afterId ?? ''],
        page.limit,
      );
    },
    searchCompanies(query: string, options: z.input<typeof pageOptions> = {}) {
      assertOpen();
      const page = pageOptions.parse(options);
      if (query.length > 500) throw new Error('Search must be at most 500 characters.');
      const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
      if (terms.length > 16) throw new Error('Search must have at most 16 terms.');
      if (!terms.length)
        return companyPage(
          `SELECT id,revision,body FROM companies WHERE id>? ${query.trim() ? 'AND 0=1' : ''} ORDER BY id LIMIT ?`,
          [page.afterId ?? ''],
          page.limit,
        );
      const literal = terms.map((term) => `"${term}"`).join(' AND ');
      return companyPage(
        'SELECT c.id,c.revision,c.body FROM company_search s JOIN companies c ON c.id=s.company_id WHERE company_search MATCH ? AND c.id>? ORDER BY c.id LIMIT ?',
        [literal, page.afterId ?? ''],
        page.limit,
      );
    },
    companyHistory(id: string, options: z.input<typeof historyOptions> = {}) {
      assertOpen();
      const page = historyOptions.parse(options);
      db.exec('BEGIN;');
      try {
        const vaultRevision = readRevision();
        const rows = db
          .prepare(
            "SELECT id,revision,body FROM record_history WHERE kind='companies' AND id=? AND revision>? ORDER BY revision LIMIT ?",
          )
          .all(id, page.afterRevision, page.limit + 1);
        const items = rows.slice(0, page.limit).map((row) => decode(row, companySchema)!);
        const nextRevision = rows.length > page.limit ? items.at(-1)!.record.revision : null;
        db.exec('COMMIT;');
        return { items, nextRevision, vaultRevision };
      } catch (error) {
        db.exec('ROLLBACK;');
        throw error;
      }
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
      }
    },
  };
}
