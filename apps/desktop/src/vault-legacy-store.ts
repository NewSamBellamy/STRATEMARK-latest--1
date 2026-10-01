/** Passive legacy history for offline migration. Never a runnable ResearchStore. */
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { inspectLegacySnapshot } from './snapshot-inspection';

export const legacyArrayFamilies = [
  'markets',
  'decks',
  'companies',
  'metrics',
  'cards',
  'viceClaims',
  'reports',
  'briefings',
  'savedCards',
  'researchJobs',
  'threads',
] as const;
export const legacyMapFamilies = ['dashboards', 'companyMarket', 'opportunity'] as const;
export const legacyFamilies = [...legacyArrayFamilies, ...legacyMapFamilies] as const;
export type LegacyFamily = (typeof legacyFamilies)[number];
const familySchema = z.enum(legacyFamilies);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const fieldOrderSchema = z
  .array(z.enum(['schemaVersion', ...legacyFamilies]))
  .max(15)
  .refine((fields) => new Set(fields).size === fields.length);
const pageSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
    afterOrdinal: z.number().int().min(-1).max(199_999).default(-1),
  })
  .strict();
const maxBytes = 50 * 1024 * 1024;
const maxPageBytes = 8 * 1024 * 1024;
const digest = (body: string) => createHash('sha256').update(body).digest('hex');
const table = (family: LegacyFamily) => `legacy_${family}`;
const isArrayFamily = (family: LegacyFamily) =>
  (legacyArrayFamilies as readonly string[]).includes(family);
const countSchema = z
  .object(
    Object.fromEntries(
      [...legacyFamilies, 'dashboardTabs'].map((family) => [
        family,
        z.number().int().min(0).max(200_000),
      ]),
    ),
  )
  .strict();
type Inspection = ReturnType<typeof inspectLegacySnapshot>;
const sourcePageSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
    afterSourceSha256: sha.optional(),
  })
  .strict();
const immutableTables = ['legacy_sources', ...legacyFamilies.map(table)];
const legacyTriggers = immutableTables.flatMap((name) =>
  ['update', 'delete'].map((operation) => ({
    name: `${name}_no_${operation}`,
    table: name,
    sql: `CREATE TRIGGER ${name}_no_${operation} BEFORE ${operation.toUpperCase()} ON ${name} BEGIN SELECT RAISE(ABORT,'Legacy history is append-only'); END`,
  })),
);
const normalizedSql = (sql: string) => sql.replace(/\s+/g, ' ').trim().replace(/;$/, '');

/** Detect missing/replaced guards, not authentication against a hostile local DB editor. */
export function assertLegacySchemaGuards(db: DatabaseSync) {
  const guards = new Map(
    db
      .prepare(
        "SELECT name,type,tbl_name,sql FROM sqlite_schema WHERE type='trigger' AND name LIKE 'legacy_%'",
      )
      .all()
      .map((row) => [row.name, row]),
  );
  for (const expected of legacyTriggers) {
    const row = guards.get(expected.name);
    if (
      row?.type !== 'trigger' ||
      row.tbl_name !== expected.table ||
      typeof row.sql !== 'string' ||
      normalizedSql(row.sql) !== normalizedSql(expected.sql)
    )
      throw new Error('Vault legacy immutability guard is missing or invalid.');
  }
}

// Deliberately separate from supported observations/claims and operational jobs.
// Native families own immutable individual rows, not a second whole-snapshot blob.
export const legacySchemaSql = `
CREATE TABLE legacy_sources (
  source_sha TEXT PRIMARY KEY CHECK(length(source_sha)=64),
  source_schema_version INTEGER NOT NULL CHECK(source_schema_version IN (1,2)),
  source_byte_length INTEGER NOT NULL CHECK(source_byte_length>0 AND source_byte_length<=${maxBytes}),
  field_order TEXT NOT NULL CHECK(json_valid(field_order) AND length(CAST(field_order AS BLOB))<=1024),
  content_sha TEXT NOT NULL CHECK(length(content_sha)=64),
  counts TEXT NOT NULL CHECK(json_valid(counts) AND length(CAST(counts AS BLOB))<=4096)
) STRICT;
${legacyFamilies
  .map(
    (family) => `CREATE TABLE ${table(family)} (
  source_sha TEXT NOT NULL REFERENCES legacy_sources(source_sha),
  ordinal INTEGER NOT NULL CHECK(ordinal>=0 AND ordinal<200000),
  record_key TEXT NOT NULL,
  body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=${maxBytes}),
  body_sha TEXT NOT NULL CHECK(length(body_sha)=64),
  PRIMARY KEY(source_sha,ordinal), UNIQUE(source_sha,record_key)
) STRICT;`,
  )
  .join('\n')}
${legacyTriggers.map((trigger) => `${trigger.sql};`).join('\n')}
`;

