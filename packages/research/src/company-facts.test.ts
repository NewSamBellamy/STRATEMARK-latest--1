import { describe, expect, it, vi } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { GeminiRepository, migrateSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';
import { projectCompanyFacts } from './company-facts';
import { overviewFigures } from './company-overview';

const url = 'https://sec.gov/Archives/acme';
const quote = 'Acme reported 45 employees as of 2026-10-01.';
const employee: CompanyMetric = { id: 'employees', companyId: 'cmp', metricType: 'employees', value: 45, confidence: 'verified',
  source: url, citations: [{ title: 'SEC', url }], methodNote: null, capturedAt: '2026-10-02T00:00:00.000Z',
  passageSupport: { sourceUrl: url, quote, basis: 'employees', asOf: '2026-10-01', unit: 'count' } };
const legacy: CompanyMetric = { ...employee, id: 'arr', metricType: 'arr', value: 999_000_000, passageSupport: null };
function setup() {
  let snapshot = migrateSnapshot(null).snapshot;
  snapshot.companies = [{ id: 'cmp', name: 'Acme', oneLiner: 'Software', websiteUrl: 'https://acme.com', logoUrl: null, hqLocation: null, brandTheme: null }];
  snapshot.metrics = [employee, legacy];
  snapshot.cards = [{ id: 'card', companyId: 'cmp', deckId: 'deck', cardType: 'company', tier: 5, tierReason: null, title: null, summary: null,
    keyPoints: [], citations: [], createdAt: employee.capturedAt }];
  snapshot.savedCards = [{ cardId: 'card', savedAt: employee.capturedAt }];
  snapshot.originalSourceAttempts = [{ id: 'source', companyId: 'cmp', metricType: 'company_profile', capturedAt: employee.capturedAt,
    receipts: [{ requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), text: quote, retrievedAt: employee.capturedAt }] }];
  const store: ResearchStore = { read: () => structuredClone(snapshot), write: async value => { snapshot = structuredClone(value); } };
  const client = { ground: vi.fn().mockResolvedValue({ text: 'Answer', citations: [], queries: [] }), structure: vi.fn() } as unknown as LlmClient;
  const repo = new GeminiRepository({ apiKey: 'test', store, client });
  return { repo, store, client };
}
const assertFacts = (rows: CompanyMetric[]) => {
  expect(rows.find(row => row.metricType === 'employees')).toMatchObject({ value: 45, confidence: 'verified' });
  expect(rows.find(row => row.metricType === 'arr')).toMatchObject({ value: null, confidence: 'unknown' });
};
describe('one current company facts projection', () => {
  it('keeps referenced support through thirty newer attempts without expanding the ordinary recent query', async () => {
    const { store, client } = setup();
    const snapshot = store.read()!;
    for (let index = 0; index < 30; index++) snapshot.originalSourceAttempts!.push({ id: `failed_${index}`,
      companyId: 'cmp', metricType: 'arr', capturedAt: `2026-10-03T00:00:${String(index).padStart(2, '0')}.000Z`,
      receipts: [{ requestedUrl: url, status: 'unavailable', retrievedAt: '2026-10-03T00:00:00.000Z' }] });
    await store.write(snapshot);
    const reopened = new GeminiRepository({ apiKey: 'test', store, client });
    expect(await reopened.getOriginalSourceEvidence({ companyId: 'cmp', limit: 20 })).toHaveLength(20);
    expect((await reopened.getCompanyFacts('cmp')).find(row => row.metricType === 'employees')).toMatchObject({ value: 45, confidence: 'verified' });
    expect((await reopened.getCard('card'))!.metrics.find(row => row.metricType === 'employees')!.value).toBe(45);
    expect((await reopened.listSavedCards())[0]!.metrics.find(row => row.metricType === 'employees')!.value).toBe(45);
    expect(client.ground).not.toHaveBeenCalled();
    expect(client.structure).not.toHaveBeenCalled();
  });
  it('retains typed revenue intervals and customer populations across facts, saved cards and reopen without mischarting them', async () => {
    const { store, client } = setup();
    const snapshot = store.read()!;
    const annual = 'Acme reports annual revenue of USD 40 million for the period 2025-10-01 to 2026-09-30.';
    const reach = 'Acme reports 120 paying customers as of 2026-10-01.';
    snapshot.metrics = [
      { ...employee, id: 'annual', metricType: 'arr', value: 40_000_000, methodNote: 'ARR', passageSupport: {
        sourceUrl: url, quote: annual, asOf: '2026-09-30', basis: 'arr', unit: 'USD', definition: 'annual_revenue', periodStart: '2025-10-01' } },
      { ...employee, id: 'customers', metricType: 'users', value: 120, methodNote: 'Total users', passageSupport: {
        sourceUrl: url, quote: reach, asOf: '2026-10-01', basis: 'users', unit: 'count', definition: 'paying_customers' } },
    ];
    snapshot.originalSourceAttempts![0]!.receipts[0]!.text = `${annual} ${reach}`;
    await store.write(snapshot);
    const reopened = new GeminiRepository({ apiKey: 'test', store, client });
    const facts = await reopened.getCompanyFacts('cmp');
    expect(facts.map(row => row.value)).toEqual([40_000_000, 120]);
    expect((await reopened.getCard('card'))!.metrics).toEqual(facts);
    expect((await reopened.listSavedCards())[0]!.metrics).toEqual(facts);
    const chart = (await reopened.getDashboardTab('cmp', 'metrics'))!.content;
    expect(chart.revenue).toEqual([]);
    expect(chart.users).toEqual([]);
    const figures = overviewFigures({ company: snapshot.companies[0]!, storedMetrics: snapshot.metrics,
      marketName: 'Software', client }, snapshot.originalSourceAttempts![0]!.receipts);
    expect(figures).toContain('Annual revenue (USD): 40,000,000 — reported 2025-10-01 to 2026-09-30');
    expect(figures).toContain('Paying customers: 120');
    expect(figures).not.toContain('Users: 120');
    expect(store.read()!.metrics).toEqual(snapshot.metrics);
    expect(client.ground).not.toHaveBeenCalled();
    expect(client.structure).not.toHaveBeenCalled();
  });
  it.each([
    ['missing', 'No saved original passage'],
    ['blocked', 'Original source could not be read'],
    ['mismatch', 'Claim is not present in the saved original'],
    ['stale', 'Reporting date is outside the current evidence window'],
  ])('explains %s evidence on facts, cards and reopen without provider calls', async (fault, reason) => {
    const { store, client } = setup();
    const snapshot = store.read()!;
    const receipt = snapshot.originalSourceAttempts![0]!.receipts[0]!;
    if (fault === 'missing') snapshot.originalSourceAttempts = [];
    if (fault === 'blocked') snapshot.originalSourceAttempts![0]!.receipts = [{ requestedUrl: url, status: 'blocked', retrievedAt: employee.capturedAt, reason: 'HTTP 403' }];
    if (fault === 'mismatch') receipt.text = 'An unrelated company report.';
    if (fault === 'stale') {
      snapshot.metrics[0]!.passageSupport!.asOf = '2024-10-01';
      snapshot.metrics[0]!.passageSupport!.quote = quote.replace('2026-10-01', '2024-10-01');
      receipt.text = snapshot.metrics[0]!.passageSupport!.quote;
    }
    await store.write(snapshot);
    const reopened = new GeminiRepository({ apiKey: 'test', store, client });
    const fact = (await reopened.getCompanyFacts('cmp')).find(row => row.metricType === 'employees')!;
    expect(fact).toMatchObject({ value: null, confidence: 'unknown' });
    expect(fact.methodNote).toContain(reason);
    expect((await reopened.listSavedCards())[0]!.metrics.find(row => row.metricType === 'employees')!.methodNote).toBe(fact.methodNote);
    expect(store.read()!.metrics[0]!.value).toBe(45);
    expect(client.ground).not.toHaveBeenCalled();
    expect(client.structure).not.toHaveBeenCalled();
  });
  it('carries literal issuer ARR into the current chart without rewriting history or paying for research', async () => {
    const { store, client } = setup();
    const snapshot = store.read()!;
    const issuerUrl = 'https://acme.com/report';
    const arrQuote = 'Acme reported ARR of USD 40 million as of 2026-10-01.';
    snapshot.metrics = [{ ...employee, id: 'supported-arr', metricType: 'arr', value: 40_000_000, source: issuerUrl,
      citations: [{ title: 'Original', url: issuerUrl }], passageSupport: { sourceUrl: issuerUrl,
        quote: arrQuote, asOf: '2026-10-01', basis: 'arr', unit: 'USD' } }];
    snapshot.originalSourceAttempts![0]!.receipts[0] = { ...snapshot.originalSourceAttempts![0]!.receipts[0]!,
      requestedUrl: issuerUrl, finalUrl: issuerUrl, text: arrQuote };
    await store.write(snapshot);
    const reopened = new GeminiRepository({ apiKey: 'test', store, client });
    expect((await reopened.getDashboardTab('cmp', 'metrics'))!.content.revenue).toEqual([{ period: 'Current', value: 40_000_000 }]);
    expect((await reopened.getCompanyMetrics('cmp'))[0]!.value).toBe(40_000_000);
    expect(client.ground).not.toHaveBeenCalled();
    expect(client.structure).not.toHaveBeenCalled();
  });
  it('keeps literal issuer-backed facts across deck, inspector, saved cards and reopen', async () => {
    const { store, client } = setup();
    const snapshot = store.read()!;
    const issuerUrl = 'https://acme.com/report';
    const supported = snapshot.metrics[0]!;
    supported.source = issuerUrl;
    supported.citations = [{ title: 'Original issuer report', url: issuerUrl }];
    supported.passageSupport!.sourceUrl = issuerUrl;
    snapshot.originalSourceAttempts![0]!.receipts[0]!.requestedUrl = issuerUrl;
    snapshot.originalSourceAttempts![0]!.receipts[0]!.finalUrl = issuerUrl;
    snapshot.dashboards.cmp = { overview: { content: { markdown: 'Legacy notes' }, lastRefreshedAt: employee.capturedAt } };
    await store.write(snapshot);
    const reopened = new GeminiRepository({ apiKey: 'test', store, client });
    assertFacts(await reopened.getCompanyFacts('cmp'));
    assertFacts((await reopened.listCards('deck'))[0]!.metrics);
    assertFacts((await reopened.getCard('card'))!.metrics);
    assertFacts((await reopened.listSavedCards())[0]!.metrics);
    expect((await reopened.getDashboardTab('cmp', 'overview'))!.content.markdown).toContain('Employees: 45');
    expect((await reopened.getCompanyFacts('cmp')).find(row => row.metricType === 'employees')!.methodNote).toContain('not independently corroborated');
    expect(client.ground).not.toHaveBeenCalled();
    expect(client.structure).not.toHaveBeenCalled();
  });
  it.each(['fractional-count', 'conflict', 'wrong-company', 'missing-passage', 'market-share', 'zero-users'])(
    'withholds a %s observation instead of showing a confirmed fact', fault => {
      const { store } = setup();
      const snapshot = store.read()!;
      const row = structuredClone(employee);
      if (fault === 'fractional-count') {
        row.value = 45.5;
        row.passageSupport!.quote = quote.replace('45', '45.5');
        snapshot.originalSourceAttempts![0]!.receipts[0]!.text = row.passageSupport!.quote;
      }
      if (fault === 'missing-passage') row.passageSupport = null;
      if (fault === 'wrong-company') snapshot.originalSourceAttempts![0]!.companyId = 'other';
      if (fault === 'market-share' || fault === 'zero-users') {
        row.metricType = fault === 'market-share' ? 'market_share' : 'users';
        row.value = fault === 'market-share' ? 45 : 0;
        row.passageSupport = { ...row.passageSupport!, basis: row.metricType, unit: fault === 'market-share' ? 'percent' : 'count',
          quote: `Acme reported ${row.value}${fault === 'market-share' ? '% market share' : ' users'} as of 2026-10-01.` };
        snapshot.originalSourceAttempts![0]!.receipts[0]!.text = row.passageSupport.quote;
      }
      const rows = [row, ...(fault === 'conflict' ? [{ ...row, id: 'tie', value: 90 }] : [])];
      const facts = projectCompanyFacts(snapshot.companies[0]!, rows, snapshot.originalSourceAttempts);
      expect(facts[0]).toMatchObject({ value: null, confidence: 'unknown', citations: [] });
      expect(rows[0]!.confidence).toBe('verified');
    });
  it('preserves explicit human corrections and does not label them independently verified', () => {
    const { store } = setup();
    const snapshot = store.read()!;
    const human: CompanyMetric = { ...employee, id: 'human', value: 37, confidence: 'user_verified', passageSupport: null };
    const facts = projectCompanyFacts(snapshot.companies[0]!, [human, { ...employee, capturedAt: '2026-10-03T00:00:00.000Z' }], []);
    expect(facts).toEqual([human]);
  });
  it('agrees across company facts, deck, inspection and saved cards without rewriting observations or paid calls', async () => {
    const { repo, store, client } = setup();
    assertFacts(await repo.getCompanyFacts('cmp'));
    assertFacts((await repo.listCards('deck'))[0]!.metrics);
    assertFacts((await repo.getCard('card'))!.metrics);
    assertFacts((await repo.listSavedCards())[0]!.metrics);
    expect(await repo.getCompanyMetrics('cmp')).toEqual([employee, legacy]);
    expect(store.read()!.metrics).toEqual([employee, legacy]);
    expect(client.ground).not.toHaveBeenCalled();
    expect(client.structure).not.toHaveBeenCalled();
  });
  it('does not resurrect citation-only observations in the chart or Ask digest', async () => {
    const { repo, client } = setup();
    expect((await repo.getDashboardTab('cmp', 'metrics'))!.content.revenue).toEqual([]);
    await repo.askResearch({ scope: { kind: 'company', companyId: 'cmp', deckId: 'deck' }, question: 'What are the business figures?' });
    const prompt = vi.mocked(client.ground).mock.calls[0]![0];
    expect(prompt).toContain('employees=45');
    expect(prompt).toContain('arr=unknown');
    expect(prompt).not.toContain('999000000');
  });
  it('rechecks originals on reopen and preserves the raw historical figure', async () => {
    const { store, client } = setup();
    const snapshot = store.read()!;
    snapshot.originalSourceAttempts = [];
    await store.write(snapshot);
    const reopened = new GeminiRepository({ apiKey: 'test', store, client });
    expect((await reopened.getCompanyFacts('cmp')).find(row => row.metricType === 'employees')!.value).toBeNull();
    expect((await reopened.getCompanyMetrics('cmp')).find(row => row.metricType === 'employees')!.value).toBe(45);
  });
});
