import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import type * as NodeSqlite from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evidenceSchemaSql } from './vault-evidence-store';
import { researchSchemaSql } from './vault-research-store';
import { legacyFamilies, createLegacyStore } from './vault-legacy-store';
import { legacyRetentionFixture } from './legacy-retention-fixture';
import { openVault } from './vault';
import {
  currentVaultSchemaVersion,
  initializeVaultSchema,
  inspectVaultSchema,
  inventorySchemaSql,
} from './vault-schema';

// Vite5 predates node:sqlite's builtin list; resolve through native Node, not Vite.
const { DatabaseSync } = createRequire(process.execPath)('node:sqlite') as typeof NodeSqlite;
const vaultId = 'fixture_vault';

const directories: string[] = [];
const handles = new Set<NodeSqlite.DatabaseSync>();

function location() {
  const directory = mkdtempSync(path.join(tmpdir(), 'stratemark-schema-test-'));
  directories.push(directory);
  return path.join(directory, 'vault.sqlite');
}

function openDatabase(file: string, enableForeignKeyConstraints = true) {
  const db = new DatabaseSync(file, { enableForeignKeyConstraints });
  handles.add(db);
  return db;
}

function closeDatabase(db: NodeSqlite.DatabaseSync) {
  handles.delete(db);
  db.close();
}

function createVersionOne(file: string, id = vaultId) {
  const db = openDatabase(file);
  db.exec('BEGIN IMMEDIATE;');
  db.exec(inventorySchemaSql);
  db.prepare('INSERT INTO vault_meta VALUES(1,?,?)').run(id, 17);
  db.prepare('INSERT INTO companies VALUES(?,?,?)').run(
    'fixture_company',
    2,
    '{"fixture":"company-v1"}',
  );
  db.prepare('INSERT INTO markets VALUES(?,?,?)').run(
    'fixture_market',
    3,
    '{"fixture":"market-v1"}',
  );
  db.prepare('INSERT INTO memberships VALUES(?,?,?,?,?)').run(
    'fixture_membership',
    4,
    '{"fixture":"membership-v1"}',
    'fixture_company',
    'fixture_market',
  );
  db.prepare('INSERT INTO record_history VALUES(?,?,?,?)').run(
    'companies',
    'fixture_company',
    2,
    '{"fixture":"history-v1"}',
  );
  db.prepare('INSERT INTO company_search VALUES(?,?,?)').run(
    'fixture_company',
    'Fixture Company',
    'fixture.example',
  );
  db.exec('PRAGMA user_version=1; COMMIT;');
  closeDatabase(db);
}

