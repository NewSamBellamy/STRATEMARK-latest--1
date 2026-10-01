import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import type * as NodeSqlite from 'node:sqlite';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openVault } from './vault';
import { legacyRetentionFixture, minimalLegacyJobFixture } from './legacy-retention-fixture';
const { DatabaseSync } = createRequire(process.execPath)('node:sqlite') as typeof NodeSqlite;

type RetentionApi = ReturnType<typeof openVault>;
type RetainedItem = ReturnType<RetentionApi['readLegacyRecords']>['items'][number];
type LegacyFamily = RetainedItem['family'];

const families: LegacyFamily[] = [
  'markets',
  'decks',
  'companies',
  'metrics',
  'cards',
  'viceClaims',
  'dashboards',
  'companyMarket',
  'reports',
  'briefings',
  'savedCards',
  'opportunity',
  'researchJobs',
  'threads',
];
const directories: string[] = [];
const handles: ReturnType<typeof openVault>[] = [];

function createVault() {
  const directory = mkdtempSync(path.join(tmpdir(), 'stratemark-legacy-retention-'));
  directories.push(directory);
  const file = path.join(directory, 'vault.sqlite');
  const vault = openVault(file, 'vault_legacy');
  handles.push(vault);
  return {
    file,
    vault,
    api: vault,
  };
}

function retain(api: RetentionApi, value: unknown, revision = 0) {
  const json = JSON.stringify(value);
  const manifest = api.writer().retainLegacySnapshot(json, revision);
  return { json, manifest };
}

function expectedCounts(source: ReturnType<typeof legacyRetentionFixture>) {
  return {
    markets: source.markets.length,
    decks: source.decks.length,
    companies: source.companies.length,
    metrics: source.metrics.length,
    cards: source.cards.length,
    viceClaims: source.viceClaims.length,
    dashboards: Object.keys(source.dashboards).length,
    dashboardTabs: Object.values(source.dashboards).reduce(
      (count, tabs) => count + Object.keys(tabs).length,
      0,
    ),
    companyMarket: Object.keys(source.companyMarket).length,
    reports: source.reports.length,
    briefings: source.briefings.length,
    savedCards: source.savedCards.length,
    opportunity: Object.keys(source.opportunity).length,
    researchJobs: source.researchJobs.length,
    threads: source.threads.length,
  };
}

