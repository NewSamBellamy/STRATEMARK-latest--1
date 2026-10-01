import type * as NodeSqlite from 'node:sqlite';
import { researchSchemaSql } from './vault-research-store';

export const currentVaultSchemaVersion = 5;

const identitySearchProjection = `
SELECT c.id,
  trim(COALESCE(json_extract(c.body,'$.name'),'') || ' ' || COALESCE((SELECT group_concat(value,' ') FROM json_each(c.body,'$.identityHints.aliases')),'')),
  trim(COALESCE(json_extract(c.body,'$.officialDomain'),'') || ' ' || COALESCE((SELECT group_concat(value,' ') FROM json_each(c.body,'$.identityHints.domains')),''))
FROM companies c`;
const identitySearchSchemaSql = `
CREATE VIRTUAL TABLE company_identity_search USING fts5(company_id UNINDEXED, aliases, domains);
INSERT INTO company_identity_search(company_id,aliases,domains) ${identitySearchProjection};
CREATE TABLE market_scope_seeds (
  kind TEXT NOT NULL CHECK(kind='market'), market_id TEXT NOT NULL, market_revision INTEGER NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal>=0 AND ordinal<50), company_id TEXT NOT NULL REFERENCES companies(id),
  FOREIGN KEY(kind,market_id,market_revision) REFERENCES retained_record_versions(kind,id,revision),
  PRIMARY KEY(market_id,market_revision,ordinal)
) STRICT;
INSERT INTO market_scope_seeds
SELECT 'market',h.id,h.revision,CAST(seed.key AS INTEGER),json_extract(seed.value,'$.companyId')
FROM record_history h, json_each(h.body,'$.scopeDraft.seeds') seed
WHERE h.kind='markets' AND json_extract(seed.value,'$.companyId') IS NOT NULL;
CREATE TRIGGER scope_seeds_no_update BEFORE UPDATE ON market_scope_seeds BEGIN SELECT RAISE(ABORT,'Scope seed history is append-only'); END;
CREATE TRIGGER scope_seeds_no_delete BEFORE DELETE ON market_scope_seeds BEGIN SELECT RAISE(ABORT,'Scope seed history is append-only'); END;
`;

