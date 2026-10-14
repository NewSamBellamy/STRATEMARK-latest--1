/**
 * Load-time revalidation: figures stored before a gate existed are re-judged on
 * the evidence stored with them, once per gate version.
 */
import { describe, expect, it } from 'vitest';
import { companyMetricSchema, currentMetricRevision, type CompanyMetric } from '@mi/contracts';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot, type ResearchStore } from './repository';
import { METRIC_GATE_VERSION, revalidateStoredMetrics } from './revalidate-stored';
import { storedReportedFigureMisattributed } from './reported-metrics';
import type { OriginalSourceReceipt } from './original-source';

const CAPTURED = '2026-10-01T00:00:00.000Z';
const github = { id: 'co_github', name: 'GitHub' };
const visa = { id: 'co_visa', name: 'Visa Inc.' };
const apple = { id: 'co_apple', name: 'Apple Inc.' };
const circle = { id: 'co_circle', name: 'Circle Internet Group' };
const acme = { id: 'co_acme', name: 'Acme' };

function row(company: { id: string }, overrides: Partial<CompanyMetric>): CompanyMetric {
  return {
    id: `met_${company.id}_${overrides.metricType}`, companyId: company.id, metricType: 'valuation', value: null,
    confidence: 'estimated', source: 'https://example.org/a', citations: [{ title: 'example.org', url: 'https://example.org/a' }],
    methodNote: null, capturedAt: CAPTURED, lastVerifiedAt: null, passageSupport: null, reportedSupport: null, ...overrides,
  } as CompanyMetric;
}

function reported(company: { id: string; name: string }, type: CompanyMetric['metricType'], value: number, text: string,
  asOf: string, extra: Partial<CompanyMetric> = {}): CompanyMetric {
  return row(company, {
    metricType: type, value,
    methodNote: `Source reported ${type} (as of ${asOf}); provider-grounded, not verified against an original.`,
    reportedSupport: {
      provider: 'google-search', companyName: company.name, basis: type, value, unit: 'USD', asOf, definition: type as never,
      support: { supportIndex: 0, text, sources: [{ chunkIndex: 0, url: 'https://example.org/a', title: 'example.org' }] },
    },
    ...extra,
  });
}

// GitHub: the provider support is only the clause; the retained answer holds
// the full sentence that names Microsoft as the parent.
const PARENT_ANSWER = 'GitHub is a developer platform. Microsoft Corporation, the parent company of GitHub, has a market capitalization of $3.83 trillion as of October 1, 2026.';
const parentCap = reported(github, 'market_cap', 3.83 * 1e12,
  'has a market capitalization of $3.83 trillion as of October 1, 2026.', '2026-10-01');
const acquisitionValuation = reported(github, 'valuation', 7.5 * 1e9,
  'GitHub was acquired by Microsoft for $7.5 billion in stock as of June 4, 2018.', '2018-06-04');
const humanValuation = { ...acquisitionValuation, id: 'met_human', confidence: 'user_verified' as const, capturedAt: '2026-10-02T00:00:00.000Z' };
const cleanValuation = reported(acme, 'valuation', 2e9,
  'Acme closed a $100 million Series C at a post-money valuation of $2 billion as of March 1, 2026.', '2026-03-01');

const marketCapNote = (sharesAsOf: string, shares: string) =>
  `Estimated market cap = share price US$350 (Yahoo Finance, 2026-10-01) × ${shares} shares outstanding (SEC 10-K cover, ${sharesAsOf}). A computation from two reported figures, not a reported market cap.`;
const staleCap = row(visa, { metricType: 'market_cap', value: 350 * 531_000_000, methodNote: marketCapNote('2010-10-20', '531,000,000') });
const freshCap = row(apple, { metricType: 'market_cap', value: 350 * 14_840_392_000, methodNote: marketCapNote('2025-09-27', '14,840,392,000') });

