/**
 * Live 2026-10-14 "Sales Engagement and Revenue Intelligence" deck: Mixmax,
 * Inc. (48 employees, private) stored Alphabet's $4.09T market cap and
 * $402.84B revenue — the exact figures on "Google LLC (BigQuery)" in the same
 * deck. Root cause: in a batched hydration answer (one `### Name` section per
 * company) the anonymous-section identity anchor read the answer's first 240
 * characters, which named Mixmax's header, so Google's label-first lines
 * ("Market Capitalization: $4.09 trillion …") bound to Mixmax too.
 */
import { describe, expect, it } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { reportedCompanyMetrics, supportSectionOwner } from './reported-metrics';
import { enrichmentOutSchema } from './schemas';
import { extractProviderGrounding } from './grounding-support';
import { implausibleForHeadcount, implausibleScaleFigures } from './scale-plausibility';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot, type ResearchStore } from './repository';
import { METRIC_GATE_VERSION } from './revalidate-stored';

const CAPTURED = '2026-10-06T00:00:00.000Z';
const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/alphabet-fixture';
const mixmax = { id: 'co_mixmax', name: 'Mixmax, Inc.', websiteUrl: 'https://mixmax.com' };
const google = { id: 'co_google', name: 'Google LLC (BigQuery)', websiteUrl: 'https://cloud.google.com' };
const gong = { id: 'co_gong', name: 'Gong.io Inc.', websiteUrl: 'https://gong.io' };

const CAP_LINE = '* **Market Capitalization:** $4.09 trillion as of October 1, 2026 (Alphabet Inc.)';
const REV_LINE = '* **Annual Revenue:** $402.84 billion (undated)';
const BATCH_SEGMENTS = [
  '### Mixmax, Inc.\nMixmax is a sales engagement platform for Gmail and Salesforce users.',
  '### Google LLC (BigQuery)\nGoogle BigQuery is a serverless data warehouse.',
  CAP_LINE,
  REV_LINE,
];
const BATCH_ANSWER = BATCH_SEGMENTS.join('\n\n');

function batchGrounding() {
  return extractProviderGrounding(BATCH_ANSWER, {
    groundingChunks: [{ web: { uri: REDIRECT, title: 'companiesmarketcap.com' } }],
    groundingSupports: [CAP_LINE, REV_LINE].map((p) => ({ segment: { text: p, startIndex: BATCH_ANSWER.indexOf(p),
      endIndex: BATCH_ANSWER.indexOf(p) + p.length }, groundingChunkIndices: [0] })),
  })!;
}

const rowsFor = (company: { id: string; name: string; websiteUrl: string }, roster: string[], answer = BATCH_ANSWER,
  grounding = batchGrounding()) =>
  reportedCompanyMetrics({ companyId: company.id, companyName: company.name, website: company.websiteUrl,
    enrichment: enrichmentOutSchema.parse({ metrics: {} }), text: answer, grounding, capturedAt: CAPTURED,
    identity: { answerText: answer, otherCompanies: roster } }).filter((row) => row.value != null);

describe('batched answer: a support binds only to its own company section (root cause)', () => {
  it('Google\'s label-first lines never bind to Mixmax, whose header opens the batch answer', () => {
    expect(rowsFor(mixmax, [google.name, gong.name])).toEqual([]);
  });

  it('the same lines still bind to Google, inside Google\'s own section', () => {
    expect(rowsFor(google, [mixmax.name, gong.name]).map((r) => [r.metricType, r.value]).sort())
      .toEqual([['arr', 402_840_000_000], ['market_cap', 4_090_000_000_000]]);
  });

  it('section owner: nearest company heading wins; a non-company heading is presentation', () => {
    expect(supportSectionOwner(mixmax.name, BATCH_ANSWER, CAP_LINE, undefined, [google.name])).toBe('rival');
    expect(supportSectionOwner(google.name, BATCH_ANSWER, CAP_LINE, undefined, [mixmax.name])).toBe('subject');
    const single = '### Company Profile: Mixmax, Inc.\nMixmax builds sales engagement software.\n\n### Financials\n' +
      '* **Annual Revenue:** $30 million as of December 31, 2025';
    expect(supportSectionOwner(mixmax.name, single, '* **Annual Revenue:** $30 million as of December 31, 2025', undefined,
      [google.name])).toBe('subject');
  });

  it('control: a single-company answer with a sub-heading still binds its anonymous section', () => {
    const line = '* **Annual Revenue:** $30 million as of December 31, 2025';
    const answer = `### Company Profile: Mixmax, Inc.\nMixmax builds sales engagement software.\n\n### Financials\n\n${line}`;
    const grounding = extractProviderGrounding(answer, {
      groundingChunks: [{ web: { uri: REDIRECT, title: 'getlatka.com' } }],
      groundingSupports: [{ segment: { text: line, startIndex: answer.indexOf(line), endIndex: answer.indexOf(line) + line.length },
        groundingChunkIndices: [0] }],
    })!;
    expect(rowsFor(mixmax, [google.name, gong.name], answer, grounding).map((r) => [r.metricType, r.value]))
      .toEqual([['arr', 30_000_000]]);
  });
});

