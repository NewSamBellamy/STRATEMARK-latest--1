import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { readEnv } from '../env';
import { CloudDeckService, MockFirebaseAdapter } from '../lib/CloudDeckService';
import { MemoryDataStore } from '../lib/firestoreStore';
import { resolveClient } from '../lib/client';
import type { CardWithCompany, CompanyMetric } from '@mi/contracts';
import { retrieveOriginalSource } from '../lib/original-source';

vi.mock('../lib/original-source', () => ({ retrieveOriginalSource: vi.fn(async (url: string) => ({
  requestedUrl: url, finalUrl: url, status: 'retrieved', text: 'Example Company annual revenue is 100.',
  contentHash: 'a'.repeat(64), retrievedAt: '2026-10-03T00:00:00.000Z',
})) }));

vi.mock('../lib/client', async (original) => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...await original<typeof import('../lib/client')>(), resolveClient: vi.fn(),
}));

const citation = { title: 'Filing', url: 'https://sec.gov/Archives/report', credibility: 'primary' as const };
const capturedAt = '2026-08-01T00:00:00.000Z';
const lastVerifiedAt = '2026-08-02T00:00:00.000Z';
afterEach(() => { vi.clearAllMocks(); vi.mocked(retrieveOriginalSource).mockReset(); });