// Circle: the ASC 606 concept is a sliver; Revenues holds the total.
const cik = '0001876042';
const conceptUrl = (tag: string) => `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`;
const asc606 = conceptUrl('RevenueFromContractWithCustomerExcludingAssessedTax');
const record = (val: number) => ({ start: '2025-01-01', end: '2025-12-31', val, accn: '0001876042-26-000012', fy: 2025, fp: 'FY', form: '10-K', filed: '2026-02-25' });
const conceptReceipt = (tag: string, val: number): OriginalSourceReceipt => ({
  requestedUrl: conceptUrl(tag), finalUrl: conceptUrl(tag), status: 'retrieved', httpStatus: 200, contentHash: 'c'.repeat(64),
  retrievedAt: '2026-10-01T00:00:00.000Z', format: 'sec-companyconcept', truncated: false,
  text: JSON.stringify({ cik: 1876042, entityName: 'Circle Internet Group, Inc.', taxonomy: 'us-gaap', tag, units: { USD: [record(val)] } }),
});
const circleRevenue = row(circle, {
  metricType: 'arr', value: 109_800_000, confidence: 'verified', source: asc606,
  citations: [{ title: 'SEC filing-reported annual revenue', url: asc606 }],
  passageSupport: { sourceUrl: asc606, quote: JSON.stringify(record(109_800_000)), asOf: '2025-12-31', periodStart: '2025-01-01',
    basis: 'arr', unit: 'USD', definition: 'annual_revenue', format: 'sec-companyconcept' },
});

function snapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    schemaVersion: 2, markets: [], decks: [], cards: [], viceClaims: [], companyMarket: {}, reports: [], briefings: [],
    savedCards: [], opportunity: {}, researchJobs: [], threads: [],
    companies: [github, visa, apple, circle, acme].map((c) => ({ ...c, websiteUrl: null })) as unknown as RepoSnapshot['companies'],
    metrics: structuredClone([parentCap, acquisitionValuation, humanValuation, cleanValuation, staleCap, freshCap, circleRevenue]),
    dashboards: { co_github: { overview: { content: 'GitHub is worth $3.83 trillion.', lastRefreshedAt: CAPTURED } } },
    researchEvidence: [{ id: 'ev_1', companyId: github.id, companyName: github.name, topic: 'profile', capturedAt: CAPTURED,
      text: PARENT_ANSWER, citations: [{ title: 'example.org', url: 'https://example.org/a' }], queries: [] }],
    originalSourceAttempts: [{ id: 'src_circle', companyId: circle.id, metricType: 'metrics_hunt', capturedAt: CAPTURED,
      receipts: [conceptReceipt('RevenueFromContractWithCustomerExcludingAssessedTax', 109_800_000), conceptReceipt('Revenues', 2_750_000_000)] }],
    ...overrides,
  } as RepoSnapshot;
}

const byId = (snap: RepoSnapshot, id: string) => snap.metrics.find((m) => m.id === id)!;

