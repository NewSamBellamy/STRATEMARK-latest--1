import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import type * as NodeSqlite from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evidenceSchemaSql } from './vault-evidence-store';
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

function createVersionTwo(file: string, id = vaultId) {
  const db = openDatabase(file);
  db.exec('BEGIN IMMEDIATE;');
  initializeVaultSchema(db, id, true, evidenceSchemaSql);
  db.exec('COMMIT;');
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
  it('creates only schema version 2 in an empty database and leaves the transaction open', () => {
    const db = openDatabase(location());
    db.exec('BEGIN IMMEDIATE;');

    initializeVaultSchema(db, vaultId, true, evidenceSchemaSql);

    expect(currentVaultSchemaVersion).toBe(2);
    expect(db.isTransaction).toBe(true);
    expect(inspectVaultSchema(db, vaultId)).toBe(2);
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
    expect(inspectVaultSchema(db, vaultId)).toBe(2);
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

  it('inspects a v2 database without changing its bytes', () => {
    const file = location();
    createVersionTwo(file);
    const before = readFileSync(file);
    const db = openDatabase(file);

    expect(inspectVaultSchema(db, vaultId)).toBe(2);

    closeDatabase(db);
    expect(readFileSync(file)).toEqual(before);
  });

  it('inspects an existing v2 schema without executing the supplied SQL', () => {
    const file = location();
    createVersionTwo(file);
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
