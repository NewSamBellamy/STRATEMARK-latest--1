/** Synthetic local evidence only; retained hashes are real, not evidence of provider quality. */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import type * as NodeSqlite from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openVault as openNativeVault } from './vault';

const { DatabaseSync } = createRequire(process.execPath)('node:sqlite') as typeof NodeSqlite;
const AT = '2026-09-30T12:00:00.000Z';
const text = 'Synthetic fixture. Revenue was 10 USD in 2025. End of fixture.';
const quote = 'Revenue was 10 USD in 2025.';
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const version = (id: string, revision = 1) => ({
  contractVersion: '1' as const,
  vaultId: 'vault_fixture',
  id,
  revision,
  createdAt: AT,
  updatedAt: AT,
});
const source = (revision = 1) => ({
  ...version('src_a', revision),
  canonicalUrl: 'https://a.example/report',
  originalUrl: 'https://a.example/report',
  contentHash: sha(text),
  fetchedAt: AT,
  publishedAt: '2026-01-01T00:00:00Z',
  eventAt: '2025-12-31T00:00:00Z',
  retrievalStatus: 'retrieved' as const,
  origin: 'web' as const,
  visibilityScope: { companyIds: ['co_a'], marketIds: ['mkt_a'] },
});
const passage = () => ({
  ...version('pass_a'),
  sourceId: 'src_a',
  sourceRevision: 1,
  text: quote,
  contentHash: sha(quote),
  origin: 'web' as const,
  visibilityScope: { companyIds: ['co_a'], marketIds: ['mkt_a'] },
});
const metric = () => ({
  record: version('annual_revenue'),
  label: 'Annual revenue',
  description: 'Revenue reported for the annual interval, not funding or valuation.',
  unit: 'money',
  currencyMode: 'required' as const,
  scopeKind: 'company' as const,
  periodKind: 'interval' as const,
});
const observation = (id = 'obs_a') => ({
  ...version(id),
  companyId: 'co_a',
  metricDefinitionId: 'annual_revenue',
  scope: { kind: 'company' as const, id: 'co_a' },
  unit: 'money',
  currency: 'USD',
  period: {
    kind: 'interval' as const,
    startAt: '2025-01-01T00:00:00Z',
    endAt: '2025-12-31T23:59:59Z',
  },
  value: 10,
  support: 'supported' as const,
  evidenceRefs: [{ sourceId: 'src_a', sourceRevision: 1, passageId: 'pass_a' }],
});
const directories: string[] = [];
const handles: ReturnType<typeof openNativeVault>[] = [];
type TestVault = ReturnType<typeof openNativeVault> &
  ReturnType<ReturnType<typeof openNativeVault>['writer']>;
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'stratemark-evidence-test-'));
  directories.push(directory);
  const file = path.join(directory, 'vault.sqlite');
  const handle = openNativeVault(file, 'vault_fixture');
  handles.push(handle);
  const vault = { ...handle, ...handle.writer() };
  vault.saveCompany(
    { record: version('co_a'), name: 'Fixture Labs', officialDomain: 'a.example' },
    0,
  );
  vault.saveCompany(
    { record: version('co_b'), name: 'Other Fixture', officialDomain: 'b.example' },
    0,
  );
  for (const id of ['mkt_a', 'mkt_b']) vault.saveMarket({ record: version(id), name: id }, 0);
  vault.saveMembership(
    { record: version('mem_a'), companyId: 'co_a', marketId: 'mkt_a', roles: ['company'] },
    0,
  );
  return { file, directory, vault };
}
function seed(vault: TestVault) {
  vault.saveSourceVersion(source(), text, 0);
  vault.savePassage(passage());
  vault.saveMetricDefinition(metric());
}
afterEach(() => {
  for (const vault of handles.splice(0)) vault.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe('offline retained evidence vault (no service cutover)', () => {
  it('retains exact source content, dates, passage, and observation across reopen and backup', async () => {
    const { file, directory, vault } = fixture();
    seed(vault);
    vault.saveObservation(observation());
    const destination = path.join(directory, 'backup.sqlite');
    await vault.backup(destination);
    vault.close();
    for (const candidate of [file, destination]) {
      const reader = openNativeVault(candidate, 'vault_fixture');
      handles.push(reader);
      expect(reader.getSourceVersion('src_a', 1)).toEqual({ record: source(), content: text });
      expect(reader.getPassage('pass_a')).toEqual(passage());
      expect(reader.listObservations('co_a').items).toEqual([observation()]);
      expect(reader.integrity()).toBe('ok');
    }
  });
  it('rejects false source hashes and oversized retained content without a write', () => {
    const { vault } = fixture();
    const before = vault.status().revision;
    expect(() =>
      vault.saveSourceVersion({ ...source(), contentHash: 'a'.repeat(64) }, text, 0),
    ).toThrow(/hash/i);
    const huge = 'x'.repeat(2_000_001);
    expect(() => vault.saveSourceVersion({ ...source(), contentHash: sha(huge) }, huge, 0)).toThrow(
      /content|bound/i,
    );
    expect(vault.getSourceVersion('src_a', 1)).toBeNull();
    expect(vault.status().revision).toBe(before);
  });
  it('preserves failed retrieval honestly and cannot manufacture a passage for it', () => {
    const { vault } = fixture();
    const failed = { ...source(), retrievalStatus: 'failed' as const, contentHash: null };
    vault.saveSourceVersion(failed, null, 0);
    expect(vault.getSourceVersion('src_a', 1)).toEqual({ record: failed, content: null });
    expect(() => vault.savePassage(passage())).toThrow(/retained|content/i);
    expect(() =>
      vault.saveSourceVersion(
        { ...failed, ...version('src_bad'), contentHash: sha(text) },
        text,
        0,
      ),
    ).toThrow();
  });
  it('stores private evidence without inventing a public URL', () => {
    const { vault } = fixture();
    const privateSource = {
      ...source(),
      origin: 'user_provided' as const,
      canonicalUrl: null,
      originalUrl: null,
    };
    vault.saveSourceVersion(privateSource, text, 0);
    vault.savePassage({ ...passage(), origin: 'user_provided' });
    expect(vault.getSourceVersion('src_a', 1)?.record).toEqual(privateSource);
  });
  it('appends source versions, keeps old passage links exact, and rejects stale revisions', () => {
    const { vault } = fixture();
    seed(vault);
    const second = { ...vault, ...vault.writer() };
    const nextText = `${text} Later retrieval.`;
    second.saveSourceVersion({ ...source(2), contentHash: sha(nextText) }, nextText, 1);
    expect(() => vault.saveSourceVersion(source(2), text, 1)).toThrow(/revision/i);
    expect(vault.getSourceVersion('src_a', 1)?.content).toBe(text);
    expect(vault.getPassage('pass_a')?.sourceRevision).toBe(1);
  });
  it('rejects invented quotes, wrong hashes, and wrong origins', () => {
    const { vault } = fixture();
    vault.saveSourceVersion(source(), text, 0);
    expect(() =>
      vault.savePassage({ ...passage(), text: 'Fabricated.', contentHash: sha('Fabricated.') }),
    ).toThrow(/passage|content/i);
    expect(() => vault.savePassage({ ...passage(), contentHash: 'b'.repeat(64) })).toThrow(/hash/i);
    expect(() => vault.savePassage({ ...passage(), origin: 'imported' })).toThrow(/origin/i);
    expect(vault.getPassage('pass_a')).toBeNull();
  });
  it('rejects missing source versions and wider passage visibility', () => {
    const { vault } = fixture();
    vault.saveSourceVersion(source(), text, 0);
    expect(() => vault.savePassage({ ...passage(), sourceRevision: 2 })).toThrow();
    expect(() =>
      vault.savePassage({
        ...passage(),
        visibilityScope: { companyIds: ['co_b'], marketIds: ['mkt_b'] },
      }),
    ).toThrow(/scope/i);
    expect(() =>
      vault.saveSourceVersion(
        {
          ...source(),
          ...version('src_bad'),
          visibilityScope: { companyIds: ['missing'], marketIds: [] },
        },
        text,
        0,
      ),
    ).toThrow();
  });
  it('rejects dangling evidence and a passage/source tuple mismatch atomically', () => {
    const { vault } = fixture();
    seed(vault);
    vault.saveSourceVersion(source(2), text, 1);
    const before = vault.status().revision;
    expect(() =>
      vault.saveObservation({
        ...observation(),
        evidenceRefs: [{ sourceId: 'src_a', sourceRevision: 2, passageId: 'pass_a' }],
      }),
    ).toThrow(/evidence|source/i);
    expect(() =>
      vault.saveObservation({
        ...observation(),
        evidenceRefs: [{ sourceId: 'src_a', sourceRevision: 1, passageId: 'missing' }],
      }),
    ).toThrow();
    expect(vault.listObservations('co_a').items).toEqual([]);
    expect(vault.status().revision).toBe(before);
  });
  it('does not expand private company evidence into another company dossier', () => {
    const { vault } = fixture();
    seed(vault);
    expect(() =>
      vault.saveObservation({
        ...observation(),
        companyId: 'co_b',
        scope: { kind: 'company', id: 'co_b' },
      }),
    ).toThrow(/scope/i);
  });
  it('allows market-scoped evidence only for the selected market and its member company', () => {
    const { vault } = fixture();
    vault.saveSourceVersion(
      { ...source(), visibilityScope: { companyIds: [], marketIds: ['mkt_a'] } },
      text,
      0,
    );
    vault.savePassage({ ...passage(), visibilityScope: { companyIds: [], marketIds: ['mkt_a'] } });
    vault.saveMetricDefinition({ ...metric(), scopeKind: 'market' });
    const marketObservation = { ...observation(), scope: { kind: 'market' as const, id: 'mkt_a' } };
    vault.saveObservation(marketObservation);
    expect(() =>
      vault.saveObservation({ ...marketObservation, ...version('obs_bad'), companyId: 'co_b' }),
    ).toThrow(/market|member/i);
    expect(() =>
      vault.saveObservation({
        ...marketObservation,
        ...version('obs_other'),
        scope: { kind: 'market', id: 'mkt_b' },
      }),
    ).toThrow();
  });
  it('requires an immutable metric definition and preserves unknowns instead of zero filling', () => {
    const { vault } = fixture();
    seed(vault);
    expect(vault.getMetricDefinition('annual_revenue')).toEqual(metric());
    expect(vault.getMetricDefinition('missing')).toBeNull();
    expect(() => vault.saveMetricDefinition({ ...metric(), label: 'Funding' })).toThrow(
      /immutable|exist/i,
    );
    expect(() =>
      vault.saveObservation({ ...observation(), metricDefinitionId: 'missing' }),
    ).toThrow();
    expect(() => vault.saveObservation({ ...observation(), unit: 'count' })).toThrow(
      /definition|unit/i,
    );
    expect(() => vault.saveObservation({ ...observation(), currency: null })).toThrow(/currency/i);
    const unknown = {
      ...observation(),
      value: null,
      support: 'unknown' as const,
      evidenceRefs: [],
      period: { kind: 'unknown' as const },
    };
    vault.saveObservation(unknown);
    expect(vault.listObservations('co_a').items).toEqual([unknown]);
  });
  it('keeps different periods, same-period competing observations, and zero values distinct', () => {
    const { vault } = fixture();
    seed(vault);
    const first = observation('obs_a');
    const competing = { ...observation('obs_b'), value: 0 };
    const later = {
      ...observation('obs_c'),
      period: {
        kind: 'interval' as const,
        startAt: '2026-01-01T00:00:00Z',
        endAt: '2026-12-31T23:59:59Z',
      },
      value: 20,
    };
    for (const item of [first, competing, later]) vault.saveObservation(item);
    expect(vault.listObservations('co_a').items).toEqual([first, competing, later]);
    const comparable = vault.comparableObservations('obs_a');
    expect(comparable.items).toEqual([first, competing]);
    expect(comparable.hasDifferentValues).toBe(true);
    expect(vault.listObservations('co_a', { limit: 2 }).nextCursor).toBe('obs_b');
    expect(vault.listObservations('co_a', { afterId: 'obs_b', limit: 2 }).items).toEqual([later]);
  });
  it('rejects machine attestation and incompatible scope/period definitions', () => {
    const { vault } = fixture();
    seed(vault);
    expect(() => vault.saveObservation({ ...observation(), support: 'user_verified' })).toThrow();
    expect(() =>
      vault.saveObservation({ ...observation(), scope: { kind: 'company', id: 'co_b' } }),
    ).toThrow();
    expect(() =>
      vault.saveObservation({ ...observation(), period: { kind: 'instant', at: AT } }),
    ).toThrow(/definition|period/i);
  });
  it('prevents overwriting/deleting retained evidence even through a direct SQL handle', () => {
    const { file, vault } = fixture();
    seed(vault);
    vault.saveObservation(observation());
    const db = new DatabaseSync(file);
    try {
      for (const table of [
        'source_versions',
        'passages',
        'metric_definitions',
        'observations',
        'observation_evidence',
      ]) {
        expect(() => db.exec(`DELETE FROM ${table}`)).toThrow(/append-only/i);
        const column = table === 'observation_evidence' ? 'observation_id' : 'id';
        expect(() => db.exec(`UPDATE ${table} SET ${column}=${column}`)).toThrow(/append-only/i);
      }
    } finally {
      db.close();
    }
    expect(vault.listObservations('co_a').items).toEqual([observation()]);
  });
  it('refuses source metadata tampering and corrupted retained content on read', () => {
    const { file, vault } = fixture();
    seed(vault);
    vault.close();
    const db = new DatabaseSync(file);
    db.exec('DROP TRIGGER source_versions_no_update');
    db.prepare('UPDATE source_versions SET content=? WHERE id=?').run('tampered', 'src_a');
    db.close();
    const reader = openNativeVault(file, 'vault_fixture');
    handles.push(reader);
    expect(() => reader.getSourceVersion('src_a', 1)).toThrow(/hash/i);
  });
  it('rejects a foreign vault source with no mutations', () => {
    const { file, vault } = fixture();
    vault.close();
    const handle = openNativeVault(file, 'vault_fixture');
    handles.push(handle);
    const writer = { ...handle, ...handle.writer() };
    // Reopening intentionally advances ownership. Capture DB + WAL AFTER that
    // accepted change, then prove the rejected command changes neither file.
    const files = [file, `${file}-wal`];
    const hashes = () =>
      files.map((candidate) => createHash('sha256').update(readFileSync(candidate)).digest('hex'));
    const before = hashes();
    const beforeRevision = writer.status().revision;
    expect(() =>
      writer.saveSourceVersion({ ...source(), vaultId: 'vault_other' }, text, 0),
    ).toThrow(/vault/i);
    expect(hashes()).toEqual(before);
    expect(writer.status().revision).toBe(beforeRevision);
    expect(writer.getSourceVersion('src_a', 1)).toBeNull();
    writer.close();
  });
  it('bounds source content by UTF-8 bytes and refuses lossy Unicode retention', () => {
    const { vault } = fixture();
    const multibyte = 'é'.repeat(1_000_001);
    expect(() =>
      vault.saveSourceVersion({ ...source(), contentHash: sha(multibyte) }, multibyte, 0),
    ).toThrow(/bound/i);
    const lossy = '\ud800';
    expect(() =>
      vault.saveSourceVersion({ ...source(), contentHash: sha(lossy) }, lossy, 0),
    ).toThrow(/UTF-8|Unicode/i);
  });
  it('does not overwrite a passage or observation and cannot compare unknown periods', () => {
    const { vault } = fixture();
    seed(vault);
    vault.saveObservation(observation());
    const before = vault.status().revision;
    expect(() => vault.savePassage(passage())).toThrow();
    expect(() => vault.saveObservation({ ...observation(), value: 0 })).toThrow();
    expect(vault.status().revision).toBe(before);
    const unknown = {
      ...observation('obs_unknown'),
      period: { kind: 'unknown' },
      support: 'unknown',
      value: null,
      evidenceRefs: [],
    };
    vault.saveObservation(unknown);
    expect(vault.comparableObservations('obs_unknown')).toMatchObject({
      items: [],
      nextCursor: null,
      hasDifferentValues: false,
    });
  });
});