export const inventorySchemaSql = `
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

const inventoryColumns = {
  vault_meta: ['singleton', 'vault_id', 'revision'],
  companies: ['id', 'revision', 'body'],
  markets: ['id', 'revision', 'body'],
  memberships: ['id', 'revision', 'body', 'company_id', 'market_id'],
  record_history: ['kind', 'id', 'revision', 'body'],
  company_search: ['company_id', 'name', 'official_domain'],
} as const;
const evidenceColumns = {
  source_versions: ['id', 'revision', 'body', 'content'],
  passages: ['id', 'revision', 'body', 'source_id', 'source_revision'],
  metric_definitions: ['id', 'revision', 'body'],
  observations: ['id', 'revision', 'body', 'company_id', 'definition_id', 'comparison_key'],
  observation_evidence: ['observation_id', 'ordinal', 'source_id', 'source_revision', 'passage_id'],
} as const;
const researchColumns = {
  retained_record_versions: ['kind', 'id', 'revision'],
  claims: ['id', 'revision', 'body', 'company_id', 'scope_kind', 'scope_id'],
  findings: ['id', 'revision', 'body', 'market_id'],
  reports: ['id', 'revision', 'body', 'scope_kind', 'scope_id'],
  research_evidence: [
    'kind',
    'id',
    'revision',
    'ordinal',
    'source_id',
    'source_revision',
    'passage_id',
  ],
  finding_companies: ['finding_id', 'finding_revision', 'ordinal', 'company_id'],
  report_inputs: [
    'report_id',
    'report_revision',
    'ordinal',
    'input_kind',
    'input_id',
    'input_revision',
  ],
} as const;

function readSchemaVersion(db: NodeSqlite.DatabaseSync) {
  const version = db.prepare('PRAGMA user_version').get()?.user_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version))
    throw new Error('Vault schema version is invalid.');
  if (version > currentVaultSchemaVersion)
    throw new Error('Vault schema is newer than this application supports.');
  return version;
}

function requireTables(db: NodeSqlite.DatabaseSync, tables: readonly string[], kind: string) {
  for (const name of tables) {
    const row = db.prepare('SELECT type FROM sqlite_schema WHERE name=?').get(name);
    if (row?.type !== 'table')
      throw new Error(`Vault schema is missing required ${kind} table: ${name}.`);
  }
}

function requireTableColumns(
  db: NodeSqlite.DatabaseSync,
  schema: Record<string, readonly string[]>,
  kind: string,
) {
  requireTables(db, Object.keys(schema), kind);
  for (const [table, required] of Object.entries(schema)) {
    const columns = new Set(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => row.name),
    );
    for (const name of required) {
      if (!columns.has(name))
        throw new Error(`Vault schema is missing required ${table} column: ${name}.`);
    }
  }
}

function requireInventorySchema(db: NodeSqlite.DatabaseSync) {
  requireTableColumns(db, inventoryColumns, 'inventory');
}

export function inspectVaultSchema(db: NodeSqlite.DatabaseSync, vaultId: string): number {
  const version = readSchemaVersion(db);
  if (version < 1 || version > currentVaultSchemaVersion)
    throw new Error('Unrecognized vault schema.');

  requireInventorySchema(db);
  const metadata = db.prepare('SELECT singleton, vault_id, revision FROM vault_meta').all();
  const meta = metadata[0];
  if (metadata.length !== 1 || !meta || meta.singleton !== 1 || meta.vault_id !== vaultId)
    throw new Error('Vault identity does not match.');
  const revision = meta.revision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
    throw new Error('Vault metadata revision is invalid.');

  if (version >= 2) requireTableColumns(db, evidenceColumns, 'evidence');
  if (version >= 3) {
    requireTableColumns(db, { writer_state: ['singleton', 'generation', 'owner_nonce'] }, 'owner');
    const rows = db.prepare('SELECT singleton,generation,owner_nonce FROM writer_state').all();
    const writer = rows[0];
    if (
      rows.length !== 1 ||
      writer?.singleton !== 1 ||
      typeof writer.generation !== 'number' ||
      !Number.isSafeInteger(writer.generation) ||
      writer.generation < 0 ||
      (writer.generation === 0
        ? writer.owner_nonce !== null
        : typeof writer.owner_nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(writer.owner_nonce))
    )
      throw new Error('Vault writer generation is invalid.');
  }
  if (version >= 4) requireTableColumns(db, researchColumns, 'research');
  if (version >= 5) {
    requireTableColumns(
      db,
      {
        company_identity_search: ['company_id', 'aliases', 'domains'],
        market_scope_seeds: ['kind', 'market_id', 'market_revision', 'ordinal', 'company_id'],
      },
      'inventory context',
    );
    // Read-only validation: refuse damaged projections, never silently repair data.
    const indexCount = db
      .prepare('SELECT count(*) AS count FROM company_identity_search')
      .get()?.count;
    const companyCount = db.prepare('SELECT count(*) AS count FROM companies').get()?.count;
    if (
      indexCount !== companyCount ||
      db
        .prepare(
          `SELECT 1 FROM (${identitySearchProjection} EXCEPT SELECT company_id,aliases,domains FROM company_identity_search) LIMIT 1`,
        )
        .get()
    )
      throw new Error('Company identity search index does not match retained records.');
  }
  if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
    throw new Error('Vault integrity check failed.');
  if (db.prepare('PRAGMA foreign_key_check').all().length !== 0)
    throw new Error('Vault foreign key check failed.');
  return version;
}

/** Caller starts BEGIN IMMEDIATE and owns the eventual commit or rollback. */
export function initializeVaultSchema(
  db: NodeSqlite.DatabaseSync,
  vaultId: string,
  allowCreate: boolean,
  evidenceSchemaSql: string,
): void {
  if (!db.isTransaction)
    throw new Error('Vault schema initialization requires an active transaction.');

  let version = readSchemaVersion(db);
  if (version === currentVaultSchemaVersion) {
    inspectVaultSchema(db, vaultId);
    return;
  }

  if (version >= 1) {
    inspectVaultSchema(db, vaultId);
  } else if (version === 0) {
    if (!allowCreate) throw new Error('Vault creation is not allowed.');
    const unrelated = db
      .prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1")
      .get();
    if (unrelated)
      throw new Error('Unrecognized version-zero database; refusing to adopt unrelated schema.');
    db.exec(inventorySchemaSql);
    db.prepare('INSERT INTO vault_meta VALUES(1,?,0)').run(vaultId);
    db.exec('PRAGMA user_version=1;');
    version = 1;
  } else {
    throw new Error('Unrecognized vault schema.');
  }

  if (version === 1) {
    db.exec(evidenceSchemaSql);
    requireTableColumns(db, evidenceColumns, 'evidence');
    db.exec('PRAGMA user_version=2;');
    version = 2;
  }
  if (version === 2) {
    db.exec(`CREATE TABLE writer_state (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    generation INTEGER NOT NULL CHECK(generation>=0 AND generation<=9007199254740991),
    owner_nonce TEXT
  ) STRICT; INSERT INTO writer_state VALUES(1,0,NULL);`);
    db.exec('PRAGMA user_version=3;');
    version = 3;
  }
  if (version === 3) {
    db.exec(researchSchemaSql);
    db.exec('PRAGMA user_version=4;');
    version = 4;
  }
  if (version === 4) {
    db.exec(identitySearchSchemaSql);
    db.exec('PRAGMA user_version=5;');
  }
  inspectVaultSchema(db, vaultId);
}
