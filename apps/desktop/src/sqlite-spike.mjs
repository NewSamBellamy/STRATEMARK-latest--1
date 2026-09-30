import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { setInterval } from 'node:timers';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { openVault } from './vault.ts';

const marker = (name, data) => process.stdout.write(`${name} ${JSON.stringify(data)}\n`);

function openWal(databasePath) {
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0;');
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  return db;
}

async function proveNativeVault(directory) {
  const vaultId = 'vault_spike';
  const at = '2026-09-30T12:00:00.000Z';
  const record = (id, revision = 1) => ({
    contractVersion: '1',
    vaultId,
    id,
    revision,
    createdAt: at,
    updatedAt: at,
  });
  const file = path.join(directory, 'inventory.sqlite');
  const vault = openVault(file, vaultId);
  try {
    const company = { record: record('co_a'), name: 'Fixture Labs', officialDomain: 'a.example' };
    vault.saveCompany(company, 0);
    for (const marketId of ['mkt_a', 'mkt_b']) {
      vault.saveMarket({ record: record(marketId), name: marketId }, 0);
      vault.saveMembership(
        { record: record(`mem_${marketId}`), marketId, companyId: 'co_a', roles: ['company'] },
        0,
      );
    }
    assert.deepEqual(vault.listMarketCompanies('mkt_a').items, [company]);
    assert.deepEqual(vault.listMarketCompanies('mkt_b').items, [company]);
    const updated = { ...company, record: record('co_a', 2), name: 'Fixture Corrected' };
    vault.saveCompany(updated, 1);
    assert.throws(() => vault.saveCompany({ ...updated, name: 'Stale Fixture' }, 1), /revision/i);
    assert.deepEqual(vault.companyHistory('co_a').items, [company, updated]);
    vault.saveCompany({ ...company, record: record('co_b'), officialDomain: 'b.example' }, 0);
    const first = vault.searchCompanies('Fixture', { limit: 1 });
    assert.equal(first.nextCursor, 'co_a');
    assert.equal(first.items.length, 1);
    assert.equal(
      vault.searchCompanies('Fixture', { limit: 1, afterId: first.nextCursor }).items[0].record.id,
      'co_b',
    );
    const backupPath = path.join(directory, 'inventory-backup.sqlite');
    await vault.backup(backupPath);
    const restored = openVault(backupPath, vaultId);
    try {
      assert.deepEqual(restored.getCompany('co_a'), updated);
      assert.equal(restored.integrity(), 'ok');
    } finally {
      restored.close();
    }
    return {
      twoMarketSharedIdentity: true,
      retainedHistory: true,
      staleWriteRejected: true,
      pagedSearch: true,
      backupReopened: true,
    };
  } finally {
    vault.close();
  }
}

async function prepare(directory) {
  const nativeVault = await proveNativeVault(directory);
  const databasePath = path.join(directory, 'source.sqlite');
  const backupPath = path.join(directory, 'snapshot.sqlite');
  let db = openWal(databasePath);
  const engine = db
    .prepare('SELECT sqlite_version() AS version, sqlite_source_id() AS sourceId')
    .get();
  db.exec(
    'CREATE TABLE entries (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE VIRTUAL TABLE search_index USING fts5(content);',
  );
  db.prepare('INSERT INTO entries VALUES (?, ?)').run('committed', 'survives-crash');
  db.prepare('INSERT INTO search_index (content) VALUES (?)').run(
    'synthetic nebula durable record',
  );
  assert.equal(
    db.prepare("SELECT rowid FROM search_index WHERE search_index MATCH 'nebula durable'").all()
      .length,
    1,
  );
  db.close();

  db = openWal(databasePath);
  assert.equal(
    db.prepare('SELECT value FROM entries WHERE key=?').get('committed').value,
    'survives-crash',
  );
  db.prepare('INSERT INTO entries VALUES (?, ?)').run('wal-snapshot', 'captured-while-open');
  const walPath = `${databasePath}-wal`;
  assert.ok(
    existsSync(walPath) && statSync(walPath).size > 32,
    'source must have committed WAL frames',
  );
  await backup(db, backupPath);
  assert.equal(
    db.prepare('SELECT value FROM entries WHERE key=?').get('wal-snapshot').value,
    'captured-while-open',
  );

  const snapshot = new DatabaseSync(backupPath);
  assert.equal(
    snapshot.prepare('SELECT value FROM entries WHERE key=?').get('committed').value,
    'survives-crash',
  );
  assert.equal(
    snapshot.prepare('SELECT value FROM entries WHERE key=?').get('wal-snapshot').value,
    'captured-while-open',
  );
  assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  snapshot.close();
  const backupValues = { committed: 'survives-crash', walSnapshot: 'captured-while-open' };
  db.close();

  marker('SQLITE_SPIKE_OK', {
    phase: 'prepare',
    versions: {
      electron: process.versions.electron,
      node: process.versions.node,
      sqlite: process.versions.sqlite,
    },
    engine,
    nativeVault,
    fts5Match: true,
    walReopen: true,
    backupFromOpenWal: true,
    backupReopen: true,
    backupValues,
  });
}

function crash(directory) {
  const databasePath = path.join(directory, 'source.sqlite');
  const db = openWal(databasePath);
  db.exec('PRAGMA cache_size=4; BEGIN IMMEDIATE;');
  const insert = db.prepare('INSERT INTO entries VALUES (?, ?)');
  const payload = 'synthetic-uncommitted-'.repeat(256);
  for (let index = 0; index < 256; index++) insert.run(`pending-${index}`, payload);
  const walPath = `${databasePath}-wal`;
  const walBytes = existsSync(walPath) ? statSync(walPath).size : 0;
  assert.ok(walBytes > 32, 'uncommitted transaction must have spilled frames into WAL');
  marker('SQLITE_SPIKE_CRASH_READY', {
    pid: process.pid,
    databasePath,
    walBytes,
    pendingRows: 256,
  });
  setInterval(() => {}, 1000);
}

function recover(directory) {
  const db = openWal(path.join(directory, 'source.sqlite'));
  const committed = db.prepare('SELECT value FROM entries WHERE key=?').get('committed')?.value;
  const uncommitted = db
    .prepare("SELECT count(*) AS n FROM entries WHERE key LIKE 'pending-%'")
    .get().n;
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  assert.equal(committed, 'survives-crash');
  assert.equal(uncommitted, 0);
  assert.equal(integrity, 'ok');
  db.close();
  marker('SQLITE_SPIKE_OK', {
    phase: 'recover',
    committedSurvived: true,
    uncommittedAbsent: true,
    integrityCheck: integrity,
  });
}

async function main() {
  const [mode, directory] = process.argv.slice(3);
  if (!directory || !['prepare', 'crash', 'recover'].includes(mode))
    throw new Error('invalid sqlite spike worker arguments');
  if (mode === 'prepare') await prepare(directory);
  else if (mode === 'crash') crash(directory);
  else recover(directory);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