describe('revalidateStoredMetrics', () => {
  it('withdraws exactly the figures that fail a current gate', () => {
    const { snapshot: snap, revalidation } = migrateSnapshot(snapshot());
    expect(revalidation?.ran).toBe(true);
    expect(revalidation?.reset.map((r) => [r.metricId, r.gate]).sort()).toEqual([
      [acquisitionValuation.id, 'parent_or_acquisition'],
      [circleRevenue.id, 'sec_revenue_sub_line'],
      [parentCap.id, 'parent_or_acquisition'],
      [staleCap.id, 'stale_share_count'],
    ].sort());
    for (const id of [parentCap.id, acquisitionValuation.id, staleCap.id, circleRevenue.id]) {
      const m = byId(snap, id);
      expect(m).toMatchObject({ value: null, confidence: 'unknown', source: null, citations: [], reportedSupport: null, passageSupport: null });
      expect(m.methodNote).toMatch(/^Withdrawn:/);
      // Still a valid stored row, and an unknown the pipeline will hunt again.
      expect(companyMetricSchema.safeParse(m).success).toBe(true);
    }
    expect(snap.metricGateVersion).toBe(METRIC_GATE_VERSION);
  });

  it('never touches a human-verified figure, and keeps clean figures intact', () => {
    const { snapshot: snap } = migrateSnapshot(snapshot());
    expect(byId(snap, humanValuation.id)).toEqual(humanValuation);
    expect(byId(snap, cleanValuation.id)).toEqual(cleanValuation);
    expect(byId(snap, freshCap.id)).toEqual(freshCap);
    // The human figure stays the one shown for its slot.
    expect(currentMetricRevision(snap.metrics, github.id, 'valuation')?.metric.value).toBe(7.5e9);
  });

  it('makes a withdrawn slot unknown so the next research of the company refills it', () => {
    const { snapshot: snap } = migrateSnapshot(snapshot());
    const current = currentMetricRevision(snap.metrics, github.id, 'market_cap')!.metric;
    expect(current.value).toBeNull();
    expect(current.confidence).toBe('unknown');
  });

  it('drops the cached dashboard of a company whose figure was withdrawn', () => {
    const { snapshot: snap } = migrateSnapshot(snapshot());
    expect(snap.dashboards.co_github).toEqual({});
  });

  it('runs once per gate version and is idempotent', () => {
    const first = migrateSnapshot(snapshot()).snapshot;
    const again = migrateSnapshot(structuredClone(first));
    expect(again.revalidation?.ran).toBe(false);
    expect(again.snapshot.metrics).toEqual(first.metrics);
    // A direct second pass over an already-revalidated snapshot changes nothing either.
    const forced = structuredClone(first);
    forced.metricGateVersion = 0;
    expect(revalidateStoredMetrics(forced).reset).toEqual([]);
    expect(forced.metrics).toEqual(first.metrics);
  });

  it('does not mutate the snapshot object it was handed', () => {
    const input = snapshot();
    const before = structuredClone(input.metrics);
    migrateSnapshot(input);
    expect(input.metrics).toEqual(before);
  });

  it('leaves SEC revenue alone when the retained evidence cannot decide (only the used concept was kept)', () => {
    const onlyUsed = snapshot({ originalSourceAttempts: [{ id: 'src_circle', companyId: circle.id, metricType: 'metrics_hunt', capturedAt: CAPTURED,
      receipts: [conceptReceipt('RevenueFromContractWithCustomerExcludingAssessedTax', 109_800_000)] }] });
    const { snapshot: snap, revalidation } = migrateSnapshot(onlyUsed);
    expect(byId(snap, circleRevenue.id)).toEqual(circleRevenue);
    expect(revalidation?.undecided).toContain(circleRevenue.id);
  });

  it('keeps an SEC revenue row that already is the larger concept', () => {
    const total = snapshot({ originalSourceAttempts: [{ id: 'src_circle', companyId: circle.id, metricType: 'metrics_hunt', capturedAt: CAPTURED,
      receipts: [conceptReceipt('RevenueFromContractWithCustomerExcludingAssessedTax', 109_800_000), conceptReceipt('Revenues', 100_000_000)] }] });
    expect(byId(migrateSnapshot(total).snapshot, circleRevenue.id)).toEqual(circleRevenue);
  });

  it('v2: withdraws an acquired company deal-time valuation, never a pending deal round', () => {
    const poppi = { id: 'co_poppi', name: 'Poppi' };
    const anysphere = { id: 'co_anysphere', name: 'Anysphere' };
    const cite = [{ url: 'https://www.cnbc.com/2025/03/17/pepsico-poppi.html', title: 'CNBC' }];
    const poppiRow = reported(poppi, 'valuation', 2e9, 'Poppi was valued at USD 1.95 billion as of March 17, 2025', '2025-03-17');
    const roundRow = reported(anysphere, 'valuation', 2.93e10, 'Anysphere was valued at $29.3 billion in its Series D round as of May 1, 2026.', '2026-05-01');
    const base = snapshot();
    const snap = snapshot({
      companies: [...base.companies,
        { ...poppi, websiteUrl: null, ownership: { status: 'acquired', acquirer: 'PepsiCo', announcedOn: '2025-03-17', closedOn: '2025-05',
          price: null, citations: cite, confidence: 'estimated' } },
        { ...anysphere, websiteUrl: null, ownership: { status: 'acquisition_pending', acquirer: 'SpaceX', announcedOn: '2026-06-10', closedOn: null,
          price: { value: 6e10, currency: 'USD' }, citations: cite, confidence: 'estimated' } },
      ] as unknown as RepoSnapshot['companies'],
      metrics: [...base.metrics, poppiRow, roundRow],
    });
    const { snapshot: out, revalidation } = migrateSnapshot(snap);
    expect(revalidation?.reset.find((r) => r.metricId === poppiRow.id)?.gate).toBe('acquired_deal_valuation');
    expect(byId(out, poppiRow.id)).toMatchObject({ value: null, confidence: 'unknown', reportedSupport: null });
    expect(byId(out, roundRow.id)).toEqual(roundRow);
  });

  it('v4: withdraws an acquired company UNDATED valuation (live Poppi: price null, no reporting date)', () => {
    const poppi = { id: 'co_poppi', name: 'Poppi' };
    const cite = [{ url: 'https://www.cnbc.com/2025/03/17/pepsico-poppi.html', title: 'CNBC' }];
    const dated = reported(poppi, 'valuation', 1.95e9, 'Poppi was valued at USD 1.95 billion.', '2025-03-17');
    const undated = { ...dated, methodNote: 'Source reported valuation (undated; reporting date not published).',
      reportedSupport: { ...dated.reportedSupport!, asOf: null } } as unknown as CompanyMetric;
    const roundSource = reported(poppi, 'valuation', 5e8, 'Poppi was valued at $500 million in its Series B in June 2023.', '', {
      id: 'met_poppi_round', methodNote: 'Source reported valuation; provider-grounded, not verified against an original.' });
    const round = { ...roundSource, reportedSupport: { ...roundSource.reportedSupport!, asOf: null } } as unknown as CompanyMetric;
    const base = snapshot();
    const snap = snapshot({
      companies: [...base.companies,
        { ...poppi, websiteUrl: null, ownership: { status: 'acquired', acquirer: 'PepsiCo', announcedOn: '2025-05-19', closedOn: '2025-05',
          price: null, citations: cite, confidence: 'estimated' } },
      ] as unknown as RepoSnapshot['companies'],
      metrics: [...base.metrics, undated, round],
    });
    // A deck already revalidated by the previous gate version still re-runs.
    const { snapshot: out, revalidation } = migrateSnapshot({ ...snap, metricGateVersion: METRIC_GATE_VERSION - 1 } as typeof snap);
    expect(revalidation?.reset.find((r) => r.metricId === undated.id)?.gate).toBe('acquired_deal_valuation');
    expect(byId(out, undated.id)).toMatchObject({ value: null, confidence: 'unknown' });
    // An undated row whose own support states a pre-deal date is re-dated, then judged: it stands.
    expect(revalidation?.reset.map((r) => r.metricId)).not.toContain(round.id);
    expect(byId(out, round.id)).toMatchObject({ value: 5e8, reportedSupport: { asOf: '2023-06-30' } });
  });

  it('v3: a v2 snapshot from either branch gets both v2 sets (ownership + dating/summary/HQ)', () => {
    const poppi = { id: 'co_poppi', name: 'Poppi' };
    const cite = [{ url: 'https://www.cnbc.com/2025/03/17/pepsico-poppi.html', title: 'CNBC' }];
    const ownership = { status: 'acquired', acquirer: 'PepsiCo', announcedOn: '2025-03-17', closedOn: '2025-05',
      price: null, citations: cite, confidence: 'estimated' };
    const dealRow = reported(poppi, 'valuation', 2e9, 'Poppi was valued at USD 1.95 billion as of March 17, 2025', '2025-03-17');
    const undatedRow = reported(acme, 'valuation', 2e9, 'Acme raised a Series C at a $2 billion valuation in February 2025.', '', {
      id: 'met_acme_undated', methodNote: 'Source reported valuation; provider-grounded, not verified against an original.' });
    undatedRow.reportedSupport = { ...undatedRow.reportedSupport!, asOf: null };
    // The same stored 2 whichever branch wrote it: the version alone cannot
    // say which checks already ran, so all of them run again (idempotently).
    const v2 = snapshot({
      metricGateVersion: 2, dashboards: {},
      companies: [
        { ...acme, websiteUrl: null, oneLiner: 'Acme builds software for teams.', hqLocation: 'Austin, TX' },
        { ...poppi, websiteUrl: null, oneLiner: 'Poppi makes prebiotic soda.', hqLocation: 'Mumbai, IN', ownership },
      ] as unknown as RepoSnapshot['companies'],
      metrics: [dealRow, undatedRow],
    });
    const { snapshot: out, revalidation } = migrateSnapshot(v2);
    expect(revalidation?.fromVersion).toBe(2);
    expect(revalidation?.reset.map((r) => [r.metricId, r.gate])).toEqual([[dealRow.id, 'acquired_deal_valuation']]);
    expect(revalidation?.relabelled.map((r) => [r.metricId, r.change, r.asOf])).toEqual([['met_acme_undated', 'redated', '2025-02-28']]);
    expect(out.companies.map((c) => c.hqLocation)).toEqual(['Austin, Texas', 'Mumbai, IN']);
    expect(out.metricGateVersion).toBe(METRIC_GATE_VERSION);
    // Idempotent: the checks re-run on their own output change nothing.
    const again = revalidateStoredMetrics({ ...structuredClone(out), metricGateVersion: 2 });
    expect([again.reset, again.relabelled, again.resetSummaries, again.normalizedHq]).toEqual([[], [], [], []]);
  });

  it('does not revalidate a snapshot from a newer build', () => {
    const future = snapshot({ schemaVersion: 99 });
    const outcome = migrateSnapshot(future);
    expect(outcome.revalidation).toBeUndefined();
    expect(byId(outcome.snapshot, parentCap.id).value).toBe(3.83e12);
  });
});

