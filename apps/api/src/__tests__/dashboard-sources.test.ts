import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardWithCompany } from '@mi/contracts';
import { createApp } from '../app';
import { readEnv } from '../env';
import { CloudDeckService, MockFirebaseAdapter } from '../lib/CloudDeckService';
import { MemoryDataStore } from '../lib/firestoreStore';
import { resolveClient } from '../lib/client';
import { retrieveOriginalSource } from '../lib/original-source';
import { extractProviderGrounding } from '../../../../packages/research/src/grounding-support';

vi.mock('../lib/original-source', () => ({ retrieveOriginalSource: vi.fn() }));

vi.mock('../lib/client', async original => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...await original<typeof import('../lib/client')>(), resolveClient: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
const headers = { Authorization: 'Bearer valid_token', 'X-Stratemark-Token': 'app-token', 'Content-Type': 'application/json' };
const input = { deckId: 'deck_test', companyId: 'cmp', tab: 'history' };
const supportedResponse = (text: string, url: string) => ({ text, queries: [], citations: [{ title: 'Official', url }],
  grounding: extractProviderGrounding(text, { groundingChunks: [{ web: { uri: url, title: 'Official' } }],
    groundingSupports: [{ segment: { text }, groundingChunkIndices: [0] }] }) });
async function setup(cap = '10') {
  const store = new MemoryDataStore();
  const auth = new MockFirebaseAdapter();
  const service = new CloudDeckService(store, auth, auth);
  const app = createApp(readEnv({ GEMINI_API_KEY: 'test', APP_TOKEN: 'app-token', DAILY_CAP_USD: cap }), { store, cloudDeckService: service, forceMemoryStore: true });
  const ground = vi.fn().mockResolvedValue({ text: 'Software company', citations: [{ title: 'Official', url: 'https://example.com/report' }], queries: [] });
  const structure = vi.fn().mockResolvedValue({ markdown: 'Software company' });
  vi.mocked(resolveClient).mockReturnValue({ client: { ground, structure }, keySource: 'server' });
  await service.saveDeck('user_123', 'deck_test', { deck: { id: 'deck_test', marketId: 'market' }, market: { id: 'market', name: 'Software' },
    cards: [{ card: { id: 'card', companyId: 'cmp' }, company: { id: 'cmp', name: 'Example', websiteUrl: 'https://example.com' }, metrics: [], viceClaims: [] }] as unknown as CardWithCompany[] });
  const post = (body: unknown = input, requestHeaders = headers) => app.request('/api/research/tab', { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) });
  return { app, post, ground, structure, service, store };
}
describe('actual cloud dashboard source transport and authorization', () => {
  it('retains product originals on the authorized route, searches current status once per request, and rereads only on force', async () => {
    const { post, ground, structure, service } = await setup();
    const url = 'https://example.com/atlas';
    const quote = 'Atlas is now available for independent company researchers.';
    ground.mockResolvedValue({ text: 'Invented adoption numbers', citations: [{ title: 'Official product', url }], queries: [] });
    structure.mockResolvedValue({ products: [{ name: 'Atlas', status: 'live', sourceUrl: url, quote,
      description: 'Invented financials', revenueNote: '$999B', url: 'https://fake.example' }], roadmap: [] } as never);
    vi.mocked(retrieveOriginalSource).mockResolvedValue({ requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200,
      contentHash: 'a'.repeat(64), text: quote, retrievedAt: new Date().toISOString() });
    const response = await post({ ...input, tab: 'products_roadmap' });
    expect(response.status).toBe(200);
    const result = await response.json() as { content: { products: Array<{ description: string; revenueNote: string; url: string }> }; citations: Array<{ url: string }> };
    expect(result.content.products[0]).toMatchObject({ description: expect.stringContaining(quote), revenueNote: '', url });
    expect(JSON.stringify(result)).not.toContain('Invented');
    expect(result.citations[0]!.url).toBe(url);
    const retained = await service.getOriginalSources('user_123', 'deck_test').list({ companyId: 'cmp', metricType: 'products_roadmap' });
    expect(retained).toHaveLength(1);
    expect(retained[0]!.receipts[0]!.text).toBe(quote);
    expect((await post({ ...input, tab: 'products_roadmap' })).status).toBe(200);
    expect(ground).toHaveBeenCalledTimes(2);
    expect(retrieveOriginalSource).toHaveBeenCalledTimes(1);
    expect((await post({ ...input, tab: 'products_roadmap', force: true })).status).toBe(200);
    expect(ground).toHaveBeenCalledTimes(3);
    expect(retrieveOriginalSource).toHaveBeenCalledTimes(2);
  });
  it('writes an authorized provider-supported overview in one ground/structure pass without original retrieval', async () => {
    const { post, structure, ground, service } = await setup();
    const url = 'https://example.com/';
    const quote = 'Example sells research software for independent analysts.';
    vi.mocked(retrieveOriginalSource).mockResolvedValue({ requestedUrl: 'https://example.com', finalUrl: url,
      status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), text: quote, retrievedAt: new Date().toISOString() });
    ground.mockResolvedValue(supportedResponse(quote, url));
    structure.mockResolvedValue({ paragraphs: [{ section: 'background', text: quote, sourceUrls: [url], supportIndices: [0] }],
      markdown: 'Fabricated $999B valuation' } as never);
    const response = await post({ ...input, tab: 'overview' });
    expect(response.status).toBe(200);
    const result = await response.json() as { content: { markdown: string }; citations: Array<{ url: string }>; sourceDiagnostics: { reads: Array<{ host: string; outcome: string }>; acceptedExcerptCount: number } };
    expect(result.content.markdown).toContain(quote);
    expect(result.content.markdown).toContain('not independently verified');
    expect(result.content.markdown).not.toContain('999B');
    expect(result.citations).toEqual([expect.objectContaining({ url })]);
    expect(result.sourceDiagnostics).toMatchObject({ reads: [], acceptedExcerptCount: 0 });
    expect(retrieveOriginalSource).not.toHaveBeenCalled();
    expect(ground).toHaveBeenCalledTimes(1);
    expect(structure).toHaveBeenCalledTimes(1);
    expect(structure.mock.calls[0]![0]).toContain(quote);
    expect(structure.mock.calls[0]![0]).toContain('GOOGLE PROVIDER SUPPORT CATALOG');
    const retained = await service.getOriginalSources('user_123', 'deck_test').list({ companyId: 'cmp', metricType: 'overview' });
    expect(retained).toEqual([]);
  });
  it('retains leadership originals and returns source-linked people on the actual cloud route', async () => {
    const { post, structure, ground, service } = await setup();
    const url = 'https://example.com/team';
    const quote = 'Avery Founder is Example co-founder and Chief Executive Officer.';
    ground.mockResolvedValue({ text: 'Official leadership page', citations: [{ title: 'Leadership', url }], queries: [] });
    structure.mockResolvedValue({ nodes: [{ id: 'avery', name: 'Avery Founder', role: 'Chief Executive Officer', group: 'exec',
      parentName: null, bio: quote, tenure: null, priorCompany: null, notableProject: null, sourceUrl: url, quote }] } as never);
    vi.mocked(retrieveOriginalSource).mockResolvedValue({ requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200,
      contentHash: 'a'.repeat(64), text: quote, retrievedAt: '2026-10-06T00:00:00.000Z' });
    const response = await post({ ...input, tab: 'team_org' });
    expect(response.status).toBe(200);
    const result = await response.json() as { content: { nodes: Array<{ name: string; sourceUrl: string; supportingQuote: string }> }; citations: Array<{ url: string }> };
    expect(result.content.nodes).toEqual([expect.objectContaining({ name: 'Avery Founder', sourceUrl: url, supportingQuote: quote })]);
    expect(result.citations).toEqual([expect.objectContaining({ url })]);
    expect(retrieveOriginalSource).toHaveBeenCalledWith(url, undefined, { companyId: 'cmp', companyName: 'Example', metricType: 'team_org' });
    const retained = await service.getOriginalSources('user_123', 'deck_test').list({ companyId: 'cmp', metricType: 'team_org' });
    expect(retained).toHaveLength(1);
    expect(retained[0]!.receipts[0]!.text).toBe(quote);
    await post({ ...input, tab: 'team_org' });
    expect(ground).toHaveBeenCalledTimes(2);
    expect(retrieveOriginalSource).toHaveBeenCalledTimes(1);
  });
  it('preserves scoped persisted originals while writing source-reported overview paragraphs, never model markdown or figures', async () => {
    const { post, structure, ground, store, service } = await setup();
    const url = 'https://example.com/report';
    const quote = 'Example sells research software for independent analysts.';
    await store.saveCompanyOriginal('user_123', 'deck_test', { id: 'src_00000000-0000-4000-8000-000000000001', companyId: 'cmp', metricType: 'company_profile', capturedAt: '2026-10-02T00:00:00.000Z',
      receipts: [{ requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-02T00:00:00.000Z', text: quote }] });
    ground.mockResolvedValue(supportedResponse(quote, url));
    structure.mockResolvedValueOnce({ paragraphs: [{ section: 'background', text: quote, sourceUrls: [url], supportIndices: [0] },
      { section: 'position', text: 'Fabricated $999B valuation', sourceUrls: [url], supportIndices: [0] }],
      markdown: 'Fabricated $999B valuation' } as never);
    const response = await post({ ...input, tab: 'overview' });
    expect(response.status).toBe(200);
    const result = await response.json() as { content: { markdown: string }; citations: Array<{ url: string }> };
    expect(result.content.markdown).toContain(quote);
    expect(result.content.markdown).toContain('ARR (USD): Unknown');
    expect(result.content.markdown).not.toContain('999B');
    expect(result.citations[0]!.url).toBe(url);
    expect(ground).toHaveBeenCalledTimes(1); expect(structure).toHaveBeenCalledTimes(1);
    expect(retrieveOriginalSource).not.toHaveBeenCalled();
    const retained = await service.getOriginalSources('user_123', 'deck_test').list({ companyId: 'cmp' });
    expect(retained).toHaveLength(1); expect(retained[0]!.receipts[0]!.text).toBe(quote);
  });
  it('returns the retained source envelope and passes sources to synthesis', async () => {
    const { post, structure } = await setup();
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ content: { markdown: 'Software company' }, citations: [expect.objectContaining({ url: 'https://example.com/report' })] });
    expect(structure.mock.calls[0]![0]).toContain('https://example.com/report');
  });
  it.each(['products_roadmap', 'team_org'] as const)('returns actual Google-supported %s reports when original reads are blocked, never original-verified rows', async tab => {
    const { post, ground, structure, service } = await setup();
    const url = `https://example.com/${tab}`;
    const quote = tab === 'products_roadmap' ? 'Example Atlas is now available for independent researchers.'
      : 'Avery Founder is the current Chief Executive Officer of Example.';
    ground.mockResolvedValue(supportedResponse(quote, url));
    structure.mockResolvedValue(tab === 'products_roadmap'
      ? { products: [], roadmap: [], reportedProducts: [{ name: 'Atlas', status: 'live', supportIndex: 0, quote,
        revenueNote: '$999B', url: 'https://fake.example' }], reportedRoadmap: [] }
      : { nodes: [], reportedNodes: [{ id: 'avery', name: 'Avery Founder', role: 'Chief Executive Officer', group: 'exec',
        supportIndex: 0, quote, sourceUrl: 'https://fake.example', bio: 'Invented biography' }] });
    vi.mocked(retrieveOriginalSource).mockResolvedValue({ requestedUrl: url, status: 'blocked', httpStatus: 403,
      retrievedAt: '2026-10-06T00:00:00.000Z', reason: 'private transport details' });
    const response = await post({ ...input, tab });
    expect(response.status).toBe(200);
    const result = await response.json() as { content: { products?: unknown[]; nodes?: unknown[] }; citations: Array<{ url: string; title: string }> };
    if (tab === 'products_roadmap') expect(result.content.products).toEqual([expect.objectContaining({ name: 'Atlas',
      description: expect.stringContaining('original page not retrieved'), revenueNote: '', url: null })]);
    else expect(result.content.nodes).toEqual([expect.objectContaining({ name: 'Avery Founder',
      bio: expect.stringContaining('original page not retrieved'), sourceUrl: null, supportingQuote: null })]);
    expect(result.citations).toEqual([expect.objectContaining({ url, title: expect.stringContaining('Google Search report') })]);
    expect(JSON.stringify(result)).not.toMatch(/999B|fake\.example|Invented biography|private transport/);
    expect(ground).toHaveBeenCalledTimes(1); expect(structure).toHaveBeenCalledTimes(1);
    const retained = await service.getOriginalSources('user_123', 'deck_test').list({ companyId: 'cmp', metricType: tab });
    expect(retained).toHaveLength(1); expect(retained[0]!.receipts[0]!.status).toBe('blocked');
  });
  it('rejects invented overview links and detached support IDs while retaining honest literal-source fallback', async () => {
    const { post, ground, structure } = await setup();
    const url = 'https://example.com/report';
    const quote = 'Example supplies research tools for independent analysts.';
    ground.mockResolvedValue(supportedResponse(quote, url));
    structure.mockResolvedValue({ paragraphs: [
      { section: 'background', text: 'Invented source story', sourceUrls: ['https://fake.example'], supportIndices: [0] },
      { section: 'products', text: 'Detached support story', sourceUrls: [url], supportIndices: [99] },
    ] });
    const response = await post({ ...input, tab: 'overview' });
    expect(response.status).toBe(200);
    const result = await response.json() as { content: { markdown: string }; citations: unknown[] };
    expect(result.content.markdown).toContain(quote);
    expect(result.content.markdown).toContain('source-reported');
    expect(result.content.markdown).toContain('not independently verified');
    expect(result.content.markdown).toContain('Employees: Unknown');
    expect(result.content.markdown).not.toMatch(/Invented source story|Detached support story|fake\.example/);
    expect(result.citations).toEqual([expect.objectContaining({ url })]);
    expect(retrieveOriginalSource).not.toHaveBeenCalled();
    expect(ground).toHaveBeenCalledTimes(1); expect(structure).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('uses the same retained original metric gate for cloud cards and written Overview (saved original: %s)', async withOriginal => {
    const { app, post, ground, structure, service, store } = await setup();
    const sourceUrl = 'https://sec.gov/Archives/example';
    const quote = 'Example reported 45 employees as of 2026-10-01.';
    const record = (await service.getDeck('user_123', 'deck_test'))!;
    const card = record.cards[0]!;
    await service.saveDeck('user_123', 'deck_test', { ...record, cards: [{ ...card, metrics: [{ id: 'employees', companyId: 'cmp',
      metricType: 'employees', value: 45, confidence: 'verified', citations: [{ title: 'SEC', url: sourceUrl }], source: sourceUrl,
      capturedAt: '2026-10-02T00:00:00.000Z', methodNote: null,
      passageSupport: { sourceUrl, quote, asOf: '2026-10-01', basis: 'employees', unit: 'count' } }] }] });
    if (withOriginal) await store.saveCompanyOriginal('user_123', 'deck_test', {
      id: 'src_00000000-0000-4000-8000-000000000002', companyId: 'cmp', metricType: 'metrics_hunt', capturedAt: '2026-10-02T00:00:00.000Z',
      receipts: [{ requestedUrl: sourceUrl, finalUrl: sourceUrl, text: quote, status: 'retrieved', httpStatus: 200,
        contentHash: 'a'.repeat(64), retrievedAt: '2026-10-02T00:00:00.000Z' }] });
    // The referenced original must survive the bounded recent-diagnostics window.
    for (let i = 0; i < 30; i++) await store.saveCompanyOriginal('user_123', 'deck_test', {
      id: `src_00000000-0000-4000-8000-${String(i + 10).padStart(12, '0')}`,
      companyId: 'cmp', metricType: 'metrics_hunt', capturedAt: '2026-10-03T00:00:00.000Z',
      receipts: [{ requestedUrl: sourceUrl, finalUrl: sourceUrl, text: '', status: 'blocked', httpStatus: 403,
        retrievedAt: '2026-10-03T00:00:00.000Z' }],
    });
    const cardResponse = await app.request('/api/cards?deckId=deck_test', { headers });
    expect(cardResponse.status).toBe(200);
    const cardResult = await cardResponse.json() as { cards: CardWithCompany[] };
    expect(cardResult.cards[0]!.metrics[0]!.value).toBe(withOriginal ? 45 : null);
    const description = 'Example supplies research tools for independent analysts.';
    const url = 'https://example.com/report';
    ground.mockResolvedValue(supportedResponse(description, url));
    structure.mockResolvedValue({ paragraphs: [{ section: 'background', text: description, sourceUrls: [url], supportIndices: [0] }] });
    const response = await post({ ...input, tab: 'overview' });
    expect(response.status).toBe(200);
    const result = await response.json() as { content: { markdown: string } };
    expect(result.content.markdown).toContain(withOriginal ? 'Employees: 45' : 'Employees: Unknown');
    expect(retrieveOriginalSource).not.toHaveBeenCalled();
  });
  it('requires spend authorization as well as user authentication before research', async () => {
    const { post, ground } = await setup();
    expect((await post(input, { ...headers, 'X-Stratemark-Token': '' })).status).toBe(401);
    expect(ground).not.toHaveBeenCalled();
  });
  it('respects the existing server budget before resolving the client', async () => {
    const { post, ground } = await setup('0.01');
    expect((await post()).status).toBe(429);
    expect(ground).not.toHaveBeenCalled();
    expect(resolveClient).not.toHaveBeenCalled();
  });
  it('rejects invalid tabs before paid work', async () => {
    const { post, ground } = await setup();
    expect((await post({ ...input, tab: 'invented' })).status).toBe(400);
    expect(ground).not.toHaveBeenCalled();
  });
  it('requires current cloud entitlement and rejects cross-owner decks', async () => {
    const { post, ground, service } = await setup();
    expect((await post(input, { ...headers, Authorization: 'Bearer valid_other_user' })).status).toBe(404);
    vi.spyOn(service, 'checkEntitlement').mockResolvedValue(false);
    expect((await post()).status).toBe(402);
    expect(ground).not.toHaveBeenCalled();
  });
  it('does not return provider errors containing credentials', async () => {
    const { post, ground } = await setup();
    ground.mockRejectedValueOnce(new Error('provider key supersecret'));
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('supersecret');
  });
});