function metric(company: { id: string; name: string }, type: CompanyMetric['metricType'], value: number,
  extra: Partial<CompanyMetric> = {}, text = `${company.name} ${type} ${value}`): CompanyMetric {
  return {
    id: `met_${company.id}_${type}`, companyId: company.id, metricType: type, value, confidence: 'estimated',
    source: REDIRECT, citations: [{ title: 'source', url: REDIRECT }],
    methodNote: `Source reported ${type} (as of 2026-10-01); provider-grounded, not verified against an original.`,
    capturedAt: CAPTURED, lastVerifiedAt: null, passageSupport: null,
    reportedSupport: type === 'employees' ? null : {
      provider: 'google-search', companyName: company.name, basis: type, value, unit: 'USD', asOf: '2026-10-01',
      definition: (type === 'arr' ? 'annual_revenue' : type) as never,
      support: { supportIndex: 0, text, sources: [{ chunkIndex: 0, url: REDIRECT, title: 'source' }] },
    },
    ...extra,
  } as CompanyMetric;
}
const employees = (company: { id: string; name: string }, count: number) =>
  metric(company, 'employees', count, { reportedSupport: null });

describe('scale plausibility: unverified figures the company\'s own headcount cannot carry', () => {
  it('real companies pass (Gong, Snowflake, Databricks, OpenAI, Jane Street)', () => {
    expect(implausibleForHeadcount('arr', 500e6, 2028)).toBe(false); // Gong
    expect(implausibleForHeadcount('market_cap', 120.9e9, 7296)).toBe(false); // Snowflake
    expect(implausibleForHeadcount('valuation', 190e9, 10000)).toBe(false); // Databricks
    expect(implausibleForHeadcount('valuation', 852e9, 4500)).toBe(false); // OpenAI
    expect(implausibleForHeadcount('arr', 20.5e9, 2600)).toBe(false); // Jane Street
    expect(implausibleForHeadcount('market_cap', 4.09e12, 183_000)).toBe(false); // Alphabet
    expect(implausibleForHeadcount('valuation', 32e9, 20)).toBe(false); // below the $50B floor
  });

  it('Mixmax (48 employees) cannot carry $4.09T market cap or $402.84B revenue', () => {
    expect(implausibleForHeadcount('market_cap', 4.09e12, 48)).toBe(true);
    expect(implausibleForHeadcount('arr', 402.84e9, 48)).toBe(true);
  });

  it('withholds the Mixmax figures and leaves the Google card\'s identical figures alone', () => {
    const metrics = [
      employees(mixmax, 48), metric(mixmax, 'market_cap', 4.09e12, {}, CAP_LINE), metric(mixmax, 'arr', 402.84e9, {}, REV_LINE),
      employees(google, 183_000), metric(google, 'market_cap', 4.09e12, {}, CAP_LINE), metric(google, 'arr', 402.84e9, {}, REV_LINE),
      employees(gong, 2028), metric(gong, 'arr', 500e6),
    ];
    const findings = implausibleScaleFigures({ companies: [mixmax, google, gong], metrics,
      scopes: [[mixmax.id, google.id, gong.id]] });
    expect(findings.map((f) => [f.companyId, f.metricType, f.gate]).sort()).toEqual([
      [mixmax.id, 'arr', 'implausible_scale'], [mixmax.id, 'market_cap', 'implausible_scale']]);
  });

  it('never judges verified or human figures', () => {
    const metrics = [employees(mixmax, 48), metric(mixmax, 'market_cap', 4.09e12, { confidence: 'verified' }),
      metric(mixmax, 'arr', 402.84e9, { confidence: 'user_verified' })];
    expect(implausibleScaleFigures({ companies: [mixmax], metrics })).toEqual([]);
  });
});

describe('cross-company duplicate figure', () => {
  it('drops the holder whose evidence names the other company and not itself', () => {
    const metrics = [metric(mixmax, 'arr', 402.84e9, {}, 'Google LLC (BigQuery) reported annual revenue of $402.84 billion.'),
      metric(google, 'arr', 402.84e9, {}, 'Google LLC (BigQuery) reported annual revenue of $402.84 billion.')];
    const findings = implausibleScaleFigures({ companies: [mixmax, google], metrics, scopes: [[mixmax.id, google.id]] });
    expect(findings.map((f) => [f.companyId, f.gate])).toEqual([[mixmax.id, 'cross_company_figure']]);
  });

  it('drops the holder whose retained batch answer places the support in the other company\'s section', () => {
    const metrics = [metric(mixmax, 'market_cap', 4.09e12, {}, CAP_LINE), metric(google, 'market_cap', 4.09e12, {}, CAP_LINE)];
    const findings = implausibleScaleFigures({ companies: [mixmax, google], metrics, scopes: [[mixmax.id, google.id]],
      answers: [BATCH_ANSWER] });
    expect(findings.map((f) => [f.companyId, f.gate])).toEqual([[mixmax.id, 'cross_company_figure']]);
  });

  it('keeps an undecidable duplicate: a parent and its product line both carrying Alphabet\'s figure', () => {
    const deepmind = { id: 'co_deepmind', name: 'Google DeepMind' };
    const text = 'Alphabet has a market capitalization of $4.09 trillion as of October 1, 2026.';
    const metrics = [metric(google, 'market_cap', 4.09e12, {}, text), metric(deepmind, 'market_cap', 4.09e12, {}, text)];
    expect(implausibleScaleFigures({ companies: [google, deepmind], metrics, scopes: [[google.id, deepmind.id]] })).toEqual([]);
  });

  it('compares only within a deck or market scope', () => {
    const metrics = [metric(mixmax, 'arr', 402.84e9, {}, 'Google LLC (BigQuery) reported annual revenue of $402.84 billion.'),
      metric(google, 'arr', 402.84e9)];
    expect(implausibleScaleFigures({ companies: [mixmax, google], metrics })).toEqual([]);
  });
});

function deckSnapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    schemaVersion: 2, markets: [], decks: [], viceClaims: [], reports: [], briefings: [], savedCards: [], opportunity: {},
    researchJobs: [], threads: [], dashboards: {},
    companyMarket: { [mixmax.id]: 'Sales Engagement and Revenue Intelligence', [google.id]: 'Sales Engagement and Revenue Intelligence' },
    cards: [],
    companies: [mixmax, google].map((c) => ({ ...c })) as unknown as RepoSnapshot['companies'],
    metrics: [employees(mixmax, 48), metric(mixmax, 'market_cap', 4.09e12, {}, CAP_LINE), metric(mixmax, 'arr', 402.84e9, {}, REV_LINE),
      metric(google, 'market_cap', 4.09e12, {}, CAP_LINE), metric(google, 'arr', 402.84e9, {}, REV_LINE)],
    ...overrides,
  } as RepoSnapshot;
}
const byId = (snap: RepoSnapshot, id: string) => snap.metrics.find((m) => m.id === id)!;

describe('stored decks: v8 revalidation and the write-time gate', () => {
  it('v8 withholds the stored Mixmax figures (null, unknown, explained) and keeps Google\'s', () => {
    const { snapshot: out, revalidation } = migrateSnapshot({ ...deckSnapshot(), metricGateVersion: 7 });
    expect(METRIC_GATE_VERSION).toBe(8);
    expect(out.metricGateVersion).toBe(8);
    expect(revalidation?.reset.map((r) => [r.metricId, r.gate]).sort()).toEqual([
      [`met_${mixmax.id}_arr`, 'implausible_scale'], [`met_${mixmax.id}_market_cap`, 'implausible_scale']]);
    for (const type of ['market_cap', 'arr']) {
      expect(byId(out, `met_${mixmax.id}_${type}`)).toMatchObject({ value: null, confidence: 'unknown', citations: [],
        reportedSupport: null, methodNote: expect.stringMatching(/^Withheld: .*headcount/) });
    }
    expect(byId(out, `met_${google.id}_market_cap`)).toMatchObject({ value: 4.09e12, confidence: 'estimated' });
    expect(byId(out, `met_${google.id}_arr`)).toMatchObject({ value: 402.84e9, confidence: 'estimated' });
  });

  it('v8 uses retained batch evidence when Mixmax has no headcount', () => {
    const snap = deckSnapshot({ metrics: deckSnapshot().metrics.filter((m) => m.metricType !== 'employees'),
      researchEvidence: [{ id: 'ev_batch', topic: 'company_profile', companyName: `${mixmax.name} + ${google.name}`,
        text: BATCH_ANSWER, citations: [], capturedAt: CAPTURED }] as unknown as RepoSnapshot['researchEvidence'] });
    const { snapshot: out, revalidation } = migrateSnapshot({ ...snap, metricGateVersion: 7 });
    expect(revalidation?.reset.map((r) => [r.metricId, r.gate]).sort()).toEqual([
      [`met_${mixmax.id}_arr`, 'cross_company_figure'], [`met_${mixmax.id}_market_cap`, 'cross_company_figure']]);
    expect(byId(out, `met_${google.id}_market_cap`).value).toBe(4.09e12);
  });

  it('every write passes the gate: a headcount edit withholds the figures it cannot carry', async () => {
    const written: RepoSnapshot[] = [];
    let current: RepoSnapshot = { ...deckSnapshot({ metrics: deckSnapshot().metrics.filter((m) => m.metricType !== 'employees') }),
      metricGateVersion: METRIC_GATE_VERSION };
    const store: ResearchStore = { read: () => structuredClone(current), write: (snap) => { current = structuredClone(snap); written.push(current); } };
    const repo = new GeminiRepository({ apiKey: 'k', store });
    await repo.overrideMetric({ companyId: mixmax.id, metricType: 'employees', value: 48, note: 'LinkedIn headcount' });
    const saved = written.at(-1)!;
    expect(byId(saved, `met_${mixmax.id}_market_cap`)).toMatchObject({ value: null, confidence: 'unknown' });
    expect(byId(saved, `met_${mixmax.id}_arr`)).toMatchObject({ value: null, confidence: 'unknown' });
    expect(byId(saved, `met_${google.id}_market_cap`).value).toBe(4.09e12);
  });
});
