import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import process from 'node:process';
import { setInterval } from 'node:timers';
import { existsSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { openVault } from './vault.ts';
import { inventorySchemaSql } from './vault-schema.ts';
import { inspectLegacySnapshot } from './snapshot-inspection.ts';
import { evidenceSchemaSql } from './vault-evidence-store.ts';
import { researchSchemaSql } from './vault-research-store.ts';
import { openAssetStore } from './vault-assets.ts';
import { legacyRetentionFixture, minimalLegacyJobFixture } from './legacy-retention-fixture.ts';
import { stageLegacySnapshot, verifyStagedCandidate } from './vault-staging.ts';
import { openStagedVault } from './staged-vault-reader.ts';
import { createStagedBackup, restoreStagedBackup } from './vault-lifecycle.ts';

function stagedFingerprint(directory) {
  const manifest = verifyStagedCandidate(directory);
  const assets = openAssetStore(path.join(directory, 'assets'), () => {
    throw new Error('fingerprint asset reader is read-only');
  });
  return {
    database: createHash('sha256')
      .update(readFileSync(path.join(directory, 'vault.sqlite')))
      .digest('hex'),
    manifest: createHash('sha256')
      .update(readFileSync(path.join(directory, 'manifest.json')))
      .digest('hex'),
    assets: manifest.originalSourceChunks.map((ref) => ({
      ...ref,
      verifiedSha256: createHash('sha256').update(assets.read(ref)).digest('hex'),
    })),
  };
}

function proveStagedNavigation(directory) {
  const at = '2026-09-30T12:00:00.000Z';
  for (const [index, version] of [undefined, 1, 2].entries()) {
    const original = `${JSON.stringify(legacyRetentionFixture(version), null, 2)}\n`;
    const originalFile = path.join(directory, `original-${index}.json`);
    writeFileSync(originalFile, original, { flag: 'wx', flush: true });
    const staged = stageLegacySnapshot(original, directory, 'vault_staged_proof', at);
    assert.deepEqual(verifyStagedCandidate(staged.directory), staged.manifest);
    assert.equal(readFileSync(originalFile, 'utf8'), original);
    const assets = openAssetStore(path.join(staged.directory, 'assets'), () => {
      throw new Error('proof asset reader is read-only');
    });
    const bytes = Buffer.concat(
      staged.manifest.originalSourceChunks.map((ref) => assets.read(ref)),
    );
    assert.deepEqual(bytes, Buffer.from(original, 'utf8'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), staged.manifest.sourceSha256);
    const reader = openStagedVault(staged.directory);
    try {
      assert.deepEqual(
        reader.listMarkets().items.map((item) => item.record.id),
        ['mkt_a', 'mkt_b'],
      );
      for (const marketId of ['mkt_a', 'mkt_b']) {
        const deck = reader.getDeckByMarket(marketId);
        const cards = reader.listCards(deck.deck.id);
        assert.equal(cards.items.length, 1);
        assert.equal(cards.items[0].company.record.id, 'co_shared');
        assert.equal(cards.items[0].evidenceState, 'legacy_unreviewed');
        assert.deepEqual(cards.items[0].metrics, []);
      }
      assert.equal(reader.status().authority, 'disabled');
      assert.equal(reader.status().canApply, false);
    } finally {
      reader.close();
    }
  }
  const original = JSON.stringify(legacyRetentionFixture(2));
  let interruptedDirectory;
  assert.throws(() =>
    stageLegacySnapshot(original, directory, 'vault_interrupted', at, (progress) => {
      if (progress.phase === 'history_retained') {
        interruptedDirectory = progress.directory;
        throw new Error('synthetic interruption');
      }
    }),
  );
  assert.ok(interruptedDirectory);
  assert.equal(existsSync(path.join(interruptedDirectory, 'manifest.json')), false);
  assert.throws(() => openStagedVault(interruptedDirectory));
  const archive = openVault(
    path.join(interruptedDirectory, 'vault.sqlite'),
    'vault_interrupted',
    'reader',
  );
  try {
    const sourceHash = createHash('sha256').update(original).digest('hex');
    assert.deepEqual(JSON.parse(archive.exportLegacySnapshot(sourceHash)), JSON.parse(original));
    assert.equal(archive.verifyLegacySnapshot(sourceHash).proposedAuthority.runnableJobs, 0);
  } finally {
    archive.close();
  }
  return {
    allKnownFormats: true,
    exactOriginalAssets: true,
    originalFileUntouched: true,
    sharedCompanyNavigation: true,
    noUnsupportedMetrics: true,
    incompleteCandidateRefused: true,
    originalHistoryRetainedAfterInterruption: true,
  };
}

function stageCrash(directory) {
  const original = `${JSON.stringify(legacyRetentionFixture(2), null, 2)}\n`;
  writeFileSync(path.join(directory, 'crash-original.json'), original, { flag: 'wx', flush: true });
  stageLegacySnapshot(
    original,
    directory,
    'vault_stage_crash',
    '2026-09-30T12:00:00.000Z',
    (progress) => {
      if (progress.phase !== 'history_retained') return;
      const receipt = {
        directory: progress.directory,
        sourceSha256: createHash('sha256').update(original).digest('hex'),
      };
      writeFileSync(path.join(directory, 'stage-crash-receipt.json'), JSON.stringify(receipt), {
        flag: 'wx',
        flush: true,
      });
      // Flush the ready marker synchronously, then hold the real owner inside conversion.
      writeSync(
        1,
        `SQLITE_STAGE_CRASH_READY ${JSON.stringify({ pid: process.pid, ...receipt })}\n`,
      );
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      throw new Error('unexpected synthetic crash worker wake-up');
    },
  );
  throw new Error('synthetic crash candidate unexpectedly completed');
}

function stageRecover(directory) {
  const receipt = JSON.parse(
    readFileSync(path.join(directory, 'stage-crash-receipt.json'), 'utf8'),
  );
  assert.equal(path.dirname(receipt.directory), directory);
  assert.match(path.basename(receipt.directory), /^stratemark-stage-/);
  const original = `${JSON.stringify(legacyRetentionFixture(2), null, 2)}\n`;
  const bytes = Buffer.from(original, 'utf8');
  assert.equal(readFileSync(path.join(directory, 'crash-original.json'), 'utf8'), original);
  assert.equal(receipt.sourceSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(existsSync(path.join(receipt.directory, 'manifest.json')), false);
  assert.throws(() => verifyStagedCandidate(receipt.directory));
  assert.throws(() => openStagedVault(receipt.directory));
  const assets = openAssetStore(path.join(receipt.directory, 'assets'), () => {
    throw new Error('crash recovery assets are read-only');
  });
  assert.deepEqual(
    assets.read({ sha256: receipt.sourceSha256, byteLength: bytes.byteLength }),
    bytes,
  );
  const vault = openVault(path.join(receipt.directory, 'vault.sqlite'), 'vault_stage_crash');
  try {
    assert.equal(vault.status().writerGeneration, 2);
    assert.equal(vault.integrity(), 'ok');
    assert.deepEqual(
      JSON.parse(vault.exportLegacySnapshot(receipt.sourceSha256)),
      JSON.parse(original),
    );
    assert.equal(vault.listMarkets().items.length, 0);
    assert.equal(
      vault.verifyLegacySnapshot(receipt.sourceSha256).proposedAuthority.runnableJobs,
      0,
    );
  } finally {
    vault.close();
  }
  marker('SQLITE_SPIKE_OK', {
    phase: 'stage-recover',
    originalUntouched: true,
    originalAssetsRetained: true,
    passiveHistoryRetained: true,
    incompleteCandidateRefused: true,
    noInventoryApproved: true,
    replacementGeneration: 2,
  });
}

async function proveLegacyRetention(directory) {
  const file = path.join(directory, 'legacy-retention.sqlite');
  const vault = openVault(file, 'vault_legacy_retention');
  const fixtures = [undefined, 1, 2].map((version) => legacyRetentionFixture(version));
  fixtures.push(minimalLegacyJobFixture(1));
  const receipts = [];
  try {
    for (const fixture of fixtures) {
      const json = JSON.stringify(fixture);
      const receipt = vault.writer().retainLegacySnapshot(json, vault.status().revision);
      receipts.push(receipt);
      assert.equal(receipt.sourceSha256, createHash('sha256').update(json).digest('hex'));
      assert.equal(receipt.authority, 'disabled');
      assert.deepEqual(JSON.parse(vault.exportLegacySnapshot(receipt.sourceSha256)), fixture);
      const verified = vault.verifyLegacySnapshot(receipt.sourceSha256);
      assert.equal(verified.canApply, false);
      assert.equal(verified.proposedAuthority.runnableJobs, 0);
      assert.equal(verified.proposedAuthority.localAttestations, 0);
    }
    const before = vault.status().revision;
    const duplicate = vault.writer().retainLegacySnapshot(JSON.stringify(fixtures[0]), 0);
    assert.equal(duplicate.vaultRevision, before);
    assert.equal(vault.getCompany('co_shared'), null);
    assert.equal(vault.getObservation('metric_a'), null);
    assert.equal(vault.listReports({ kind: 'market', id: 'mkt_a' }).items.length, 0);
    const stale = vault.writer();
    vault.advanceWriterGeneration();
    assert.throws(() => stale.retainLegacySnapshot('{ malformed', before), /fenced/i);
    const backupFile = path.join(directory, 'legacy-retention-backup.sqlite');
    await vault.backup(backupFile);
    const reader = openVault(backupFile, 'vault_legacy_retention', 'reader');
    try {
      for (const [index, receipt] of receipts.entries())
        assert.deepEqual(
          JSON.parse(reader.exportLegacySnapshot(receipt.sourceSha256)),
          fixtures[index],
        );
      assert.equal(reader.integrity(), 'ok');
      assert.equal(reader.status().schemaVersion, 6);
    } finally {
      reader.close();
    }
  } finally {
    vault.close();
  }
  const reopened = openVault(file, 'vault_legacy_retention', 'reader');
  try {
    assert.deepEqual(
      JSON.parse(reopened.exportLegacySnapshot(receipts[0].sourceSha256)),
      fixtures[0],
    );
  } finally {
    reopened.close();
  }
  return {
    allFamiliesRetained: true,
    rawNestedHistory: true,
    minimalJobOmissions: true,
    attributionNotAuthority: true,
    idempotentSource: true,
    oldCapabilityFenced: true,
    consistentBackupReopened: true,
    closedVaultReopened: true,
  };
}

const marker = (name, data) => process.stdout.write(`${name} ${JSON.stringify(data)}\n`);

function proveLegacyInspection() {
  const at = '2026-09-30T12:00:00.000Z';
  const original = {
    markets: ['a', 'b'].map((suffix) => ({
      id: `mkt_${suffix}`,
      name: `Market ${suffix}`,
      scopeDefinition: { vertical: 'Synthetic', geography: null, notes: null },
      refreshCadence: 'daily',
      createdAt: at,
    })),
    decks: ['a', 'b'].map((suffix) => ({
      id: `deck_${suffix}`,
      marketId: `mkt_${suffix}`,
      createdAt: at,
      lastRefreshedAt: null,
    })),
    companies: [
      {
        id: 'co_a',
        name: 'Fixture Labs',
        oneLiner: 'Synthetic',
        websiteUrl: 'https://a.example',
        logoUrl: null,
        hqLocation: null,
        brandTheme: null,
      },
    ],
    metrics: [
      {
        id: 'metric_a',
        companyId: 'co_a',
        metricType: 'arr',
        value: 0,
        confidence: 'user_verified',
        source: 'https://a.example/report',
        methodNote: null,
        capturedAt: at,
        period: '2025',
      },
    ],
    cards: ['a', 'b'].map((suffix) => ({
      id: `card_${suffix}`,
      deckId: `deck_${suffix}`,
      companyId: 'co_a',
      cardType: 'company',
      title: null,
      summary: null,
      tier: null,
      tierReason: null,
      createdAt: at,
    })),
    viceClaims: [],
    dashboards: {},
    companyMarket: { co_a: 'Market a' },
    reports: [
      {
        id: 'report_a',
        kind: 'deck',
        subjectId: 'deck_a',
        title: 'Original',
        markdown: '```text\nKeep exact prose.\n```',
        citations: [],
        createdAt: at,
      },
    ],
    researchJobs: [{ id: 'job_a', status: 'running' }],
  };
  for (const version of [undefined, 1, 2]) {
    const json = JSON.stringify({
      ...original,
      ...(version === undefined ? {} : { schemaVersion: version }),
    });
    const inspection = inspectLegacySnapshot(json);
    assert.equal(inspection.originalJson, json);
    assert.equal(inspection.source.sha256, createHash('sha256').update(json).digest('hex'));
    assert.equal(inspection.source.schemaVersion, version ?? 1);
    assert.deepEqual(inspection.appliedVersions, version === 2 ? [] : [1]);
    assert.equal(inspection.snapshot.researchJobs[0].status, 'running');
    assert.equal(inspection.proposedAuthority.runnableJobs, 0);
    assert.equal(inspection.proposedAuthority.localAttestations, 0);
    assert.equal(inspection.review.attributedAttestationCount, 1);
    assert.equal(inspection.review.supportedPassageCount, 0);
    assert.equal(inspection.snapshot.metrics[0].value, 0);
    assert.equal(inspection.snapshot.metrics[0].period, '2025');
    assert.equal(inspection.snapshot.reports[0].markdown, original.reports[0].markdown);
    assert.deepEqual(
      inspection.memberships.map((row) => row.marketId),
      ['mkt_a', 'mkt_b'],
    );
    assert.equal(inspection.canApply, false);
  }
  assert.throws(
    () => inspectLegacySnapshot(JSON.stringify({ ...original, schemaVersion: 999 })),
    (error) => error.code === 'UNSUPPORTED_FORMAT',
  );
  const json = JSON.stringify(original);
  assert.throws(
    () => inspectLegacySnapshot(json.replace('"markets":', '"markets":[],"markets":')),
    (error) => error.code === 'DUPLICATE_MEMBER',
  );
  return {
    allKnownFormats: true,
    exactOriginalRetained: true,
    historyNotResumed: true,
    attributionNotAuthority: true,
    sharedMembershipsPreserved: true,
    duplicateAndFutureRejected: true,
  };
}

function openWal(databasePath) {
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0;');
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  return db;
}

async function proveInventoryContext(directory) {
  const file = path.join(directory, 'context.sqlite');
  const vaultId = 'vault_context';
  const at = '2026-09-30T12:00:00.000Z';
  const record = (id, revision = 1) => ({
    contractVersion: '1',
    vaultId,
    id,
    revision,
    createdAt: at,
    updatedAt: at,
  });
  const company = {
    record: record('co_a'),
    name: 'Fixture Labs',
    officialDomain: 'fixture.example',
  };
  const prior = new DatabaseSync(file);
  prior.exec(`BEGIN IMMEDIATE; ${inventorySchemaSql} ${evidenceSchemaSql}
    CREATE TABLE writer_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),generation INTEGER NOT NULL,owner_nonce TEXT) STRICT;
    INSERT INTO writer_state VALUES(1,7,'00000000-0000-0000-0000-000000000007');
    ${researchSchemaSql}`);
  prior.prepare('INSERT INTO vault_meta VALUES(1,?,1)').run(vaultId);
  prior.prepare('INSERT INTO companies VALUES(?,?,?)').run('co_a', 1, JSON.stringify(company));
  prior
    .prepare('INSERT INTO record_history VALUES(?,?,?,?)')
    .run('companies', 'co_a', 1, JSON.stringify(company));
  prior
    .prepare('INSERT INTO company_search VALUES(?,?,?)')
    .run('co_a', company.name, company.officialDomain);
  prior.exec('PRAGMA user_version=4; COMMIT;');
  prior.close();
  const vault = openVault(file, vaultId);
  try {
    assert.equal(vault.status().schemaVersion, 6);
    assert.equal(vault.status().writerGeneration, 8);
    assert.deepEqual(vault.getCompany('co_a'), company);
    assert.deepEqual(vault.companyHistory('co_a').items, [company]);
    const writer = vault.writer();
    const rich = {
      ...company,
      record: record('co_a', 2),
      profile: {
        oneLiner: '  Precision robots\n',
        hqLocation: 'Detroit',
        websiteUrl: 'https://fixture.example/about',
        logoUrl: null,
        brandTheme: null,
      },
      identityHints: { aliases: ['Prior Robotics'], domains: ['prior.example'] },
    };
    writer.saveCompany(rich, 1);
    assert.deepEqual(vault.getCompany('co_a'), rich);
    assert.deepEqual(vault.searchCompanies('Fixture Prior').items, [rich]);
    const scopeDraft = {
      goal: 'Find industrial robot manufacturers',
      inclusions: ['Manufacturers'],
      exclusions: ['Consultants'],
      region: 'US',
      depth: 'standard',
      seeds: [{ companyId: 'co_a', name: 'Fixture Labs' }],
    };
    const market = {
      record: record('mkt_a'),
      name: 'Robotics',
      scopeDraft,
      legacyScope: { vertical: 'Robots', geography: null, notes: 'Original scope' },
    };
    writer.saveMarket(market, 0);
    const edited = {
      ...market,
      record: record('mkt_a', 2),
      scopeDraft: { ...scopeDraft, region: 'Europe', seeds: [] },
    };
    writer.saveMarket(edited, 1);
    assert.deepEqual(vault.getMarket('mkt_a'), edited);
    assert.deepEqual(vault.marketHistory('mkt_a').items, [market, edited]);
    assert.throws(
      () =>
        writer.saveMarket(
          {
            ...market,
            record: record('mkt_bad'),
            scopeDraft: { ...scopeDraft, seeds: [{ companyId: 'co_missing' }] },
          },
          0,
        ),
      /seed/i,
    );
    assert.equal(vault.getMarket('mkt_bad'), null);
    const reader = new DatabaseSync(file, { readOnly: true });
    assert.deepEqual(
      reader
        .prepare('SELECT market_id,market_revision,ordinal,company_id FROM market_scope_seeds')
        .all()
        .map((row) => ({ ...row })),
      [{ market_id: 'mkt_a', market_revision: 1, ordinal: 0, company_id: 'co_a' }],
    );
    reader.close();
    const backupPath = path.join(directory, 'context-backup.sqlite');
    await vault.backup(backupPath);
    const restored = openVault(backupPath, vaultId, 'reader');
    try {
      assert.deepEqual(restored.getCompany('co_a'), rich);
      assert.deepEqual(restored.marketHistory('mkt_a').items, [market, edited]);
    } finally {
      restored.close();
    }
    let canWrite = true;
    const root = path.join(directory, 'assets');
    const assets = openAssetStore(root, () => {
      assert.equal(canWrite, true, 'captured write authority is stale');
    });
    const bytes = Buffer.from('Synthetic local logo asset');
    const ref = assets.publish(bytes);
    assert.deepEqual(assets.read(ref), bytes);
    assert.deepEqual(assets.publish(bytes), ref);
    canWrite = false;
    const late = Buffer.from('late asset');
    assert.throws(() => assets.publish(late), /stale/i);
    assert.equal(
      existsSync(path.join(root, createHash('sha256').update(late).digest('hex'))),
      false,
    );
    writeFileSync(path.join(root, ref.sha256), 'corrupt');
    assert.throws(() => assets.read(ref));
    return {
      v4UpgradeRetained: true,
      companyProfileAndHints: true,
      mixedIdentitySearch: true,
      scopeAndSeedsRetained: true,
      seedForeignKeysAndHistory: true,
      contextBackupReopened: true,
      assetsPublishedAndVerified: true,
      assetLateWriteRejected: true,
      corruptAssetRefused: true,
    };
  } finally {
    vault.close();
  }
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
  // Create a P02-shaped synthetic vault, then prove the real v1 -> v2 -> v3 -> v4 -> v5 -> v6 upgrade.
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
    assert.equal(vault.status().schemaVersion, 6);
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
    const evidenceRef = { sourceId: 'src_a', sourceRevision: 1, passageId: 'pass_a' };
    const claim = {
      record: record('claim_a'),
      companyId: 'co_a',
      scope: { kind: 'company', id: 'co_a' },
      text: 'Synthetic retained company description.',
      eventAt: null,
      origin: 'user_provided',
      support: 'reported',
      evidenceRefs: [evidenceRef],
    };
    vault.saveClaim(claim, 0);
    const marketContent = 'Synthetic market barrier, not an inherited company metric.';
    const marketHash = createHash('sha256').update(marketContent).digest('hex');
    const marketScope = { companyIds: [], marketIds: ['mkt_a'] };
    vault.saveSourceVersion(
      { ...source, id: 'src_market', contentHash: marketHash, visibilityScope: marketScope },
      marketContent,
      0,
    );
    vault.savePassage({
      ...record('pass_market'),
      sourceId: 'src_market',
      sourceRevision: 1,
      text: marketContent,
      contentHash: marketHash,
      origin: 'user_provided',
      visibilityScope: marketScope,
    });
    const marketRef = { sourceId: 'src_market', sourceRevision: 1, passageId: 'pass_market' };
    const finding = {
      record: record('finding_a'),
      marketId: 'mkt_a',
      kind: 'barrier',
      title: 'Synthetic barrier',
      summary: marketContent,
      companyIds: ['co_a'],
      eventAt: null,
      origin: 'user_provided',
      state: 'reported',
      riskStatus: null,
      evidenceRefs: [marketRef],
    };
    vault.saveFinding(finding, 0);
    const report = {
      record: record('report_a'),
      scope: { kind: 'market', id: 'mkt_a' },
      title: 'Synthetic historical report',
      markdown: 'Exact historical prose preserved after later corrections.',
      origin: 'user_provided',
      status: 'completed',
      inputRevisions: [
        { kind: 'company', id: 'co_a', revision: 1 },
        { kind: 'claim', id: 'claim_a', revision: 1 },
        { kind: 'finding', id: 'finding_a', revision: 1 },
        { kind: 'observation', id: 'obs_2025', revision: 1 },
      ],
      evidenceRefs: [evidenceRef, marketRef],
      gaps: [],
    };
    vault.saveReport(report, 0);
    vault.saveClaim(
      { ...claim, record: record('claim_a', 2), text: 'Later company claim version.' },
      1,
    );
    vault.saveFinding(
      { ...finding, record: record('finding_a', 2), summary: 'Later finding version.' },
      1,
    );
    vault.saveReport(
      {
        ...report,
        record: record('report_a', 2),
        markdown: 'Later report, not a rewrite of its predecessor.',
      },
      1,
    );
    assert.deepEqual(vault.getReport('report_a', 1), report);
    assert.deepEqual(vault.getClaim('claim_a', 1), claim);
    assert.deepEqual(vault.getFinding('finding_a', 1), finding);
    assert.throws(
      () =>
        vault.saveReport(
          {
            ...report,
            record: record('report_private_leak'),
            scope: { kind: 'market', id: 'mkt_b' },
          },
          0,
        ),
      /scope|private/i,
    );
    assert.equal(vault.getReport('report_private_leak'), null);
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
    assert.throws(
      () => oldWriter.saveReport({ ...report, record: record('report_a', 3) }, 2),
      /fenced/i,
    );
    const backupPath = path.join(directory, 'inventory-backup.sqlite');
    await vault.backup(backupPath);
    const restored = openVault(backupPath, vaultId, 'reader');
    try {
      assert.deepEqual(restored.getCompany('co_a'), updated);
      assert.deepEqual(restored.getSourceVersion('src_a', 1), { record: source, content });
      assert.equal(restored.getPassage('pass_a').text, content);
      assert.deepEqual(restored.getReport('report_a', 1), report);
      assert.deepEqual(restored.getClaim('claim_a', 1), claim);
      assert.deepEqual(restored.getFinding('finding_a', 1), finding);
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
      retainedResearchVersions: true,
      historicalReportInputs: true,
      privateResearchRejected: true,
    };
  } finally {
    vault.close();
  }
}

async function prepare(directory) {
  const nativeVault = await proveNativeVault(directory);
  const inventoryContext = await proveInventoryContext(directory);
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
    inventoryContext,
    legacyInspection: proveLegacyInspection(),
    legacyRetention: await proveLegacyRetention(directory),
    stagedNavigation: proveStagedNavigation(directory),
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
  owned.writer().saveCompany(
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
  if (mode === 'prepare-preview' && directory) {
    const source = legacyRetentionFixture(2);
    source.cards.push({ ...source.cards[0], id: 'card_z_distribution', cardType: 'distribution' });
    const candidate = stageLegacySnapshot(
      JSON.stringify(source),
      directory,
      'vault_ui_preview',
      '2026-09-30T12:00:00.000Z',
    );
    const sourceBefore = stagedFingerprint(candidate.directory);
    const backup = await createStagedBackup(
      candidate.directory,
      directory,
      '2026-10-01T18:00:00.000Z',
    );
    const backupBefore = stagedFingerprint(backup.directory);
    const backupManifestBefore = createHash('sha256')
      .update(readFileSync(path.join(backup.directory, 'backup.json')))
      .digest('hex');
    const restored = await restoreStagedBackup(
      backup.directory,
      backup.backupHash,
      directory,
      '2026-10-01T18:01:00.000Z',
    );
    assert.deepEqual(stagedFingerprint(candidate.directory), sourceBefore);
    assert.deepEqual(stagedFingerprint(backup.directory), backupBefore);
    assert.equal(
      createHash('sha256')
        .update(readFileSync(path.join(backup.directory, 'backup.json')))
        .digest('hex'),
      backupManifestBefore,
    );
    marker('SQLITE_PREVIEW_READY', {
      directory: restored.directory,
      sourceDirectory: candidate.directory,
      backupDirectory: backup.directory,
      sourceSha256: restored.manifest.sourceSha256,
      backupHash: restored.backupHash,
      lifecycleRestored: true,
      sourceCandidatePreservedByLifecycle: true,
      backupPreservedByRestore: true,
    });
    return;
  }
  if (
    !directory ||
    !['prepare', 'crash', 'contend', 'recover', 'stage-crash', 'stage-recover'].includes(mode)
  )
    throw new Error('invalid sqlite spike worker arguments');
  if (mode === 'prepare') await prepare(directory);
  else if (mode === 'crash') crash(directory);
  else if (mode === 'contend') contend(directory);
  else if (mode === 'stage-crash') stageCrash(directory);
  else if (mode === 'stage-recover') stageRecover(directory);
  else recover(directory);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
