import { describe, expect, it, vi } from 'vitest';
import { hydrateCompanyCard } from './company-agent';
import type { LlmClient, CompanyCandidate, MarketPlan } from './types';
import type { OriginalSourceServices } from './original-source';
import { discoverDeckStubs, runDeckResearch } from './pipeline';
import { GeminiRepository, migrateSnapshot, type ResearchStore } from './repository';

vi.mock('./logos', () => ({ faviconUrl: () => null, resolveLogo: async () => ({ url: null }) }));
const url = 'https://sec.gov/Archives/acme';
const quote = 'Acme Inc. reported 45 employees as of 2026-10-01.';
const candidate: CompanyCandidate = { name: 'Acme Inc.', domain: 'acme.com', descriptor: 'Business software', cardTypes: ['company'] };
const plan: MarketPlan = { marketName: 'Software', vertical: 'SaaS', geography: null, notes: null, searchThemes: [] };

function fixture(proof = true, text = quote) {
  const client: LlmClient = {
    ground: vi.fn(async () => ({ text: 'Provider says 45 employees.', citations: [{ title: 'SEC', url }], queries: [] })),
    structure: vi.fn(async (_prompt, schema) => schema.parse({
      oneLiner: 'Business software', website: 'https://acme.com',
      metrics: { employees: { value: 45, confidence: 'verified', sourceIndex: 0,
        ...(proof ? { passageSupport: { sourceUrl: url, quote, asOf: '2026-10-01', basis: 'employees', unit: 'count' } } : {}) } },
      facts: { headcount: 45, publicUserFootprint: 1000 },
    })) as LlmClient['structure'],
  };
  const originals: OriginalSourceServices = {
    retrieve: vi.fn(async (requestedUrl: string) => ({ requestedUrl, finalUrl: requestedUrl, status: 'retrieved' as const, httpStatus: 200, contentHash: 'a'.repeat(64), text, retrievedAt: '2026-10-04T00:00:00.000Z' })),
    save: vi.fn(async () => {}), list: async () => [],
  };
  return { client, originals };
}

