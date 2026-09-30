import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openVault } from './vault';
import type { ClaimRecord, FindingRecord, ReportRecord } from '@mi/contracts';

const at = '2026-09-30T12:00:00Z';
const directories: string[] = [];
const handles: ReturnType<typeof openVault>[] = [];
const record = (id: string, revision = 1) => ({
  contractVersion: '1' as const,
  vaultId: 'vault_a',
  id,
  revision,
  createdAt: at,
  updatedAt: at,
});
const reference = (suffix: string) => ({
  sourceId: `src_${suffix}`,
  sourceRevision: 1,
  passageId: `pass_${suffix}`,
});
const claim = (revision = 1): ClaimRecord => ({
  record: record('claim_a', revision),
  companyId: 'co_a',
  scope: { kind: 'company', id: 'co_a' },
  text: 'Synthetic product description.',
  eventAt: null,
  origin: 'user_provided',
  support: 'supported',
  evidenceRefs: [reference('company')],
});
const finding = (revision = 1): FindingRecord => ({
  record: record('finding_a', revision),
  marketId: 'mkt_a',
  kind: 'barrier',
  title: 'Synthetic barrier',
  summary: 'Synthetic market barrier.',
  companyIds: ['co_a'],
  eventAt: null,
  origin: 'user_provided',
  state: 'reported',
  riskStatus: null,
  evidenceRefs: [reference('market')],
});
const report = (revision = 1): ReportRecord => ({
  record: record('report_a', revision),
  scope: { kind: 'market', id: 'mkt_a' },
  title: 'Synthetic report',
  markdown: 'Exact historical report content.',
  origin: 'user_provided',
  status: 'completed',
  inputRevisions: [
    { kind: 'company', id: 'co_a', revision: 1 },
    { kind: 'claim', id: 'claim_a', revision: 1 },
    { kind: 'finding', id: 'finding_a', revision: 1 },
  ],
  evidenceRefs: [reference('company'), reference('market')],
  gaps: [],
});
function track(file: string, mode: 'owner' | 'reader' = 'owner') {
  const handle = openVault(file, 'vault_a', mode);
  handles.push(handle);
  return handle;
}
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'stratemark-research-store-'));
  directories.push(directory);
  const file = path.join(directory, 'vault.sqlite');
  const vault = track(file);
  const writer = vault.writer();
  for (const companyId of ['co_a', 'co_b'])
    writer.saveCompany(
      {
        record: record(companyId),
        name: companyId,
        officialDomain: `${companyId.slice(3)}.example`,
      },
      0,
    );
  for (const marketId of ['mkt_a', 'mkt_b']) {
    writer.saveMarket({ record: record(marketId), name: marketId }, 0);
    writer.saveMembership(
      { record: record(`mem_${marketId}`), companyId: 'co_a', marketId, roles: ['company'] },
      0,
    );
  }
  for (const [suffix, companyIds, marketIds] of [
    ['company', ['co_a'], []],
    ['market', [], ['mkt_a']],
  ] as const) {
    const text = 'Synthetic retained source with product description and market barrier.';
    writer.saveSourceVersion(
      {
        ...record(`src_${suffix}`),
        canonicalUrl: null,
        originalUrl: null,
        contentHash: createHash('sha256').update(text).digest('hex'),
        fetchedAt: at,
        publishedAt: null,
        eventAt: null,
        retrievalStatus: 'retrieved',
        origin: 'user_provided',
        visibilityScope: { companyIds: [...companyIds], marketIds: [...marketIds] },
      },
      text,
      0,
    );
    writer.savePassage({
      ...record(`pass_${suffix}`),
      sourceId: `src_${suffix}`,
      sourceRevision: 1,
      text,
      contentHash: createHash('sha256').update(text).digest('hex'),
      origin: 'user_provided',
      visibilityScope: { companyIds: [...companyIds], marketIds: [...marketIds] },
    });
  }
  return { file, vault, writer };
}
function seed(writer: ReturnType<ReturnType<typeof openVault>['writer']>) {
  writer.saveClaim(claim(), 0);
  writer.saveFinding(finding(), 0);
  writer.saveReport(report(), 0);
}
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe('retained claims, findings and immutable report inputs (offline adapter)', () => {
  it('never accepts a report dependency chain that its bounded reader cannot reopen', () => {
    const { vault, writer } = fixture();
    const base: ReportRecord = {
      ...report(),
      scope: { kind: 'company', id: 'co_a' },
      inputRevisions: [{ kind: 'company', id: 'co_a', revision: 1 }],
      evidenceRefs: [reference('company')],
    };
    writer.saveReport(base, 0);
    for (let revision = 2; revision <= 16; revision++)
      writer.saveReport(
        {
          ...base,
          record: record('report_a', revision),
          inputRevisions: [{ kind: 'report', id: 'report_a', revision: revision - 1 }],
        },
        revision - 1,
      );
    const before = vault.status().revision;
    expect(() =>
      writer.saveReport(
        {
          ...base,
          record: record('report_a', 17),
          inputRevisions: [{ kind: 'report', id: 'report_a', revision: 16 }],
        },
        16,
      ),
    ).toThrow(/bound/i);
    expect(vault.getReport('report_a')?.record.revision).toBe(16);
    expect(vault.status().revision).toBe(before);
  });
  it('pins an exact numeric observation, including zero and its definition/period evidence', () => {
    const { vault, writer } = fixture();
    writer.saveMetricDefinition({
      record: record('def_a'),
      label: 'Annual revenue',
      description: 'Synthetic annual revenue, not funding.',
      unit: 'money',
      currencyMode: 'required',
      scopeKind: 'company',
      periodKind: 'interval',
    });
    writer.saveObservation({
      ...record('obs_a'),
      companyId: 'co_a',
      metricDefinitionId: 'def_a',
      scope: { kind: 'company', id: 'co_a' },
      unit: 'money',
      currency: 'USD',
      period: { kind: 'interval', startAt: '2025-01-01T00:00:00Z', endAt: '2025-12-31T23:59:59Z' },
      value: 0,
      support: 'supported',
      evidenceRefs: [reference('company')],
    });
    const base: ReportRecord = {
      ...report(),
      inputRevisions: [{ kind: 'observation', id: 'obs_a', revision: 1 }],
      evidenceRefs: [reference('company')],
    };
    expect(() =>
      writer.saveReport(
        { ...base, inputRevisions: [{ kind: 'observation', id: 'obs_a', revision: 2 }] },
        0,
      ),
    ).toThrow(/input|revision/i);
    writer.saveReport(base, 0);
    expect(vault.getReport('report_a')).toEqual(base);
    expect(vault.getObservation('obs_a')?.value).toBe(0);
  });
  it('reopens exact research versions and preserves earlier report inputs after correction', () => {
    const { file, vault, writer } = fixture();
    seed(writer);
    writer.saveClaim({ ...claim(2), text: 'A corrected synthetic description.' }, 1);
    writer.saveFinding(
      { ...finding(2), summary: 'A later finding, not a rewrite of its report.' },
      1,
    );
    writer.saveCompany(
      { record: record('co_a', 2), name: 'Corrected name', officialDomain: 'a.example' },
      1,
    );
    writer.saveReport(
      {
        ...report(2),
        markdown: 'New report version.',
        inputRevisions: [{ kind: 'claim', id: 'claim_a', revision: 2 }],
      },
      1,
    );
    vault.close();
    const reopened = track(file, 'reader');
    expect(reopened.getReport('report_a', 1)).toEqual(report());
    expect(reopened.getReport('report_a')?.markdown).toBe('New report version.');
    expect(reopened.getClaim('claim_a', 1)).toEqual(claim());
    expect(reopened.getFinding('finding_a', 1)).toEqual(finding());
    expect(reopened.integrity()).toBe('ok');
  });
  it('rejects stale revisions and scope/identity changes without changing history or vault revision', () => {
    const { vault, writer } = fixture();
    seed(writer);
    const before = vault.status().revision;
    expect(() => writer.saveClaim(claim(2), 0)).toThrow(/revision|conflict/i);
    expect(() =>
      writer.saveClaim(
        {
          ...claim(2),
          companyId: 'co_b',
          scope: { kind: 'company', id: 'co_b' },
          support: 'reported',
          evidenceRefs: [],
        },
        1,
      ),
    ).toThrow(/identity|scope|immutable/i);
    expect(() =>
      writer.saveReport({ ...report(2), scope: { kind: 'company', id: 'co_a' } }, 1),
    ).toThrow(/scope|immutable/i);
    expect(vault.getClaim('claim_a')).toEqual(claim());
    expect(vault.getReport('report_a', 2)).toBeNull();
    expect(vault.status().revision).toBe(before);
  });
  it('does not widen market-private evidence into shared company claims or another market finding', () => {
    const { vault, writer } = fixture();
    expect(() => writer.saveClaim({ ...claim(), evidenceRefs: [reference('market')] }, 0)).toThrow(
      /scope|private/i,
    );
    expect(() => writer.saveFinding({ ...finding(), marketId: 'mkt_b' }, 0)).toThrow(
      /scope|private/i,
    );
    expect(vault.getClaim('claim_a')).toBeNull();
    expect(vault.getFinding('finding_a')).toBeNull();
    writer.saveClaim(
      { ...claim(), scope: { kind: 'market', id: 'mkt_a' }, evidenceRefs: [reference('market')] },
      0,
    );
    expect(vault.getClaim('claim_a')?.scope).toEqual({ kind: 'market', id: 'mkt_a' });
  });
  it('findings own market support and only reference members of their market', () => {
    const { writer } = fixture();
    expect(() => writer.saveFinding({ ...finding(), companyIds: ['co_b'] }, 0)).toThrow(/member/i);
    expect(() =>
      writer.saveFinding({ ...finding(), evidenceRefs: [reference('company')] }, 0),
    ).toThrow(/market|scope/i);
    expect(() =>
      writer.saveFinding(
        { ...finding(), evidenceRefs: [{ ...reference('market'), sourceRevision: 9 }] },
        0,
      ),
    ).toThrow(/evidence|version/i);
  });
  it('refuses missing or mismatched report pins and cross-market private support, rolling back every index', () => {
    const { vault, writer } = fixture();
    writer.saveClaim(claim(), 0);
    writer.saveFinding(finding(), 0);
    const before = vault.status().revision;
    for (const inputRevisions of [
      [{ kind: 'claim' as const, id: 'claim_a', revision: 9 }],
      [{ kind: 'finding' as const, id: 'missing', revision: 1 }],
      [{ kind: 'report' as const, id: 'report_a', revision: 1 }],
    ])
      expect(() => writer.saveReport({ ...report(), inputRevisions }, 0)).toThrow(
        /input|revision|exist|cycle/i,
      );
    expect(() =>
      writer.saveReport({ ...report(), scope: { kind: 'market', id: 'mkt_b' } }, 0),
    ).toThrow(/scope|private/i);
    expect(vault.getReport('report_a')).toBeNull();
    expect(vault.status().revision).toBe(before);
    writer.saveReport(report(), 0);
    expect(vault.getReport('report_a')).toEqual(report());
  });
  it('requires transitive input evidence to be pinned and prevents private input laundering', () => {
    const { writer } = fixture();
    writer.saveClaim(claim(), 0);
    writer.saveFinding(finding(), 0);
    expect(() =>
      writer.saveReport({ ...report(), evidenceRefs: [reference('company')] }, 0),
    ).toThrow(/support|evidence|input/i);
    writer.saveReport(report(), 0);
    expect(() =>
      writer.saveReport(
        {
          ...report(),
          record: record('report_b'),
          scope: { kind: 'company', id: 'co_a' },
          inputRevisions: [{ kind: 'report', id: 'report_a', revision: 1 }],
          evidenceRefs: [reference('company')],
        },
        0,
      ),
    ).toThrow(/scope|private/i);
  });
  it('keeps imported and incomplete reports honestly labelled, without local human authority', () => {
    const { vault, writer } = fixture();
    expect(() => writer.saveClaim({ ...claim(), support: 'user_verified' }, 0)).toThrow();
    expect(() => writer.saveReport({ ...report(), origin: 'imported' }, 0)).toThrow();
    const imported = {
      ...report(),
      origin: 'imported' as const,
      status: 'partial' as const,
      inputRevisions: [],
      evidenceRefs: [],
      gaps: ['missing_evidence' as const],
    };
    writer.saveReport(imported, 0);
    expect(vault.getReport('report_a')).toEqual(imported);
  });
  it('supports bounded cursor pages with a consistent vault revision and no company metrics on findings', () => {
    const { vault, writer } = fixture();
    seed(writer);
    writer.saveReport({ ...report(), record: record('report_b') }, 0);
    const first = vault.listReports({ kind: 'market', id: 'mkt_a' }, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBe('report_a');
    const last = vault.listReports(
      { kind: 'market', id: 'mkt_a' },
      { limit: 1, afterId: first.nextCursor! },
    );
    expect(last.items.map((item) => item.record.id)).toEqual(['report_b']);
    expect(last.vaultRevision).toBe(first.vaultRevision);
    expect(() => vault.listFindings('mkt_a', { limit: 101 })).toThrow();
    expect(vault.listFindings('mkt_a').items[0]).not.toHaveProperty('metrics');
    expect(vault.listClaims('co_a').items).toEqual([claim()]);
  });
  it('fences old research writers and preserves all retained input support in native backup', async () => {
    const { file, vault, writer } = fixture();
    seed(writer);
    vault.advanceWriterGeneration();
    expect(() => writer.saveReport(report(2), 1)).toThrow(/fenc|generation/i);
    expect(() => writer.saveClaim(claim(2), 1)).toThrow(/fenc|generation/i);
    expect(() => writer.saveFinding(finding(2), 1)).toThrow(/fenc|generation/i);
    const destination = path.join(path.dirname(file), 'backup.sqlite');
    await vault.backup(destination);
    const backup = track(destination, 'reader');
    expect(backup.getReport('report_a')).toEqual(report());
    expect(backup.getClaim('claim_a')).toEqual(claim());
    expect(backup.getPassage('pass_market')?.text).toContain('market barrier');
  });
});