function readAll(api: RetentionApi, hash: string, family: LegacyFamily) {
  const items: RetainedItem[] = [];
  let afterOrdinal: number | undefined;
  while (true) {
    const page = api.readLegacyRecords(hash, family, { limit: 2, afterOrdinal });
    items.push(...page.items);
    if (page.nextOrdinal === null) return items;
    afterOrdinal = page.nextOrdinal;
  }
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe('offline retained legacy snapshots (passive staging only)', () => {
  it.each([undefined, 1, 2] as const)(
    'round-trips schema version %s and retains raw nested history',
    (version) => {
      const source = legacyRetentionFixture(version);
      const { api, vault } = createVault();
      const { json, manifest } = retain(api, source);

      expect(manifest).toMatchObject({
        sourceSha256: createHash('sha256').update(json).digest('hex'),
        sourceSchemaVersion: version ?? 1,
        sourceByteLength: Buffer.byteLength(json),
        authority: 'disabled',
        counts: expectedCounts(source),
      });
      expect(manifest.retainedRecordCount).toBe(
        families.reduce((sum, family) => sum + expectedCounts(source)[family], 0),
      );
      expect(manifest.warnings).toEqual(expect.arrayContaining(['authority_disabled']));

      const exported = JSON.parse(api.exportLegacySnapshot(manifest.sourceSha256));
      expect(exported).toEqual(source);
      expect(exported.researchJobs[0].status).toBe('running');
      expect(exported.researchJobs[0].partialCards[0].nestedPartialResult).toEqual(
        source.researchJobs[0]!.partialCards[0]!.nestedPartialResult,
      );
      expect(exported.metrics[0].period).toBe('FY2025');
      expect(exported.metrics[0].conflictHistory[0].period).toBe('FY2024');
      expect(exported.dashboards.co_shared.metrics.content.selectedPeriod).toBe('FY2025');
      expect(exported.threads[0].reportId).toBe(exported.reports[0].id);
      expect(exported.savedCards[0].cardId).toBe(exported.cards[0].id);
      expect(exported.cards.map((card: { companyId: string }) => card.companyId)).toEqual([
        'co_shared',
        'co_shared',
        'co_shared',
      ]);
      expect(exported.decks.map((deck: { marketId: string }) => deck.marketId)).toEqual([
        'mkt_a',
        'mkt_b',
      ]);
      expect(Object.hasOwn(exported, 'schemaVersion')).toBe(version !== undefined);

      const verification = api.verifyLegacySnapshot(manifest.sourceSha256);
      expect(verification).toMatchObject({
        sourceSha256: manifest.sourceSha256,
        counts: expectedCounts(source),
        authority: 'disabled',
        canApply: false,
      });
      expect(verification.review).toEqual(expect.objectContaining({ activeJobCount: 1 }));
      expect(verification.proposedAuthority).toEqual(
        expect.objectContaining({ runnableJobs: 0, requiresFreshApproval: true }),
      );
      expect(vault.status().revision).toBe(manifest.vaultRevision);
    },
  );

  it('retains each of the fourteen families as bounded raw payload records', () => {
    const source = legacyRetentionFixture(2);
    const { api } = createVault();
    const { manifest } = retain(api, source);
    const expected = expectedCounts(source);

    for (const family of families) {
      const items = readAll(api, manifest.sourceSha256, family);
      expect(items).toHaveLength(expected[family]);
      expect(items.every((item) => item.family === family)).toBe(true);
      expect(items.every((item) => item.authority === 'disabled')).toBe(true);
      expect(items.every((item) => item.sourceSha256 === manifest.sourceSha256)).toBe(true);
      expect(items.map((item) => item.ordinal)).toEqual(items.map((_, ordinal) => ordinal));
    }
    const jobs = readAll(api, manifest.sourceSha256, 'researchJobs');
    expect(JSON.stringify(jobs)).toContain('nestedPartialResult');
    expect(JSON.stringify(jobs)).toContain('job-only');
    expect(readAll(api, manifest.sourceSha256, 'reports')).toHaveLength(1);
    expect(readAll(api, manifest.sourceSha256, 'threads')).toHaveLength(1);
  });

  it('reopens through a read-only offline handle and does not promote imported records', () => {
    const source = legacyRetentionFixture(2);
    const { file, api, vault } = createVault();
    const { manifest } = retain(api, source);
    vault.close();

    const reader = openVault(file, 'vault_legacy', 'reader');
    handles.push(reader);
    const readApi = reader;
    expect(readApi.exportLegacySnapshot(manifest.sourceSha256)).toBe(JSON.stringify(source));
    expect(reader.getCompany('co_shared')).toBeNull();
    expect(reader.getMarket('mkt_a')).toBeNull();
    expect(reader.searchCompanies('Synthetic').items).toEqual([]);
    expect(reader.getObservation('metric_a')).toBeNull();
    expect(reader.listReports({ kind: 'market', id: 'mkt_a' }, { limit: 10 }).items).toEqual([]);
    expect(reader.listClaims('co_shared', { limit: 10 }).items).toEqual([]);
    expect(reader.listFindings('mkt_a', { limit: 10 }).items).toEqual([]);
    expect(
      readApi.readLegacyRecords(manifest.sourceSha256, 'researchJobs').items[0]?.payload,
    ).toBeDefined();
    expect(() => readApi.writer()).toThrow(/read.only/i);
  });

  it('keeps absent optional families absent for a minimal older running-job export', () => {
    const source = minimalLegacyJobFixture(1);
    const { api } = createVault();
    const { manifest } = retain(api, source);
    const exported = JSON.parse(api.exportLegacySnapshot(manifest.sourceSha256));

    expect(exported).toEqual(source);
    for (const family of [
      'reports',
      'briefings',
      'savedCards',
      'threads',
      'opportunity',
      'dashboards',
      'companyMarket',
      'viceClaims',
    ])
      expect(Object.hasOwn(exported, family)).toBe(false);
    expect(exported.researchJobs[0]).toEqual(source.researchJobs[0]);
    expect(manifest.counts).toMatchObject({ reports: 0, opportunity: 0, threads: 0 });
  });

  it('bounds pages, preserves stable ordinals, and reports a consistent vault revision', () => {
    const source = legacyRetentionFixture(2);
    const { api } = createVault();
    const { manifest } = retain(api, source);
    const first = api.readLegacyRecords(manifest.sourceSha256, 'cards', { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.ordinal).toBe(0);
    expect(first.nextOrdinal).toBe(0);
    const second = api.readLegacyRecords(manifest.sourceSha256, 'cards', {
      limit: 1,
      afterOrdinal: first.nextOrdinal!,
    });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.ordinal).toBe(1);
    expect(second.vaultRevision).toBe(first.vaultRevision);
    expect(() => api.readLegacyRecords(manifest.sourceSha256, 'cards', { limit: 101 })).toThrow();
  });

  it('returns a sanitized not-found error for an unknown source hash', () => {
    const { api } = createVault();
    const missingHash = 'a'.repeat(64);
    for (const lookup of [
      () => api.readLegacyRecords(missingHash, 'cards'),
      () => api.verifyLegacySnapshot(missingHash),
      () => api.exportLegacySnapshot(missingHash),
    ]) {
      try {
        lookup();
        throw new Error('Missing source unexpectedly resolved.');
      } catch (error) {
        expect(String(error)).toMatch(/not found/i);
        expect(String(error)).not.toContain(missingHash);
      }
    }
  });

  it('is idempotent by exact source bytes even with a stale expected vault revision', () => {
    const source = legacyRetentionFixture(2);
    const { api, vault } = createVault();
    const json = JSON.stringify(source);
    const first = api.writer().retainLegacySnapshot(json, vault.status().revision);
    const afterFirst = vault.status().revision;
    const duplicate = api.writer().retainLegacySnapshot(json, 0);

    expect(duplicate.sourceSha256).toBe(first.sourceSha256);
    expect(duplicate.vaultRevision).toBe(afterFirst);
    expect(vault.status().revision).toBe(afterFirst);
  });

  it('keeps distinct original-byte hashes side by side and rejects a stale revision for new bytes', () => {
    const source = legacyRetentionFixture(2);
    const { api, vault } = createVault();
    const first = api.writer().retainLegacySnapshot(JSON.stringify(source), 0);
    const secondJson = ` ${JSON.stringify(source)}\n`;
    const second = api.writer().retainLegacySnapshot(secondJson, first.vaultRevision);
    expect(second.sourceSha256).not.toBe(first.sourceSha256);
    expect(api.exportLegacySnapshot(first.sourceSha256)).toBe(JSON.stringify(source));
    expect(JSON.parse(api.exportLegacySnapshot(second.sourceSha256))).toEqual(source);
    const revision = vault.status().revision;
    expect(() => api.writer().retainLegacySnapshot(`\n${JSON.stringify(source)}`, 0)).toThrow(
      /revision/i,
    );
    expect(vault.status().revision).toBe(revision);
  });

  it('rejects malformed, future, credential-bearing and dangling-link input without partial writes', () => {
    const { api, vault } = createVault();
    const before = vault.status().revision;
    const valid = legacyRetentionFixture(2);
    const dangling = structuredClone(valid);
    dangling.savedCards[0]!.cardId = 'missing_card';
    const credential = { ...valid, metadata: { apiKey: 'synthetic-placeholder' } };

    for (const input of [
      '{"markets":',
      JSON.stringify({ ...valid, schemaVersion: 0 }),
      JSON.stringify({ ...valid, schemaVersion: 3 }),
      JSON.stringify(credential),
      JSON.stringify(dangling),
    ])
      expect(() => api.writer().retainLegacySnapshot(input, before)).toThrow();
    expect(vault.status().revision).toBe(before);
    expect(() =>
      api.readLegacyRecords(
        createHash('sha256').update(JSON.stringify(valid)).digest('hex'),
        'cards',
      ),
    ).toThrow(/not found/i);
  });

  it('fences a captured writer before parsing a malformed source', () => {
    const { api, vault } = createVault();
    const captured = api.writer();
    vault.advanceWriterGeneration();
    expect(() => captured.retainLegacySnapshot('{ malformed', 0)).toThrow(/fenc|generation|owner/i);
    expect(vault.status().revision).toBe(0);
  });
  it('rolls back every family and source metadata after a late SQLite write failure', () => {
    const { file, api, vault } = createVault();
    const source = legacyRetentionFixture(2);
    const json = JSON.stringify(source);
    const hash = createHash('sha256').update(json).digest('hex');
    const fault = new DatabaseSync(file);
    try {
      fault.exec(
        "CREATE TRIGGER fail_legacy_threads BEFORE INSERT ON legacy_threads BEGIN SELECT RAISE(ABORT,'Synthetic disk failure'); END;",
      );
      expect(() => api.writer().retainLegacySnapshot(json, 0)).toThrow(/Synthetic disk failure/i);
      expect(vault.status().revision).toBe(0);
      expect(fault.prepare('SELECT count(*) AS n FROM legacy_sources').get()?.n).toBe(0);
      for (const family of families)
        expect(fault.prepare(`SELECT count(*) AS n FROM legacy_${family}`).get()?.n).toBe(0);
      expect(() => api.exportLegacySnapshot(hash)).toThrow(/not found/i);
      fault.exec('DROP TRIGGER fail_legacy_threads;');
      expect(api.writer().retainLegacySnapshot(json, 0).vaultRevision).toBe(1);
    } finally {
      fault.close();
    }
  });
  it('keeps immutable imported history and refuses checksum-damaged records on read/export', () => {
    const { file, api } = createVault();
    const { manifest } = retain(api, legacyRetentionFixture(2));
    const fault = new DatabaseSync(file);
    try {
      expect(() => fault.exec('DELETE FROM legacy_reports')).toThrow(/append-only/i);
      expect(() => fault.exec("UPDATE legacy_researchJobs SET body='{}' ")).toThrow(/append-only/i);
      const guardSql = String(
        fault.prepare("SELECT sql FROM sqlite_schema WHERE name='legacy_reports_no_update'").get()
          ?.sql,
      );
      fault.exec('DROP TRIGGER legacy_reports_no_update;');
      fault
        .prepare('UPDATE legacy_reports SET body=? WHERE source_sha=?')
        .run('{"id":"report_a","markdown":"corrupt"}', manifest.sourceSha256);
      fault.exec(guardSql);
      expect(() => api.readLegacyRecords(manifest.sourceSha256, 'reports')).toThrow(/checksum/i);
      expect(() => api.exportLegacySnapshot(manifest.sourceSha256)).toThrow(/checksum/i);
      expect(() => api.verifyLegacySnapshot(manifest.sourceSha256)).toThrow(/checksum/i);
    } finally {
      fault.close();
    }
  });
  it('recovers the exact saved historical content from a consistent native backup', async () => {
    const { file, api, vault } = createVault();
    const source = legacyRetentionFixture(2);
    const first = retain(api, source).manifest;
    const backup = path.join(path.dirname(file), 'backup.sqlite');
    await vault.backup(backup);
    const second = api
      .writer()
      .retainLegacySnapshot(`\n${JSON.stringify(source)}`, first.vaultRevision);
    const reader = openVault(backup, 'vault_legacy', 'reader');
    handles.push(reader);
    expect(JSON.parse(reader.exportLegacySnapshot(first.sourceSha256))).toEqual(source);
    expect(reader.verifyLegacySnapshot(first.sourceSha256)).toMatchObject({
      authority: 'disabled',
      canApply: false,
    });
    expect(reader.status().revision).toBe(first.vaultRevision);
    expect(() => reader.verifyLegacySnapshot(second.sourceSha256)).toThrow(/not found/i);
    expect(reader.integrity()).toBe('ok');
  });
  it('rediscovers retained imports after reopen through a bounded inactive-source catalogue', () => {
    const { file, api, vault } = createVault();
    const source = legacyRetentionFixture(2);
    const first = retain(api, source).manifest;
    const second = api
      .writer()
      .retainLegacySnapshot(`\n${JSON.stringify(source)}`, first.vaultRevision);
    vault.close();
    const reader = openVault(file, 'vault_legacy', 'reader');
    handles.push(reader);
    const ordered = [first.sourceSha256, second.sourceSha256].sort();
    const page = reader.listLegacySnapshots({ limit: 1 });
    expect(page.items.map((item) => item.sourceSha256)).toEqual(ordered.slice(0, 1));
    expect(page.nextCursor).toBe(ordered[0]);
    expect(page.items[0]).toMatchObject({ authority: 'disabled', verification: 'not_checked' });
    const next = reader.listLegacySnapshots({ limit: 1, afterSourceSha256: page.nextCursor! });
    expect(next.items.map((item) => item.sourceSha256)).toEqual(ordered.slice(1));
    expect(next.nextCursor).toBeNull();
    expect(next.vaultRevision).toBe(page.vaultRevision);
    expect(() => reader.listLegacySnapshots({ limit: 101 })).toThrow();
  });
  it('caps record-page bytes without dropping a large original report from trusted export', () => {
    const { api } = createVault();
    const source = legacyRetentionFixture(2);
    source.reports[0]!.markdown = 'x'.repeat(9 * 1024 * 1024);
    const { manifest } = retain(api, source);
    expect(() => api.readLegacyRecords(manifest.sourceSha256, 'reports')).toThrow(/page.*byte/i);
    expect(JSON.parse(api.exportLegacySnapshot(manifest.sourceSha256)).reports[0].markdown).toBe(
      source.reports[0]!.markdown,
    );
  });
});