async function run(out: { verdict: string; currentValue: number | null; figures?: unknown[] }, patch: Partial<CompanyMetric> = {}, correction?: unknown, failStructure = false, manySources = false, duplicates: CompanyMetric[] = [], route = 'verify', issuerReported = false, measuredProof?: CompanyMetric['passageSupport']) {
  const activeCitation = issuerReported ? { ...citation, url: 'https://example-company.com/report' } : citation;
  const store = new MemoryDataStore();
  const auth = new MockFirebaseAdapter();
  const service = new CloudDeckService(store, auth, auth);
  const app = createApp(readEnv({ GEMINI_API_KEY: 'test-key', APP_TOKEN: 'app-token' }), {
    store, cloudDeckService: service, forceMemoryStore: true,
  });
  const ground = vi.fn().mockResolvedValue({ text: 'Research notes', citations: manySources ? [activeCitation, { ...activeCitation, url: `${activeCitation.url}/second` }, { ...activeCitation, url: `${activeCitation.url}/third` }] : [activeCitation] });
  const quote = measuredProof?.quote ?? `Example Company reports ARR of USD ${out.currentValue ?? 100} as of 2026-10-01.`;
  vi.mocked(retrieveOriginalSource).mockImplementation(async (url) => ({ requestedUrl: url, finalUrl: url, status: 'retrieved', text: quote, httpStatus: 200, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-03T00:00:00.000Z' }));
  const structure = vi.fn().mockResolvedValue({ ...out, rationale: 'Test result', methodNote: null,
    passageSupport: measuredProof ?? { sourceUrl: activeCitation.url, quote, asOf: '2026-10-01', basis: 'arr', unit: 'USD' } });
  if (failStructure) structure.mockRejectedValue(new Error('Interpretation failed'));
  vi.mocked(resolveClient).mockReturnValue({ client: { ground, structure }, keySource: 'server' } as unknown as ReturnType<typeof resolveClient>);
  await service.saveDeck('user_123', 'deck_test', {
    deck: { id: 'deck_test' }, market: { id: 'deck_test' }, state: { status: 'ready' },
    ...(manySources ? { originalSourceAttempts: Array.from({ length: 8 }, (_, index) => ({ companyId: `old_${index}`, metricType: 'arr', capturedAt, receipts: [] })) } : {}),
    cards: [{
      card: { id: 'card_test', deckId: 'deck_test', companyId: 'company_test', cardType: 'company' },
      company: { id: 'company_test', name: 'Example Company', oneLiner: 'Test company',
        ...(issuerReported ? { websiteUrl: 'https://example-company.com' } : {}) },
      metrics: [{ id: 'metric_test', companyId: 'company_test', metricType: 'arr', value: 100,
        confidence: 'verified', citations: [activeCitation], source: activeCitation.url, methodNote: null,
        capturedAt, lastVerifiedAt, ...patch }, ...duplicates], viceClaims: [],
    }] as unknown as CardWithCompany[],
  });
  const response = await app.request(`/api/research/${route}`, {
    method: 'POST', headers: { Authorization: 'Bearer valid_token', 'X-Stratemark-Token': 'app-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ deckId: 'deck_test', companyId: 'company_test', metricType: patch.metricType ?? 'arr', correction }),
  });
  expect(response.status).toBe(failStructure ? 500 : 200);
  const result = await response.json() as { metric: CompanyMetric; verdict: string; changed: boolean; filledTypes?: string[]; metrics?: CompanyMetric[] };
  const stored = (await service.getDeck('user_123', 'deck_test'))!.cards![0]!.metrics[0]!;
  const attempt = await service.getDeck('user_123', 'deck_test');
  return { result, stored, ground, structure, attempt };
}

describe('cloud metric verification integrity', () => {
  it.each(['verify', 'hunt-metrics'])('fills unknown annual revenue through the authorized %s route from a retained SEC record', async route => {
    const url = 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000789019/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax.json';
    const text = JSON.stringify({ cik: 789019, entityName: 'MICROSOFT CORPORATION', taxonomy: 'us-gaap',
      tag: 'RevenueFromContractWithCustomerExcludingAssessedTax', units: { USD: [{ start: '2025-07-01', end: '2026-06-30',
        val: 331839000000, accn: '0001193125-26-323660', fy: 2026, fp: 'FY', form: '10-K', filed: '2026-07-29' }] } });
    const store = new MemoryDataStore(), auth = new MockFirebaseAdapter();
    const service = new CloudDeckService(store, auth, auth);
    const app = createApp(readEnv({ GEMINI_API_KEY: 'test-key', APP_TOKEN: 'app-token' }), {
      store, cloudDeckService: service, forceMemoryStore: true,
    });
    const ground = vi.fn().mockResolvedValue({ text: 'Financial filing locator', citations: [{ title: 'SEC filing',
      url: 'https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft.htm' }], queries: [] });
    const structure = vi.fn().mockResolvedValue({ figures: [] });
    vi.mocked(resolveClient).mockReturnValue({ client: { ground, structure }, keySource: 'server' } as unknown as ReturnType<typeof resolveClient>);
    vi.mocked(retrieveOriginalSource).mockImplementation(async requestedUrl => ({ requestedUrl, finalUrl: requestedUrl,
      status: 'retrieved', text, format: 'sec-companyconcept', truncated: false, httpStatus: 200,
      contentHash: 'a'.repeat(64), retrievedAt: '2026-10-03T00:00:00.000Z' }));
    await service.saveDeck('user_123', 'deck_sec', { deck: { id: 'deck_sec' }, market: { id: 'deck_sec' }, state: { status: 'ready' },
      cards: [{ card: { id: 'card_sec', deckId: 'deck_sec', companyId: 'cmp_sec', cardType: 'company' },
        company: { id: 'cmp_sec', name: 'Microsoft Corporation', oneLiner: 'Software', websiteUrl: 'https://microsoft.com' },
        metrics: [{ id: 'metric_sec', companyId: 'cmp_sec', metricType: 'arr', value: null, confidence: 'unknown',
          citations: [], source: null, methodNote: null, capturedAt }], viceClaims: [] }] as unknown as CardWithCompany[],
    });
    const response = await app.request(`/api/research/${route}`, { method: 'POST',
      headers: { Authorization: 'Bearer valid_token', 'X-Stratemark-Token': 'app-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ deckId: 'deck_sec', companyId: 'cmp_sec', metricType: 'arr' }) });
    expect(response.status).toBe(200);
    const persisted = await new CloudDeckService(store, auth, auth).getDeck('user_123', 'deck_sec');
    expect(persisted!.cards![0]!.metrics[0]).toMatchObject({ value: 331839000000, confidence: 'verified',
      passageSupport: { sourceUrl: url, definition: 'annual_revenue', format: 'sec-companyconcept',
        periodStart: '2025-07-01', asOf: '2026-06-30' } });
    expect(persisted!.originalSourceAttempts![0]!.receipts[0]).toMatchObject({ text, format: 'sec-companyconcept' });
    expect(retrieveOriginalSource).toHaveBeenCalledWith(url, undefined, expect.objectContaining({ companyId: 'cmp_sec', companyName: 'Microsoft Corporation' }));
    expect(ground).toHaveBeenCalledTimes(1);
    expect(structure).toHaveBeenCalledTimes(route === 'verify' ? 0 : 1);
  });
  it('persists a typed annual reporting interval through the authorized verification route without treating it as ARR', async () => {
    const proof: NonNullable<CompanyMetric['passageSupport']> = { sourceUrl: citation.url,
      quote: 'Example Company reports annual revenue of USD 100 for the period 2025-10-01 to 2026-09-30.',
      asOf: '2026-09-30', basis: 'arr', unit: 'USD', definition: 'annual_revenue', periodStart: '2025-10-01' };
    const { result, stored, structure } = await run({ verdict: 'supported', currentValue: 100 }, {}, undefined, false, false, [], 'verify', false, proof);
    expect(result.verdict).toBe('supported');
    expect(result.changed).toBe(true);
    expect(stored.passageSupport).toEqual(proof);
    expect(structure.mock.calls[0]![0]).toContain('Do not annualize monthly revenue');
  });
  it('persists a checked issuer figure without claiming independent corroboration', async () => {
    const { result, stored } = await run({ verdict: 'contradicted', currentValue: 900 },
      { confidence: 'estimated' }, undefined, false, false, [], 'verify', true);
    expect(result.verdict).toBe('contradicted');
    expect(stored).toMatchObject({ value: 900, confidence: 'verified' });
    expect(stored.citations[0]!.title).toContain('not independently corroborated');
    expect(stored.passageSupport!.sourceUrl).toBe('https://example-company.com/report');
  });
  it('selects the latest duplicate rather than overwriting the first cloud row', async () => {
    const duplicate: CompanyMetric = { id: 'latest', companyId: 'company_test', metricType: 'arr', value: 200,
      confidence: 'estimated', citations: [], source: null, methodNote: null, capturedAt: '2026-09-01T00:00:00.000Z' };
    const { result, stored } = await run({ verdict: 'contradicted', currentValue: 900 }, {}, undefined, false, false, [duplicate]);
    expect(result.metric.id).toBe('latest');
    expect(result.metric.value).toBe(900);
    expect(stored.value).toBe(100);
  });

  it('does not spend on a human-locked cloud duplicate', async () => {
    const duplicate: CompanyMetric = { id: 'human', companyId: 'company_test', metricType: 'arr', value: 200,
      confidence: 'user_verified', citations: [], source: null, methodNote: null, capturedAt };
    const { result, ground } = await run({ verdict: 'contradicted', currentValue: 900 }, {}, undefined, false, false, [duplicate]);
    expect(result.metric.id).toBe('human');
    expect(result.changed).toBe(false);
    expect(ground).not.toHaveBeenCalled();
  });

  it('does not promote a cloud hunt figure without its matching original passage', async () => {
    const { result } = await run({ verdict: 'contradicted', currentValue: 900,
      figures: [{ metricType: 'arr', value: 900, methodNote: 'Citation alone' }] }, { confidence: 'estimated' }, undefined, false, false, [], 'hunt-metrics');
    expect(result.filledTypes).toEqual([]);
    expect(result.metrics![0]!.value).toBe(100);
  });

  it('accepts a cloud hunt figure with retained original support and preserves it on reopen', async () => {
    const { result, attempt } = await run({ verdict: 'contradicted', currentValue: 900,
      figures: [{ metricType: 'arr', value: 900, methodNote: null, passageSupport: {
        sourceUrl: citation.url, quote: 'Example Company reports ARR of USD 900 as of 2026-10-01.', asOf: '2026-10-01', basis: 'arr', unit: 'USD' } }] },
      { confidence: 'estimated' }, undefined, false, false, [], 'hunt-metrics');
    expect(result.filledTypes).toEqual(['arr']);
    expect(attempt!.originalSourceAttempts).toEqual([expect.objectContaining({ metricType: 'metrics_hunt' })]);
    expect(attempt!.cards![0]!.metrics[0]!.value).toBe(900);
  });

  it('does not accept a citation-only correction when its original page is unavailable', async () => {
    vi.mocked(retrieveOriginalSource).mockResolvedValueOnce({ requestedUrl: citation.url, status: 'unavailable', retrievedAt: '2026-10-03T00:00:00.000Z' });
    const { result, stored, ground, structure } = await run({ verdict: 'contradicted', currentValue: 900 }, {}, { value: 900, citations: [citation] });
    expect(result.verdict).toBe('unverified');
    expect(stored.value).toBe(100);
    expect(ground).toHaveBeenCalledTimes(1);
    expect(structure).not.toHaveBeenCalled();
  });
  it('persists scoped originals before interpretation and keeps them on model failure', async () => {
    const { attempt } = await run({ verdict: 'unverified', currentValue: null }, {}, undefined, true);
    expect(attempt).toHaveProperty('originalSourceAttempts', [expect.objectContaining({
      companyId: 'company_test', metricType: 'arr',
      receipts: [expect.objectContaining({ status: 'retrieved', text: 'Example Company reports ARR of USD 100 as of 2026-10-01.' })],
    })]);
  });

  it('supplies retrieved originals as untrusted content, not as automatic verification', async () => {
    const { structure, result } = await run({ verdict: 'unverified', currentValue: null });
    expect(structure.mock.calls[0]![0]).toContain('UNTRUSTED ORIGINAL EXTRACTS');
    expect(structure.mock.calls[0]![0]).toContain('Example Company reports ARR of USD 100 as of 2026-10-01.');
    expect(result!.verdict).toBe('unverified');
    expect(retrieveOriginalSource).toHaveBeenCalledTimes(1);
  });

  it('retains unavailable receipt without interpreting it as absence or changing the number', async () => {
    vi.mocked(retrieveOriginalSource).mockResolvedValueOnce({ requestedUrl: citation.url, status: 'unavailable', retrievedAt: '2026-10-03T00:00:00.000Z', reason: 'Source did not return a readable public page' });
    const { stored, attempt } = await run({ verdict: 'unverified', currentValue: null });
    expect(stored.value).toBe(100);
    expect(stored.lastVerifiedAt).toBe(lastVerifiedAt);
    expect(attempt!.originalSourceAttempts![0]!.receipts[0]!.status).toBe('unavailable');
  });

  it('caps automatic reads at two and keeps only the explicit rolling diagnostic history', async () => {
    const { attempt } = await run({ verdict: 'unverified', currentValue: null }, {}, undefined, false, true);
    expect(retrieveOriginalSource).toHaveBeenCalledTimes(2);
    expect(attempt!.originalSourceAttempts).toHaveLength(8);
    expect(attempt!.originalSourceAttempts![0]!.companyId).toBe('old_1');
    expect(attempt!.originalSourceAttempts![7]!.receipts).toHaveLength(2);
  });
  it.each([
    { verdict: 'unverified', currentValue: 900 },
    { verdict: 'supported', currentValue: 900 },
    { verdict: 'contradicted', currentValue: 100 },
    { verdict: 'supported', currentValue: null },
    { verdict: 'contradicted', currentValue: -10 },
  ])('retains the number and support dates on an inconsistent result: %j', async (out) => {
    const { result, stored } = await run(out);
    expect(result.verdict).toBe('unverified');
    expect(stored.value).toBe(100);
    expect(stored.confidence).toBe('estimated');
    expect(stored.capturedAt).toBe(capturedAt);
    expect(stored.lastVerifiedAt).toBe(lastVerifiedAt);
    expect(stored.lastVerificationAttemptAt).toBeTruthy();
  });

  it('persists an inconclusive attempt even when the metric was already unknown', async () => {
    const { stored } = await run({ verdict: 'unverified', currentValue: null }, { confidence: 'unknown', value: null });
    expect(stored.value).toBeNull();
    expect(stored.lastVerifiedAt).toBe(lastVerifiedAt);
    expect(stored.lastVerificationAttemptAt).toBeTruthy();
  });

  it('never rewrites human-reviewed values or support dates', async () => {
    const { stored, ground } = await run({ verdict: 'contradicted', currentValue: 900 }, { confidence: 'user_verified' });
    expect(stored.value).toBe(100);
    expect(stored.confidence).toBe('user_verified');
    expect(stored.lastVerifiedAt).toBe(lastVerifiedAt);
    // A protected human row now skips research entirely, so no attempt is invented.
    expect(stored.lastVerificationAttemptAt).toBeUndefined();
    expect(ground).not.toHaveBeenCalled();
  });

  it.each([-20, '900'])('does not apply an invalid shortcut value %s', async (value) => {
    const { stored, ground } = await run({ verdict: 'unverified', currentValue: null }, {}, { value, citations: [citation] });
    expect(ground).toHaveBeenCalledTimes(1);
    expect(stored.value).toBe(100);
    expect(stored.lastVerifiedAt).toBe(lastVerifiedAt);
  });

  it('does not apply a market-share shortcut above 100', async () => {
    const { stored, ground } = await run({ verdict: 'unverified', currentValue: null }, { metricType: 'market_share', value: 20 }, { value: 101, citations: [citation] });
    expect(ground).toHaveBeenCalledTimes(1);
    expect(stored.value).toBe(20);
  });

  it('does not let a correction hint override an inconclusive original check', async () => {
    const { stored, ground, structure } = await run({ verdict: 'unverified', currentValue: null }, {}, { value: 200, citations: [citation] });
    expect(stored.value).toBe(100);
    expect(stored.lastVerificationAttemptAt).toBeTruthy();
    expect(stored.lastVerifiedAt).toBe(lastVerifiedAt);
    expect(ground).toHaveBeenCalledTimes(1);
    expect(structure).toHaveBeenCalledTimes(1);
  });

  it('supports a real zero without declaring it a changed value', async () => {
    const { result, stored } = await run({ verdict: 'supported', currentValue: 0 }, { value: 0 });
    expect(result.verdict).toBe('supported');
    expect(result.changed).toBe(false);
    expect(stored.lastVerifiedAt).not.toBe(lastVerifiedAt);
  });

  it.each([false, true])('attaches support when confirming an existing estimate (shortcut=%s)', async (shortcut) => {
    const { result, stored } = await run({ verdict: 'supported', currentValue: 100 },
      { confidence: 'estimated', source: null, citations: [] },
      shortcut ? { value: 100, citations: [citation], rationale: 'Confirmed in filing' } : undefined);
    expect(result.verdict).toBe('supported');
    expect(result.changed).toBe(true); // evidence/confidence changed, not the number
    expect(stored.value).toBe(100);
    expect(stored.confidence).toBe('verified');
    expect(stored.source).toBe(citation.url);
    expect(stored.citations).toEqual([expect.objectContaining({ url: citation.url, credibility: 'primary' })]);
    expect(stored.capturedAt).toBe(capturedAt);
  });
});