export const legacySchemaColumns = {
  legacy_sources: [
    'source_sha',
    'source_schema_version',
    'source_byte_length',
    'field_order',
    'content_sha',
    'counts',
  ],
  ...Object.fromEntries(
    legacyFamilies.map((family) => [
      table(family),
      ['source_sha', 'ordinal', 'record_key', 'body', 'body_sha'],
    ]),
  ),
};

function recordKey(family: LegacyFamily, value: unknown, mapKey?: string): string {
  if (!isArrayFamily(family)) return mapKey!;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Retained legacy record is invalid.');
  const field = family === 'savedCards' ? 'cardId' : 'id';
  const key = (value as Record<string, unknown>)[field];
  if (typeof key !== 'string') throw new Error('Retained legacy record identity is invalid.');
  return key;
}

/** Trusted internal staging only. No IPC/MCP, scheduling, grant or attestation API. */
export function createLegacyStore(
  db: DatabaseSync,
  assertOpen: () => void,
  readRevision: () => number,
  assertWrite: () => void,
) {
  function readTransaction<T>(read: (vaultRevision: number) => T): T {
    assertOpen();
    db.exec('BEGIN;');
    try {
      assertLegacySchemaGuards(db);
      const value = read(readRevision());
      db.exec('COMMIT;');
      return value;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK;');
      throw error;
    }
  }
  function source(sourceSha256: string) {
    sha.parse(sourceSha256);
    const row = db.prepare('SELECT * FROM legacy_sources WHERE source_sha=?').get(sourceSha256);
    if (!row) throw new Error('Retained legacy snapshot was not found.');
    try {
      if (
        typeof row.field_order !== 'string' ||
        Buffer.byteLength(row.field_order, 'utf8') > 1024 ||
        typeof row.counts !== 'string' ||
        Buffer.byteLength(row.counts, 'utf8') > 4096
      )
        throw new Error('Invalid retained source metadata length.');
      return {
        sourceSha256: sha.parse(row.source_sha),
        sourceSchemaVersion: z.union([z.literal(1), z.literal(2)]).parse(row.source_schema_version),
        sourceByteLength: z.number().int().positive().max(maxBytes).parse(row.source_byte_length),
        fields: fieldOrderSchema.parse(JSON.parse(String(row.field_order))),
        contentSha256: sha.parse(row.content_sha),
        counts: countSchema.parse(JSON.parse(String(row.counts))) as Inspection['counts'],
      };
    } catch {
      throw new Error('Retained legacy source metadata is invalid.');
    }
  }
  function decode(family: LegacyFamily, row: Record<string, unknown>) {
    const body = String(row.body);
    if (digest(body) !== row.body_sha) throw new Error('Retained legacy content checksum failed.');
    let payload: unknown;
    try {
      payload = JSON.parse(body) as unknown;
    } catch {
      throw new Error('Retained legacy content is invalid.');
    }
    if (recordKey(family, payload, String(row.record_key)) !== row.record_key)
      throw new Error('Retained legacy record identity does not match its index.');
    return {
      family,
      key: String(row.record_key),
      ordinal: Number(row.ordinal),
      payload,
      sourceSha256: String(row.source_sha),
      authority: 'disabled' as const,
    };
  }
  function reconstruct(sourceSha256: string) {
    assertLegacySchemaGuards(db);
    const manifest = source(sourceSha256);
    const fields: [string, unknown][] = [];
    const values = new Map<LegacyFamily, unknown>();
    let retainedBytes = 0;
    // Bound stored content before copying it into JS, including a damaged database.
    for (const family of legacyFamilies) {
      const size = db
        .prepare(
          `SELECT count(*) AS records,COALESCE(sum(length(CAST(body AS BLOB))),0) AS bytes FROM ${table(family)} WHERE source_sha=?`,
        )
        .get(sourceSha256)!;
      retainedBytes += Number(size.bytes);
      if (size.records !== manifest.counts[family] || retainedBytes > maxBytes)
        throw new Error('Retained legacy family count or byte limit does not match its manifest.');
    }
    for (const family of legacyFamilies) {
      const rows = db
        .prepare(`SELECT * FROM ${table(family)} WHERE source_sha=? ORDER BY ordinal`)
        .all(sourceSha256);
      if (rows.length > 200_000) throw new Error('Retained legacy record limit exceeded.');
      if (!manifest.fields.includes(family) && rows.length)
        throw new Error('Retained legacy family presence does not match its manifest.');
      const items = rows.map((row, ordinal) => {
        if (row.ordinal !== ordinal) throw new Error('Retained legacy record order is incomplete.');
        return decode(family, row);
      });
      values.set(
        family,
        isArrayFamily(family)
          ? items.map((item) => item.payload)
          : Object.fromEntries(items.map((item) => [item.key, item.payload])),
      );
    }
    for (const field of manifest.fields)
      fields.push([
        field,
        field === 'schemaVersion' ? manifest.sourceSchemaVersion : values.get(field),
      ]);
    const json = JSON.stringify(Object.fromEntries(fields));
    if (Buffer.byteLength(json, 'utf8') > maxBytes || digest(json) !== manifest.contentSha256)
      throw new Error('Retained legacy snapshot content checksum failed.');
    // Revalidate relationships and all nested historical content, not display schemas.
    const inspection = inspectLegacySnapshot(json);
    if (JSON.stringify(inspection.counts) !== JSON.stringify(manifest.counts))
      throw new Error('Retained legacy counts do not match their manifest.');
    return { manifest, inspection, json };
  }
  function receipt(inspection: Inspection, sourceSha256: string, vaultRevision: number) {
    return {
      sourceSha256,
      sourceSchemaVersion: inspection.source.schemaVersion,
      sourceByteLength: inspection.source.byteLength,
      retainedRecordCount: legacyFamilies.reduce(
        (sum, family) => sum + inspection.counts[family],
        0,
      ),
      authority: 'disabled' as const,
      vaultRevision,
      counts: inspection.counts,
      warnings: [...inspection.warnings],
    };
  }
  return {
    listLegacySnapshots(options: z.input<typeof sourcePageSchema> = {}) {
      const page = sourcePageSchema.parse(options);
      return readTransaction((vaultRevision) => {
        const rows = db
          .prepare(
            'SELECT source_sha FROM legacy_sources WHERE source_sha>? ORDER BY source_sha LIMIT ?',
          )
          .all(page.afterSourceSha256 ?? '', page.limit + 1);
        const items = rows.slice(0, page.limit).map((row) => {
          const manifest = source(String(row.source_sha));
          return {
            sourceSha256: manifest.sourceSha256,
            sourceSchemaVersion: manifest.sourceSchemaVersion,
            sourceByteLength: manifest.sourceByteLength,
            counts: manifest.counts,
            authority: 'disabled' as const,
            verification: 'not_checked' as const,
          };
        });
        return {
          items,
          nextCursor: rows.length > page.limit ? items.at(-1)!.sourceSha256 : null,
          vaultRevision,
        };
      });
    },
    retainLegacySnapshot(json: string, expectedVaultRevision: number) {
      assertWrite(); // Stale capabilities must fail before parsing untrusted input.
      assertLegacySchemaGuards(db);
      if (!Number.isSafeInteger(expectedVaultRevision) || expectedVaultRevision < 0)
        throw new Error('Expected vault revision is invalid.');
      const inspection = inspectLegacySnapshot(json);
      const raw = JSON.parse(json) as Record<string, unknown>;
      const sourceSha256 = inspection.source.sha256;
      db.exec('BEGIN IMMEDIATE;');
      try {
        assertWrite();
        const current = readRevision();
        if (db.prepare('SELECT 1 FROM legacy_sources WHERE source_sha=?').get(sourceSha256)) {
          const retained = reconstruct(sourceSha256);
          if (retained.manifest.sourceByteLength !== inspection.source.byteLength)
            throw new Error('Retained legacy source length does not match.');
          assertWrite();
          db.exec('COMMIT;');
          return receipt(inspection, sourceSha256, current);
        }
        if (current !== expectedVaultRevision)
          throw new Error('Vault revision conflict. Reload before retaining history.');
        db.prepare('INSERT INTO legacy_sources VALUES(?,?,?,?,?,?)').run(
          sourceSha256,
          inspection.source.schemaVersion,
          inspection.source.byteLength,
          JSON.stringify(Object.keys(raw)),
          digest(JSON.stringify(raw)),
          JSON.stringify(inspection.counts),
        );
        for (const family of legacyFamilies) {
          const value = raw[family];
          if (value === undefined) continue;
          const entries: [string, unknown][] = isArrayFamily(family)
            ? (value as unknown[]).map((row) => [recordKey(family, row), row])
            : Object.entries(value as Record<string, unknown>);
          const insert = db.prepare(`INSERT INTO ${table(family)} VALUES(?,?,?,?,?)`);
          for (const [ordinal, [key, payload]] of entries.entries()) {
            const body = JSON.stringify(payload);
            insert.run(sourceSha256, ordinal, key, body, digest(body));
          }
        }
        reconstruct(sourceSha256); // Full family/count/content/link validation before commit.
        assertWrite();
        db.exec('UPDATE vault_meta SET revision=revision+1 WHERE singleton=1;');
        const vaultRevision = readRevision();
        db.exec('COMMIT;');
        return receipt(inspection, sourceSha256, vaultRevision);
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK;');
        throw error;
      }
    },
    readLegacyRecords(
      sourceSha256: string,
      family: LegacyFamily,
      options: z.input<typeof pageSchema> = {},
    ) {
      familySchema.parse(family);
      const page = pageSchema.parse(options);
      return readTransaction((vaultRevision) => {
        source(sourceSha256);
        const size = db
          .prepare(
            `SELECT COALESCE(sum(length(CAST(body AS BLOB))),0) AS bytes FROM (SELECT body FROM ${table(family)} WHERE source_sha=? AND ordinal>? ORDER BY ordinal LIMIT ?)`,
          )
          .get(sourceSha256, page.afterOrdinal, page.limit)!;
        if (Number(size.bytes) > maxPageBytes)
          throw new Error(
            'Retained legacy record page exceeds its byte limit. Use a trusted export instead.',
          );
        const ids = db
          .prepare(
            `SELECT ordinal FROM ${table(family)} WHERE source_sha=? AND ordinal>? ORDER BY ordinal LIMIT ?`,
          )
          .all(sourceSha256, page.afterOrdinal, page.limit + 1);
        const rows = db
          .prepare(
            `SELECT * FROM ${table(family)} WHERE source_sha=? AND ordinal>? ORDER BY ordinal LIMIT ?`,
          )
          .all(sourceSha256, page.afterOrdinal, page.limit);
        const items = rows.map((row) => decode(family, row));
        return {
          items,
          nextOrdinal: ids.length > page.limit ? items.at(-1)!.ordinal : null,
          vaultRevision,
        };
      });
    },
    verifyLegacySnapshot(sourceSha256: string) {
      return readTransaction((vaultRevision) => {
        const { manifest, inspection } = reconstruct(sourceSha256);
        return {
          sourceSha256,
          sourceSchemaVersion: manifest.sourceSchemaVersion,
          sourceByteLength: manifest.sourceByteLength,
          counts: inspection.counts,
          authority: 'disabled' as const,
          canApply: false as const,
          vaultRevision,
          review: inspection.review,
          warnings: inspection.warnings,
          proposedAuthority: inspection.proposedAuthority,
        };
      });
    },
    exportLegacySnapshot(sourceSha256: string) {
      return readTransaction(() => reconstruct(sourceSha256).json);
    },
  };
}