describe('storedReportedFigureMisattributed', () => {
  it('judges the full sentence a clause-fragment support came from', () => {
    expect(storedReportedFigureMisattributed(parentCap)).toBe(false);
    expect(storedReportedFigureMisattributed(parentCap, [PARENT_ANSWER])).toBe(true);
  });

  it('a price paid to buy the company is not a valuation, but a clean round is', () => {
    expect(storedReportedFigureMisattributed(acquisitionValuation)).toBe(true);
    expect(storedReportedFigureMisattributed(cleanValuation)).toBe(false);
  });

  it('leaves a row alone when no stored sentence carries the figure', () => {
    const elsewhere = reported(github, 'market_cap', 3.83e12, 'Microsoft is the parent company of GitHub.', '2026-10-01');
    expect(storedReportedFigureMisattributed(elsewhere)).toBe(false);
  });
});

describe('GeminiRepository load path', () => {
  function storeWith(initial: RepoSnapshot): { store: ResearchStore; written: RepoSnapshot[] } {
    const written: RepoSnapshot[] = [];
    let current = initial;
    return { written, store: { read: () => structuredClone(current), write: (snap) => { current = structuredClone(snap); written.push(current); } } };
  }

  it('persists the revalidated snapshot once, then never re-runs for the same gate version', () => {
    const { store, written } = storeWith(snapshot());
    const repo = new GeminiRepository({ apiKey: 'k', store });
    expect(repo.getMigrationOutcome()?.revalidation?.reset).toHaveLength(4);
    expect(written).toHaveLength(1);
    expect(written[0]!.metricGateVersion).toBe(METRIC_GATE_VERSION);
    expect(byId(written[0]!, parentCap.id).value).toBeNull();

    const second = new GeminiRepository({ apiKey: 'k', store });
    expect(second.getMigrationOutcome()?.revalidation?.ran).toBe(false);
    expect(written).toHaveLength(1);
  });
});