function createCurrent(file: string, id = vaultId) {
  const db = openDatabase(file);
  db.exec('BEGIN IMMEDIATE;');
  initializeVaultSchema(db, id, true, evidenceSchemaSql);
  db.exec('COMMIT;');
  closeDatabase(db);
}
function createVersionTwo(file: string) {
  createVersionOne(file);
  const db = openDatabase(file);
  db.exec(`BEGIN IMMEDIATE; ${evidenceSchemaSql} PRAGMA user_version=2; COMMIT;`);
  closeDatabase(db);
}
function createVersionThree(file: string) {
  createVersionTwo(file);
  const db = openDatabase(file);
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE writer_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),generation INTEGER NOT NULL CHECK(generation>=0 AND generation<=9007199254740991),owner_nonce TEXT) STRICT;
    INSERT INTO writer_state VALUES(1,7,'00000000-0000-0000-0000-000000000007');
    PRAGMA user_version=3; COMMIT;`);
  closeDatabase(db);
}
function createVersionFour(file: string) {
  createVersionThree(file);
  const db = openDatabase(file);
  db.exec(`BEGIN IMMEDIATE; ${researchSchemaSql} PRAGMA user_version=4; COMMIT;`);
  closeDatabase(db);
}
function createVersionSix(file: string) {
  createCurrent(file);
  const db = openDatabase(file);
  db.exec(
    'BEGIN IMMEDIATE; DROP TABLE work_saved_cards; DROP TABLE work_cards; DROP TABLE work_events; DROP TABLE work_runs; DROP TABLE work_decks; DROP TABLE work_markets; PRAGMA user_version=6; COMMIT;',
  );
  closeDatabase(db);
}
function createVersionFive(file: string) {
  createVersionSix(file);
  const db = openDatabase(file);
  db.exec('BEGIN IMMEDIATE;');
  for (const family of legacyFamilies) db.exec(`DROP TABLE legacy_${family};`);
  db.exec('DROP TABLE legacy_sources; PRAGMA user_version=5; COMMIT;');
  closeDatabase(db);
}

function expectInspectionRefusal(file: string, requestedId: string, message: RegExp) {
  const before = readFileSync(file);
  const db = openDatabase(file);
  expect(() => inspectVaultSchema(db, requestedId)).toThrow(message);
  closeDatabase(db);
  expect(readFileSync(file)).toEqual(before);
}

afterEach(() => {
  for (const db of handles) {
    if (db.isTransaction) db.exec('ROLLBACK;');
    closeDatabase(db);
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe('offline vault schema migrations', () => {
  it('upgrades version 7 for bookmarks without changing retained research or vault revision', () => {
    const file = location();
    createCurrent(file);
    const old = openDatabase(file);
    old.exec('DROP TABLE IF EXISTS work_saved_cards; PRAGMA user_version=7;');
    const before = old.prepare('SELECT * FROM vault_meta').all();
    closeDatabase(old);
    const bytes = readFileSync(file);
    expect(() => {
      const unexpected = openVault(file, vaultId, 'reader');
      unexpected.close();
    }).toThrow(/owner-side schema upgrade/i);
    expect(readFileSync(file)).toEqual(bytes);
    const upgraded = openDatabase(file);
    upgraded.exec('BEGIN IMMEDIATE;');
    initializeVaultSchema(upgraded, vaultId, false, 'DO NOT RUN OLD EVIDENCE DDL');
    expect(inspectVaultSchema(upgraded, vaultId)).toBe(8);
    expect(upgraded.prepare('SELECT * FROM vault_meta').all()).toEqual(before);
    expect(upgraded.prepare('SELECT * FROM work_saved_cards').all()).toEqual([]);
    upgraded.exec('COMMIT;');
  });

  it('refuses a damaged version 8 bookmark table without modifying the file', () => {
    const file = location();
    createCurrent(file);
    const direct = openDatabase(file);
    direct.exec('DROP TABLE IF EXISTS work_saved_cards; PRAGMA user_version=8;');
    closeDatabase(direct);
    expectInspectionRefusal(file, vaultId, /required.*saved.*table|table.*work_saved_cards/i);
  });

  it('refuses a replaced bookmark table without its identity constraints', () => {
    const file = location();
    createCurrent(file);
    const direct = openDatabase(file);
    direct.exec(
      'DROP TABLE work_saved_cards; CREATE TABLE work_saved_cards(card_id TEXT,saved_at TEXT);',
    );
    closeDatabase(direct);
    expectInspectionRefusal(file, vaultId, /saved.*constraint/i);
  });

  it('refuses a composite bookmark primary key that permits duplicate saved identities', () => {
    const file = location();
    createCurrent(file);
    const direct = openDatabase(file);
    direct.exec(
      'DROP TABLE work_saved_cards; CREATE TABLE work_saved_cards(card_id TEXT NOT NULL REFERENCES work_cards(id),saved_at TEXT NOT NULL,PRIMARY KEY(card_id,saved_at)) STRICT;',
    );
    closeDatabase(direct);
    expectInspectionRefusal(file, vaultId, /saved.*constraint/i);
  });

  it('creates schema version 8 in an empty database and leaves the transaction open', () => {
    const db = openDatabase(location());
    db.exec('BEGIN IMMEDIATE;');

    initializeVaultSchema(db, vaultId, true, evidenceSchemaSql);

    expect(currentVaultSchemaVersion).toBe(8);
    expect(db.isTransaction).toBe(true);
    expect(inspectVaultSchema(db, vaultId)).toBe(currentVaultSchemaVersion);
    expect(db.prepare('SELECT revision FROM vault_meta WHERE singleton=1').get()).toEqual({
      revision: 0,
    });
    db.exec('COMMIT;');
  });

  it('upgrades v1 in place while retaining inventory rows, history, FTS, and vault revision', () => {
    const file = location();
    createVersionOne(file);
    const db = openDatabase(file);
    db.exec('BEGIN IMMEDIATE;');

    initializeVaultSchema(db, vaultId, false, evidenceSchemaSql);

    expect(db.isTransaction).toBe(true);
    expect(inspectVaultSchema(db, vaultId)).toBe(currentVaultSchemaVersion);
    expect(db.prepare('SELECT * FROM companies').all()).toEqual([
      { id: 'fixture_company', revision: 2, body: '{"fixture":"company-v1"}' },
    ]);
    expect(db.prepare('SELECT * FROM markets').all()).toEqual([
      { id: 'fixture_market', revision: 3, body: '{"fixture":"market-v1"}' },
    ]);
    expect(db.prepare('SELECT * FROM memberships').all()).toEqual([
      {
        id: 'fixture_membership',
        revision: 4,
        body: '{"fixture":"membership-v1"}',
        company_id: 'fixture_company',
        market_id: 'fixture_market',
      },
    ]);
    expect(db.prepare('SELECT * FROM record_history').all()).toEqual([
      {
        kind: 'companies',
        id: 'fixture_company',
        revision: 2,
        body: '{"fixture":"history-v1"}',
      },
    ]);
    expect(
      db
        .prepare("SELECT company_id FROM company_search WHERE company_search MATCH 'Fixture'")
        .all(),
    ).toEqual([{ company_id: 'fixture_company' }]);
    expect(db.prepare('SELECT revision FROM vault_meta WHERE singleton=1').get()).toEqual({
      revision: 17,
    });
    db.exec('COMMIT;');
  });

  it('inspects a current v7 database without changing its bytes', () => {
    const file = location();
    createCurrent(file);
    const before = readFileSync(file);
    const db = openDatabase(file);

    expect(inspectVaultSchema(db, vaultId)).toBe(currentVaultSchemaVersion);

    closeDatabase(db);
    expect(readFileSync(file)).toEqual(before);
  });

  it('inspects an existing v7 schema without executing the supplied SQL', () => {
    const file = location();
    createCurrent(file);
    const db = openDatabase(file);
    db.exec('BEGIN IMMEDIATE;');
    const tableNamesBefore = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();

    expect(() => initializeVaultSchema(db, vaultId, false, 'INVALID SQL;')).not.toThrow();

    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all(),
    ).toEqual(tableNamesBefore);
    db.exec('COMMIT;');
  });
  it('inspects a real v2 fixture read-only and upgrades it through the owner-state migration', () => {
    const file = location();
    createVersionTwo(file);
    const before = readFileSync(file);
    const reader = new DatabaseSync(file, { readOnly: true });
    try {
      expect(inspectVaultSchema(reader, vaultId)).toBe(2);
    } finally {
      reader.close();
    }
    expect(readFileSync(file).equals(before)).toBe(true);
    const db = openDatabase(file);
    const old = db.prepare('SELECT * FROM record_history').all();
    db.exec('BEGIN IMMEDIATE;');
    initializeVaultSchema(db, vaultId, false, 'INVALID SQL MUST NOT RUN;');
    expect(inspectVaultSchema(db, vaultId)).toBe(currentVaultSchemaVersion);
    expect(db.prepare('SELECT * FROM record_history').all()).toEqual(old);
    expect(db.prepare('SELECT * FROM writer_state').all()).toEqual([
      { singleton: 1, generation: 0, owner_nonce: null },
    ]);
    db.exec('COMMIT;');
  });

  it('upgrades a real v3 fixture without replacing its owner generation or prior input versions', () => {
    const file = location();
    createVersionThree(file);
    const before = readFileSync(file);
    const reader = new DatabaseSync(file, { readOnly: true });
    try {
      expect(inspectVaultSchema(reader, vaultId)).toBe(3);
    } finally {
      reader.close();
    }
    expect(readFileSync(file).equals(before)).toBe(true);
    const db = openDatabase(file);
    const owner = db.prepare('SELECT * FROM writer_state').get();
    db.exec('BEGIN IMMEDIATE;');
    initializeVaultSchema(db, vaultId, false, 'INVALID EVIDENCE SQL MUST NOT RUN;');
    expect(inspectVaultSchema(db, vaultId)).toBe(currentVaultSchemaVersion);
    expect(db.prepare('SELECT * FROM writer_state').get()).toEqual(owner);
    expect(db.prepare('SELECT * FROM retained_record_versions').all()).toEqual([
      { kind: 'company', id: 'fixture_company', revision: 2 },
    ]);
    db.exec('COMMIT;');
  });
  it('rolls a failed v3-to-v4 migration back without stamping a new schema or losing original data', () => {
    const file = location();
    createVersionThree(file);
    const db = openDatabase(file);
    db.exec('CREATE TABLE reports(unrelated TEXT);');
    const before = db.prepare('SELECT * FROM writer_state').get();
    db.exec('BEGIN IMMEDIATE;');
    expect(() => initializeVaultSchema(db, vaultId, false, 'INVALID SQL;')).toThrow(
      /already exists/i,
    );
    db.exec('ROLLBACK;');
    expect(inspectVaultSchema(db, vaultId)).toBe(3);
    expect(db.prepare('SELECT * FROM writer_state').get()).toEqual(before);
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name='retained_record_versions'").get(),
    ).toBeUndefined();
    expect(db.prepare('SELECT * FROM record_history').all()).toHaveLength(1);
  });
  it('upgrades a real v4 without rewriting bodies, history, research versions or owner generation', () => {
    const file = location();
    createVersionFour(file);
    const before = readFileSync(file);
    const reader = new DatabaseSync(file, { readOnly: true });
    expect(inspectVaultSchema(reader, vaultId)).toBe(4);
    reader.close();
    expect(readFileSync(file)).toEqual(before);
    const db = openDatabase(file);
    const bodies = db.prepare('SELECT * FROM companies').all();
    const history = db.prepare('SELECT * FROM record_history').all();
    const owner = db.prepare('SELECT * FROM writer_state').all();
    const versions = db.prepare('SELECT * FROM retained_record_versions').all();
    db.exec('BEGIN IMMEDIATE;');
    initializeVaultSchema(db, vaultId, false, 'INVALID SQL MUST NOT RUN;');
    expect(inspectVaultSchema(db, vaultId)).toBe(currentVaultSchemaVersion);
    expect(db.prepare('SELECT * FROM companies').all()).toEqual(bodies);
    expect(db.prepare('SELECT * FROM record_history').all()).toEqual(history);
    expect(db.prepare('SELECT * FROM writer_state').all()).toEqual(owner);
    expect(db.prepare('SELECT * FROM retained_record_versions').all()).toEqual(versions);
    db.exec('COMMIT;');
  });
  it('rolls a failed v4-to-v5 migration back after index creation, leaving old FTS and state intact', () => {
    const file = location();
    createVersionFour(file);
    const db = openDatabase(file);
    db.exec('CREATE TABLE market_scope_seeds(unrelated TEXT);');
    const owner = db.prepare('SELECT * FROM writer_state').all();
    const oldSearch = db.prepare('SELECT * FROM company_search').all();
    db.exec('BEGIN IMMEDIATE;');
    expect(() => initializeVaultSchema(db, vaultId, false, 'INVALID SQL;')).toThrow(
      /already exists/i,
    );
    db.exec('ROLLBACK;');
    expect(inspectVaultSchema(db, vaultId)).toBe(4);
    expect(db.prepare('SELECT * FROM writer_state').all()).toEqual(owner);
    expect(db.prepare('SELECT * FROM company_search').all()).toEqual(oldSearch);
    expect(
      db.prepare("SELECT 1 FROM sqlite_schema WHERE name='company_identity_search'").get(),
    ).toBeUndefined();
  });

  it('upgrades a real v5 fixture without rewriting inventory, evidence or its owner generation', () => {
    const file = location();
    createVersionFive(file);
    const db = openDatabase(file);
    db.exec('INSERT INTO companies VALUES(\'retained\',1,\'{"name":"Keep"}\');');
    db.exec("INSERT INTO company_identity_search VALUES('retained','Keep','');");
    const bodies = db.prepare('SELECT * FROM companies').all();
    const owner = db.prepare('SELECT * FROM writer_state').all();
    expect(inspectVaultSchema(db, vaultId)).toBe(5);
    db.exec('BEGIN IMMEDIATE;');
    initializeVaultSchema(db, vaultId, false, 'INVALID EVIDENCE SQL MUST NOT RUN;');
    expect(inspectVaultSchema(db, vaultId)).toBe(currentVaultSchemaVersion);
    expect(db.prepare('SELECT * FROM companies').all()).toEqual(bodies);
    expect(db.prepare('SELECT * FROM writer_state').all()).toEqual(owner);
    expect(db.prepare('SELECT * FROM legacy_sources').all()).toEqual([]);
    db.exec('COMMIT;');
  });
  it('rolls a failed v5 migration back without stamping v6 or changing existing records', () => {
    const file = location();
    createVersionFive(file);
    const db = openDatabase(file);
    db.exec('CREATE TABLE legacy_threads(unrelated TEXT);');
    const owner = db.prepare('SELECT * FROM writer_state').all();
    db.exec('BEGIN IMMEDIATE;');
    expect(() => initializeVaultSchema(db, vaultId, false, 'INVALID SQL;')).toThrow(
      /already exists/i,
    );
    db.exec('ROLLBACK;');
    expect(inspectVaultSchema(db, vaultId)).toBe(5);
    expect(db.prepare('SELECT * FROM writer_state').all()).toEqual(owner);
    expect(
      db.prepare("SELECT 1 FROM sqlite_schema WHERE name='legacy_sources'").get(),
    ).toBeUndefined();
  });
  it('requires an explicit owner upgrade for v6 and retains evidence, history and writer state', () => {
    const file = location();
    createVersionSix(file);
    const db = openDatabase(file);
    const companyBody = JSON.stringify({ name: 'Retained Company', officialDomain: null });
    db.prepare('INSERT INTO companies VALUES(?,?,?)').run('retained_company', 1, companyBody);
    db.prepare('INSERT INTO record_history VALUES(?,?,?,?)').run(
      'companies',
      'retained_company',
      1,
      companyBody,
    );
    db.prepare('INSERT INTO company_search VALUES(?,?,?)').run(
      'retained_company',
      'Retained Company',
      null,
    );
    db.prepare('INSERT INTO company_identity_search VALUES(?,?,?)').run(
      'retained_company',
      'Retained Company',
      '',
    );
    const legacy = createLegacyStore(
      db,
      () => {},
      () => Number(db.prepare('SELECT revision FROM vault_meta').get()?.revision),
      () => {},
    );
    const retained = legacy.retainLegacySnapshot(JSON.stringify(legacyRetentionFixture(2)), 0);
    db.prepare('INSERT INTO source_versions VALUES(?,?,?,?)').run(
      'retained_source',
      1,
      '{"fixture":"evidence"}',
      'Retained content',
    );
    const before = {
      history: db.prepare('SELECT * FROM record_history').all(),
      evidence: db.prepare('SELECT * FROM source_versions').all(),
      inventory: db.prepare('SELECT * FROM companies').all(),
      writer: db.prepare('SELECT * FROM writer_state').all(),
      revision: db.prepare('SELECT * FROM vault_meta').all(),
      legacy: legacy.exportLegacySnapshot(retained.sourceSha256),
      versions: db.prepare('SELECT * FROM retained_record_versions').all(),
    };
    expect(before.history).toHaveLength(1);
    expect(before.evidence).toHaveLength(1);
    closeDatabase(db);
    const bytes = readFileSync(file);
    expect(() => openVault(file, vaultId, 'reader')).toThrow(/explicit owner-side schema upgrade/i);
    expect(readFileSync(file)).toEqual(bytes);
    const ownerDb = openDatabase(file);
    ownerDb.exec('BEGIN IMMEDIATE;');
    initializeVaultSchema(ownerDb, vaultId, false, 'INVALID EVIDENCE SQL MUST NOT RUN;');
    expect(inspectVaultSchema(ownerDb, vaultId)).toBe(8);
    expect(ownerDb.prepare('SELECT * FROM record_history').all()).toEqual(before.history);
    expect(ownerDb.prepare('SELECT * FROM source_versions').all()).toEqual(before.evidence);
    expect(ownerDb.prepare('SELECT * FROM companies').all()).toEqual(before.inventory);
    expect(ownerDb.prepare('SELECT * FROM writer_state').all()).toEqual(before.writer);
    expect(ownerDb.prepare('SELECT * FROM vault_meta').all()).toEqual(before.revision);
    expect(ownerDb.prepare('SELECT * FROM retained_record_versions').all()).toEqual(
      before.versions,
    );
    expect(ownerDb.prepare('SELECT * FROM work_runs').all()).toEqual([]);
    ownerDb.exec('COMMIT;');
    closeDatabase(ownerDb);
    const reader = openVault(file, vaultId, 'reader');
    try {
      expect(reader.work.listRuns()).toEqual([]);
      expect(reader.exportLegacySnapshot(retained.sourceSha256)).toBe(before.legacy);
    } finally {
      reader.close();
    }
  });
  it('rolls back a failed v6 migration without changing old history or schema version', () => {
    const file = location();
    createVersionSix(file);
    const db = openDatabase(file);
    db.exec('CREATE TABLE work_events(unrelated TEXT);');
    const history = db.prepare('SELECT * FROM record_history').all();
    db.exec('BEGIN IMMEDIATE;');
    expect(() => initializeVaultSchema(db, vaultId, false, 'INVALID SQL;')).toThrow(
      /already exists/i,
    );
    db.exec('ROLLBACK;');
    expect(inspectVaultSchema(db, vaultId)).toBe(6);
    expect(db.prepare('SELECT * FROM record_history').all()).toEqual(history);
    expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='work_runs'").get()).toBeUndefined();
  });
  it('refuses an incomplete v7 operational schema without changing database bytes', () => {
    const file = location();
    createCurrent(file);
    const db = openDatabase(file);
    db.exec('DROP TABLE work_cards;');
    closeDatabase(db);
    expectInspectionRefusal(file, vaultId, /work_cards/i);
  });
  it('refuses a damaged v6 history table without changing database bytes', () => {
    const file = location();
    createCurrent(file);
    const db = openDatabase(file);
    db.exec('DROP TABLE legacy_threads;');
    closeDatabase(db);
    expectInspectionRefusal(file, vaultId, /legacy_threads/i);
  });
  it.each(['missing', 'replaced'])('refuses %s legacy immutability guards read-only', (mode) => {
    const file = location();
    createCurrent(file);
    const db = openDatabase(file);
    db.exec('DROP TRIGGER legacy_sources_no_update;');
    if (mode === 'replaced')
      db.exec(
        'CREATE TRIGGER legacy_sources_no_update BEFORE UPDATE ON legacy_sources BEGIN SELECT 1; END;',
      );
    closeDatabase(db);
    expectInspectionRefusal(file, vaultId, /legacy.*guard/i);
  });
  it('refuses future schema versions without changing database bytes', () => {
    const file = location();
    const db = openDatabase(file);
    db.exec('CREATE TABLE fixture_future(value TEXT); PRAGMA user_version=99;');
    closeDatabase(db);

    expectInspectionRefusal(file, vaultId, /newer/i);
  });

  it('rejects an invalid or unsupported schema version', () => {
    const file = location();
    const db = openDatabase(file);
    db.exec('PRAGMA user_version=9007199254740992;');
    closeDatabase(db);

    expectInspectionRefusal(file, vaultId, /version|unrecognized/i);
  });

  it('refuses a different vault identity without changing database bytes', () => {
    const file = location();
    createVersionOne(file, 'fixture_other_vault');

    expectInspectionRefusal(file, vaultId, /identity/i);
  });

  it('rejects broken inventory foreign keys without changing database bytes', () => {
    const file = location();
    createVersionOne(file);
    const db = openDatabase(file, false);
    db.prepare('INSERT INTO memberships VALUES(?,?,?,?,?)').run(
      'fixture_orphan_membership',
      1,
      '{"fixture":"orphan"}',
      'fixture_missing_company',
      'fixture_missing_market',
    );
    closeDatabase(db);

    expectInspectionRefusal(file, vaultId, /foreign key/i);
  });

  it('rejects missing mandatory inventory columns without changing database bytes', () => {
    const file = location();
    const db = openDatabase(file);
    db.exec(`
      CREATE TABLE vault_meta(singleton INTEGER, vault_id TEXT, revision INTEGER);
      INSERT INTO vault_meta VALUES(1, '${vaultId}', 0);
      CREATE TABLE companies(id TEXT, revision INTEGER);
      PRAGMA user_version=1;
    `);
    closeDatabase(db);

    expectInspectionRefusal(file, vaultId, /required|column/i);
  });

  it('requires every evidence table for schema version 2', () => {
    const file = location();
    const db = openDatabase(file);
    db.exec(inventorySchemaSql);
    db.prepare('INSERT INTO vault_meta VALUES(1,?,0)').run(vaultId);
    db.exec(`
      CREATE TABLE source_versions(id TEXT);
      CREATE TABLE passages(id TEXT);
      CREATE TABLE metric_definitions(id TEXT);
      CREATE TABLE observations(id TEXT);
      PRAGMA user_version=2;
    `);
    closeDatabase(db);

    expectInspectionRefusal(file, vaultId, /observation_evidence|evidence/i);
  });

  it('rejects a missing mandatory evidence column without changing database bytes', () => {
    const file = location();
    const db = openDatabase(file);
    db.exec('BEGIN IMMEDIATE;');
    initializeVaultSchema(db, vaultId, true, evidenceSchemaSql);
    db.exec('COMMIT; DROP TABLE source_versions;');
    db.exec('CREATE TABLE source_versions(id TEXT, revision INTEGER, body TEXT);');
    closeDatabase(db);

    expectInspectionRefusal(file, vaultId, /source_versions column: content/i);
  });

  it('leaves v1 and its data intact when evidence DDL fails and the caller rolls back', () => {
    const file = location();
    createVersionOne(file);
    const db = openDatabase(file);
    db.exec('BEGIN IMMEDIATE;');

    expect(() =>
      initializeVaultSchema(
        db,
        vaultId,
        false,
        'CREATE TABLE source_versions(id TEXT); SELECT * FROM fixture_missing_table;',
      ),
    ).toThrow();
    expect(db.isTransaction).toBe(true);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    db.exec('ROLLBACK;');
    closeDatabase(db);

    const reopened = openDatabase(file);
    expect(inspectVaultSchema(reopened, vaultId)).toBe(1);
    expect(
      reopened.prepare('SELECT body FROM companies WHERE id=?').get('fixture_company'),
    ).toEqual({
      body: '{"fixture":"company-v1"}',
    });
    expect(
      reopened
        .prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name='source_versions'")
        .get(),
    ).toEqual({ count: 0 });
  });

  it('requires initialization inside a caller-owned transaction', () => {
    const file = location();
    const db = openDatabase(file);

    expect(() => initializeVaultSchema(db, vaultId, true, evidenceSchemaSql)).toThrow(
      /transaction/i,
    );
    expect(db.isTransaction).toBe(false);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 });
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all(),
    ).toEqual([]);
  });

  it('does not adopt unrelated version-zero schema even when creation is allowed', () => {
    const file = location();
    const db = openDatabase(file);
    db.exec('CREATE TABLE fixture_unrelated(value TEXT);');
    closeDatabase(db);
    const before = readFileSync(file);
    const writer = openDatabase(file);
    writer.exec('BEGIN IMMEDIATE;');

    expect(() => initializeVaultSchema(writer, vaultId, true, evidenceSchemaSql)).toThrow(
      /unrecognized|unrelated/i,
    );
    writer.exec('ROLLBACK;');
    closeDatabase(writer);
    expect(readFileSync(file)).toEqual(before);
  });

  it('does not create a version-zero vault when creation is disallowed', () => {
    const db = openDatabase(location());
    db.exec('BEGIN IMMEDIATE;');

    expect(() => initializeVaultSchema(db, vaultId, false, evidenceSchemaSql)).toThrow(/creation/i);
    expect(db.isTransaction).toBe(true);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 });
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all(),
    ).toEqual([]);
  });
});