describe('initial company original-evidence publication', () => {
  it('fills first-ready annual revenue from a retained SEC original even when the model proposes no revenue', async () => {
    const financialUrl = 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000789019/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax.json';
    const reported = { start: '2025-07-01', end: '2026-06-30', val: 331839000000, accn: '0001193125-26-323660',
      fy: 2026, fp: 'FY', form: '10-K', filed: '2026-07-29', frame: 'CY2026' };
    const text = JSON.stringify({ cik: 789019, entityName: 'MICROSOFT CORPORATION', taxonomy: 'us-gaap',
      tag: 'RevenueFromContractWithCustomerExcludingAssessedTax', units: { USD: [reported] } });
    const { client, originals } = fixture(false);
    client.ground = vi.fn(async () => ({ text: 'Company notes', citations: [{ title: 'Filing',
      url: 'https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft.htm' }], queries: [] }));
    client.structure = vi.fn(async (prompt, schema) => {
      expect(prompt).not.toContain('"units"'); // do not spend context on historical records
      expect(prompt).toContain('parsedFinancialObservation');
      return schema.parse({ oneLiner: 'Software company', metrics: { arr: { value: null, confidence: 'unknown' } } });
    }) as LlmClient['structure'];
    originals.retrieve = vi.fn(async (requestedUrl: string) => ({ requestedUrl, finalUrl: requestedUrl, status: 'retrieved' as const, httpStatus: 200,
      format: 'sec-companyconcept' as const, contentHash: 'a'.repeat(64), text, retrievedAt: '2026-10-04T00:00:00.000Z', truncated: false }));
    const result = await hydrateCompanyCard({ candidate: { ...candidate, name: 'Microsoft Corporation', domain: 'microsoft.com' }, client, plan, originalSources: originals });
    expect(originals.retrieve).toHaveBeenCalledWith(financialUrl, expect.objectContaining({ companyName: 'Microsoft Corporation' }));
    expect(result.metrics.find(row => row.metricType === 'arr')).toMatchObject({ value: reported.val, confidence: 'verified',
      passageSupport: { definition: 'annual_revenue', format: 'sec-companyconcept', periodStart: reported.start, asOf: reported.end } });
    expect(result.primaryCard.metrics).toEqual(result.metrics);
    expect(client.ground).toHaveBeenCalledTimes(1);
    expect(client.structure).toHaveBeenCalledTimes(1);
  });
  it('keeps a typed customer population from first hydration through memory and offline facts', async () => {
    const text = 'Acme Inc. reported 120 monthly active users as of 2026-10-01.';
    const { client, originals } = fixture(true, text);
    client.structure = vi.fn(async (prompt, schema) => {
      expect(prompt).toContain('definition to the actual measurement');
      return schema.parse({ metrics: { users: { value: 120, confidence: 'verified', sourceIndex: 0, passageSupport: {
        sourceUrl: url, quote: text, asOf: '2026-10-01', basis: 'users', unit: 'count', definition: 'monthly_active_users',
      } } } });
    }) as LlmClient['structure'];
    const result = await hydrateCompanyCard({ candidate, client, plan, originalSources: originals });
    const userMetric = result.metrics.find(row => row.metricType === 'users')!;
    expect(userMetric).toMatchObject({ value: 120, confidence: 'verified', passageSupport: { definition: 'monthly_active_users' } });
    expect(result.primaryCard.metrics).toEqual(result.metrics);
    expect(result.memory.card.metrics).toEqual(result.metrics);
    const snapshot = migrateSnapshot(null).snapshot;
    snapshot.companies = [result.company!]; snapshot.metrics = result.metrics;
    snapshot.originalSourceAttempts = [vi.mocked(originals.save).mock.calls[0]![0]];
    const repository = new GeminiRepository({ apiKey: 'test', client, store: {
      read: () => structuredClone(snapshot), write: async () => {},
    } });
    expect((await repository.getCompanyFacts(result.company!.id)).find(row => row.metricType === 'users')).toMatchObject(userMetric);
    expect(client.ground).toHaveBeenCalledTimes(1);
    expect(client.structure).toHaveBeenCalledTimes(1);
  });
  it('retains the accepted proof from first card through overview and offline reopen', async () => {
    const { client, originals } = fixture();
    const card = await hydrateCompanyCard({ candidate, client, plan, originalSources: originals });
    expect(card.metrics.find(row => row.metricType === 'employees')!.passageSupport).toMatchObject({ quote, asOf: '2026-10-01', basis: 'employees' });
    let snapshot = migrateSnapshot(null).snapshot;
    snapshot.companies = [card.company!];
    snapshot.metrics = card.metrics;
    snapshot.originalSourceAttempts = [vi.mocked(originals.save).mock.calls[0]![0]];
    const store: ResearchStore = { read: () => structuredClone(snapshot), write: async value => { snapshot = structuredClone(value); } };
    const overviewClient: LlmClient = { ground: vi.fn(), structure: vi.fn(async (_prompt, schema) => schema.parse({ excerpts: [] })) as LlmClient['structure'] };
    const repository = new GeminiRepository({ apiKey: 'test', store, client: overviewClient });
    const result = await repository.getDashboardTab(card.company!.id, 'overview');
    expect(result!.content.markdown).toContain('Employees: 45');
    expect(result!.content.markdown).toContain('2026-10-01');
    expect(result!.content.markdown).toContain('ARR (USD): Unknown');
    const reopened = new GeminiRepository({ apiKey: 'test', store, client: overviewClient });
    expect(await reopened.getDashboardTab(card.company!.id, 'overview')).toEqual(result);
    expect(overviewClient.ground).not.toHaveBeenCalled();
    expect(overviewClient.structure).toHaveBeenCalledTimes(1);
    // Loss of backing evidence after a saved overview must not resurrect its
    // cached financial prose. Historical originals/notes are not overwritten.
    snapshot.originalSourceAttempts = [];
    const withoutEvidence = new GeminiRepository({ apiKey: 'test', store, client: overviewClient });
    expect((await withoutEvidence.getDashboardTab(card.company!.id, 'overview'))!.content.markdown).toContain('Employees: Unknown');
    expect(overviewClient.structure).toHaveBeenCalledTimes(1);
  });
  it('uses the same two-source priority policy before filling the first company card', async () => {
    const { client, originals } = fixture();
    client.ground = vi.fn(async () => ({ text: 'Provider says 45 employees.', queries: [], citations: [
      { title: 'Discussion', url: 'https://reddit.com/r/company' },
      { title: 'Unrelated shop', url: 'https://retailer.example/report' },
      { title: 'SEC', url },
      { title: 'Company results', url: 'https://acme.com/results' },
    ] }));
    const result = await hydrateCompanyCard({ candidate, client, plan, originalSources: originals });
    expect(vi.mocked(originals.retrieve).mock.calls.map(([target]) => target)).toEqual([url, 'https://acme.com/results']);
    expect(result.metrics.find(metric => metric.metricType === 'employees')).toMatchObject({ value: 45, confidence: 'verified' });
    expect(client.ground).toHaveBeenCalledTimes(1);
    expect(client.structure).toHaveBeenCalledTimes(1);
  });
  it.each([
    'Acme Inc. partners with Beta. Beta reported 45 employees as of 2026-10-01.',
    'Acme Inc. reported 45 employees in an article published on 2026-10-01.',
  ])('keeps ambiguous original claims unknown on both card and retained memory: %s', async (text) => {
    const { client, originals } = fixture(true, text);
    client.structure = vi.fn(async (_prompt, schema) => schema.parse({ metrics: {
      employees: { value: 45, confidence: 'verified', sourceIndex: 0, passageSupport: {
        sourceUrl: url, quote: text, asOf: '2026-10-01', basis: 'employees', unit: 'count',
      } },
    } })) as LlmClient['structure'];
    const result = await hydrateCompanyCard({ candidate, client, plan, originalSources: originals });
    expect(result.metrics.find((metric) => metric.metricType === 'employees')).toMatchObject({ value: null, confidence: 'unknown' });
    expect(result.primaryCard.metrics).toEqual(result.metrics);
    expect(result.memory.card.metrics).toEqual(result.metrics);
    expect(originals.save).toHaveBeenCalledTimes(1);
    expect(client.ground).toHaveBeenCalledTimes(1);
    expect(client.structure).toHaveBeenCalledTimes(1);
  });
  it('does not publish citation-only model figures on the protected path', async () => {
    const { client, originals } = fixture(false);
    const result = await hydrateCompanyCard({ candidate, client, plan, originalSources: originals });
    expect(result.metrics.find((m) => m.metricType === 'employees')).toMatchObject({ value: null, confidence: 'unknown' });
  });
  it('publishes supported figures consistently without filling missing ARR from headcount', async () => {
    const { client, originals } = fixture();
    const result = await hydrateCompanyCard({ candidate, client, plan, originalSources: originals });
    expect(result.metrics.find((m) => m.metricType === 'employees')).toMatchObject({ value: 45, confidence: 'verified', source: url });
    expect(result.metrics.find((m) => m.metricType === 'employees')!.methodNote).toContain('2026-10-01');
    expect(result.metrics.find((m) => m.metricType === 'arr')).toMatchObject({ value: null, confidence: 'unknown' });
    expect(result.primaryCard.metrics).toEqual(result.metrics);
    expect(result.memory.card.metrics).toEqual(result.metrics);
    expect(client.ground).toHaveBeenCalledTimes(1);
    expect(client.structure).toHaveBeenCalledTimes(1);
  });
  it('keeps a supported zero ARR instead of replacing it with a headcount proxy', async () => {
    const zeroQuote = 'Acme Inc. reported ARR of USD 0 as of 2026-10-01.';
    const { client, originals } = fixture(true, zeroQuote);
    client.structure = (async (_prompt, schema) => schema.parse({ metrics: {
      arr: { value: 0, confidence: 'verified', sourceIndex: 0, passageSupport: {
        sourceUrl: url, quote: zeroQuote, asOf: '2026-10-01', basis: 'arr', unit: 'USD',
      } },
    }, facts: { headcount: 45 } })) as LlmClient['structure'];
    const result = await hydrateCompanyCard({ candidate, client, plan, originalSources: originals });
    expect(result.metrics.find((metric) => metric.metricType === 'arr')).toMatchObject({ value: 0, confidence: 'verified' });
  });
  it.each(['Publisher homepage.', quote.replace('Acme Inc.', 'Other Inc.')])('rejects missing or wrong-company original text: %s', async (text) => {
    const { client, originals } = fixture(true, text);
    const result = await hydrateCompanyCard({ candidate, client, plan, originalSources: originals });
    expect(result.metrics.every((m) => m.value === null && m.confidence === 'unknown')).toBe(true);
  });
  it('persists scoped originals before interpretation and includes them as untrusted data', async () => {
    const { client, originals } = fixture();
    await hydrateCompanyCard({ candidate, client, plan, originalSources: originals, companyId: 'cmp_acme' });
    expect(originals.save).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'cmp_acme', metricType: 'company_profile', receipts: [expect.objectContaining({ text: quote })] }));
    expect(vi.mocked(originals.save).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(client.structure).mock.invocationCallOrder[0]!);
    expect(vi.mocked(client.structure).mock.calls[0]![0]).toContain('UNTRUSTED ORIGINAL EXTRACTS');
    expect(vi.mocked(client.structure).mock.calls[0]![0]).toContain(quote);
  });
  it('does not interpret or publish when original evidence cannot be saved', async () => {
    const { client, originals } = fixture();
    originals.save = vi.fn(async () => { throw new Error('Disk full'); });
    await expect(hydrateCompanyCard({ candidate, client, plan, originalSources: originals })).rejects.toThrow('Disk full');
    expect(client.structure).not.toHaveBeenCalled();
  });
  it('does not expose discovery headline numbers before original checking', async () => {
    const { client, originals } = fixture();
    client.structure = (async (prompt, schema) => schema.parse(prompt.includes('market definition')
      ? plan : { companies: [{ ...candidate, reportedArr: 9000000000, reportedHeadcount: 45 }] })) as LlmClient['structure'];
    const result = await discoverDeckStubs({ prompt: 'Software', region: null }, client, {
      apiKey: '', originalSources: originals, catalogMax: 1, catalogPasses: 0,
      coverage: { companies: { min: 1, target: 1, max: 1 } },
    });
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]!.metrics).toEqual([]);
  });
  it('retains original checking when a deck resumes from its saved catalog', async () => {
    const { client, originals } = fixture(false);
    const timestamp = new Date().toISOString();
    const result = await runDeckResearch({ prompt: 'Software', region: null }, client, {
      apiKey: '', originalSources: originals,
      resume: { plan, candidates: [candidate], completedCards: [],
        market: { id: 'mkt_test', name: 'Software', scopeDefinition: { vertical: 'SaaS', geography: null, notes: null }, refreshCadence: 'weekly', createdAt: timestamp },
        deck: { id: 'dck_test', marketId: 'mkt_test', createdAt: timestamp, lastRefreshedAt: null } },
    });
    const card = result.cards.find((entry) => entry.company?.name === candidate.name)!;
    expect(card.metrics.length).toBeGreaterThan(0);
    expect(card.metrics.every((metric) => metric.value === null && metric.confidence === 'unknown')).toBe(true);
    expect(originals.save).toHaveBeenCalledTimes(1);
  });
});
