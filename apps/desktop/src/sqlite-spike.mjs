import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { setInterval } from 'node:timers';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { openVault } from './vault.ts';
import { inventorySchemaSql } from './vault-schema.ts';

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
  const company = { record: record('co_a'), name: 'Fixture Labs', officialDomain: 'a.example' };
  // Create a P02-shaped synthetic vault, then prove the real v1 -> v2 -> v3 upgrade.
  const prior = new DatabaseSync(file);
  try {
    prior.exec(`BEGIN IMMEDIATE; ${inventorySchemaSql}`);
    prior.prepare('INSERT INTO vault_meta VALUES(1,?,1)').run(vaultId);
    prior.prepare('INSERT INTO companies VALUES(?,?,?)').run('co_a', 1, JSON.stringify(company));
    prior
      .prepare('INSERT INTO record_history VALUES(?,?,?,?)')
      .run('companies', 'co_a', 1, JSON.stringify(company));
    prior
      .prepare('INSERT INTO company_search VALUES(?,?,?)')
      .run('co_a', company.name, company.officialDomain);
    prior.exec('PRAGMA user_version=1; COMMIT;');
  } finally {
    prior.close();
  }
  const handle = openVault(file, vaultId);
  const vault = { ...handle, ...handle.writer() };
  try {
    assert.equal(vault.status().schemaVersion, 3);
    assert.deepEqual(vault.getCompany('co_a'), company);
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
    const content = 'Synthetic revenue was 0 USD in 2025 and 5 USD in 2026.';
    const hash = createHash('sha256').update(content).digest('hex');
    const source = {
      ...record('src_a'),
      canonicalUrl: null,
      originalUrl: null,
      contentHash: hash,
      fetchedAt: at,
      publishedAt: null,
      eventAt: null,
      retrievalStatus: 'retrieved',
      origin: 'user_provided',
      visibilityScope: { companyIds: ['co_a'], marketIds: [] },
    };
    vault.saveSourceVersion(source, content, 0);
    vault.savePassage({
      ...record('pass_a'),
      sourceId: 'src_a',
      sourceRevision: 1,
      text: content,
      contentHash: hash,
      origin: source.origin,
      visibilityScope: source.visibilityScope,
    });
    vault.saveMetricDefinition({
      record: record('annual_revenue'),
      label: 'Annual revenue',
      description: 'Reported revenue for the annual interval, not funding.',
      unit: 'money',
      currencyMode: 'required',
      scopeKind: 'company',
      periodKind: 'interval',
    });
    for (const [year, value] of [
      [2025, 0],
      [2026, 5],
    ]) {
      vault.saveObservation({
        ...record(`obs_${year}`),
        companyId: 'co_a',
        metricDefinitionId: 'annual_revenue',
        scope: { kind: 'company', id: 'co_a' },
        unit: 'money',
        currency: 'USD',
        period: {
          kind: 'interval',
          startAt: `${year}-01-01T00:00:00Z`,
          endAt: `${year}-12-31T23:59:59Z`,
        },
        value,
        support: 'supported',
        evidenceRefs: [{ sourceId: 'src_a', sourceRevision: 1, passageId: 'pass_a' }],
      });
    }
    assert.equal(vault.listObservations('co_a').items.length, 2);
    assert.equal(vault.comparableObservations('obs_2025').items.length, 1);
    assert.equal(vault.comparableObservations('obs_2025').hasDifferentValues, false);
    assert.throws(
      () =>
        vault.saveSourceVersion(
          { ...source, id: 'src_bad', contentHash: 'a'.repeat(64) },
          content,
          0,
        ),
      /hash/i,
    );
    const oldWriter = vault.writer();
    vault.advanceWriterGeneration();
    assert.equal(vault.status().writerGeneration, 2);
    assert.throws(
      () => oldWriter.saveCompany({ ...company, record: record('co_late') }, 0),
      /fenced/i,
    );
    assert.throws(
      () => oldWriter.saveSourceVersion({ ...source, id: 'src_late' }, content, 0),
      /fenced/i,
    );
    assert.equal(vault.getCompany('co_late'), null);
    assert.equal(vault.getSourceVersion('src_late', 1), null);
    const backupPath = path.join(directory, 'inventory-backup.sqlite');
    await vault.backup(backupPath);
    const restored = openVault(backupPath, vaultId, 'reader');
    try {
      assert.deepEqual(restored.getCompany('co_a'), updated);
      assert.deepEqual(restored.getSourceVersion('src_a', 1), { record: source, content });
      assert.equal(restored.getPassage('pass_a').text, content);
      assert.deepEqual(
        restored.listObservations('co_a').items.map((item) => item.value),
        [0, 5],
      );
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
      versionOneUpgrade: true,
      retainedEvidenceBackup: true,
      periodAndZeroRetained: true,
      falseHashRejected: true,
      oldCapabilityFenced: true,
      ownerGenerationAdvanced: true,
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
  const owned = openVault(path.join(directory, 'owned.sqlite'), 'vault_owner');
  const at = '2026-09-30T12:00:00Z';
  owned
    .writer()
    .saveCompany(
      {
        record: {
          contractVersion: '1',
          vaultId: 'vault_owner',
          id: 'co_owned',
          revision: 1,
          createdAt: at,
          updatedAt: at,
        },
        name: 'Owned fixture',
        officialDomain: null,
      },
      0,
    );
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
    ownedDatabasePath: path.join(directory, 'owned.sqlite'),
    writerGeneration: owned.status().writerGeneration,
  });
  // Hold actual handles strongly until the deliberate process kill.
  setInterval(() => {
    assert.equal(db.isTransaction, true);
    owned.status();
  }, 1000);
}

function contend(directory) {
  const file = path.join(directory, 'owned.sqlite');
  assert.throws(() => openVault(file, 'vault_owner'), /already owned/i);
  const reader = openVault(file, 'vault_owner', 'reader');
  try {
    assert.equal(reader.status().writerGeneration, 1);
    assert.equal(reader.getCompany('co_owned').name, 'Owned fixture');
    assert.throws(() => reader.writer(), /read-only/i);
    assert.throws(() => reader.advanceWriterGeneration(), /read-only/i);
  } finally {
    reader.close();
  }
  marker('SQLITE_SPIKE_OK', {
    phase: 'contend',
    secondOwnerRejected: true,
    committedReaderWorked: true,
  });
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
  const owned = openVault(path.join(directory, 'owned.sqlite'), 'vault_owner');
  try {
    assert.equal(owned.status().writerGeneration, 2);
    const company = owned.getCompany('co_owned');
    owned
      .writer()
      .saveCompany(
        { ...company, record: { ...company.record, revision: 2 }, name: 'Recovered owner' },
        1,
      );
    assert.equal(owned.getCompany('co_owned').name, 'Recovered owner');
  } finally {
    owned.close();
  }
  marker('SQLITE_SPIKE_OK', {
    phase: 'recover',
    committedSurvived: true,
    uncommittedAbsent: true,
    integrityCheck: integrity,
    crashedOwnerReplaced: true,
    replacementGeneration: 2,
  });
}

async function main() {
  const [mode, directory] = process.argv.slice(3);
  if (!directory || !['prepare', 'crash', 'contend', 'recover'].includes(mode))
    throw new Error('invalid sqlite spike worker arguments');
  if (mode === 'prepare') await prepare(directory);
  else if (mode === 'crash') crash(directory);
  else if (mode === 'contend') contend(directory);
  else recover(directory);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
