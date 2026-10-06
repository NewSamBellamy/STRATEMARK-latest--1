import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardWithCompany } from '@mi/contracts';
import { createApp } from '../app';
import { readEnv } from '../env';
import { CloudDeckService, MockFirebaseAdapter } from '../lib/CloudDeckService';
import { MemoryDataStore } from '../lib/firestoreStore';
import { resolveClient } from '../lib/client';
import { retrieveOriginalSource } from '../lib/original-source';

vi.mock('../lib/original-source', () => ({ retrieveOriginalSource: vi.fn() }));

vi.mock('../lib/client', async original => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...await original<typeof import('../lib/client')>(), resolveClient: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
const headers = { Authorization: 'Bearer valid_token', 'X-Stratemark-Token': 'app-token', 'Content-Type': 'application/json' };
const input = { deckId: 'deck_test', companyId: 'cmp', tab: 'history' };
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
  return { post, ground, structure, service, store };
}
describe('actual cloud dashboard source transport and authorization', () => {
  it('retains product originals on the authorized route and reuses them without repeating search', async () => {
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
    expect(ground).toHaveBeenCalledTimes(1);
    expect(retrieveOriginalSource).toHaveBeenCalledTimes(1);
    expect((await post({ ...input, tab: 'products_roadmap', force: true })).status).toBe(200);
    expect(ground).toHaveBeenCalledTimes(2);
    expect(retrieveOriginalSource).toHaveBeenCalledTimes(2);
  });
  it('reads and retains the authorized official page before paid search on the actual overview route', async () => {
    const { post, structure, ground, service } = await setup();
    const url = 'https://example.com/';
    const quote = 'Example sells research software for independent analysts.';
    vi.mocked(retrieveOriginalSource).mockResolvedValue({ requestedUrl: 'https://example.com', finalUrl: url,
      status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), text: quote, retrievedAt: new Date().toISOString() });
    structure.mockResolvedValue({ excerpts: [{ sourceUrl: url, quote }] } as never);
    const response = await post({ ...input, tab: 'overview' });
    expect(response.status).toBe(200);
    const result = await response.json() as { content: { markdown: string }; citations: Array<{ url: string }> };
    expect(result.content.markdown).toContain(quote);
    expect(result.citations).toEqual([expect.objectContaining({ url })]);
    expect(retrieveOriginalSource).toHaveBeenCalledTimes(1);
    expect(retrieveOriginalSource).toHaveBeenCalledWith('https://example.com', undefined,
      { companyId: 'cmp', companyName: 'Example', metricType: 'overview' });
    expect(ground).not.toHaveBeenCalled();
    const retained = await service.getOriginalSources('user_123', 'deck_test').list({ companyId: 'cmp', metricType: 'overview' });
    expect(retained).toHaveLength(1);
    expect(retained[0]!.receipts[0]).toMatchObject({ finalUrl: url, text: quote, status: 'retrieved' });
  });
  it('uses scoped persisted originals for overview instead of unchecked provider prose', async () => {
    const { post, structure, ground, store } = await setup();
    const url = 'https://example.com/report';
    const quote = 'Example sells research software for independent analysts.';
    await store.saveCompanyOriginal('user_123', 'deck_test', { id: 'src_00000000-0000-4000-8000-000000000001', companyId: 'cmp', metricType: 'company_profile', capturedAt: '2026-10-02T00:00:00.000Z',
      receipts: [{ requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-02T00:00:00.000Z', text: quote }] });
    structure.mockResolvedValueOnce({ excerpts: [{ sourceUrl: url, quote }], markdown: 'Fabricated $999B valuation' } as never);
    const response = await post({ ...input, tab: 'overview' });
    expect(response.status).toBe(200);
    const result = await response.json() as { content: { markdown: string }; citations: Array<{ url: string }> };
    expect(result.content.markdown).toContain(quote);
    expect(result.content.markdown).toContain('ARR (USD): Unknown');
    expect(result.content.markdown).not.toContain('999B');
    expect(result.citations[0]!.url).toBe(url);
    expect(ground).not.toHaveBeenCalled();
  });
  it('returns the retained source envelope and passes sources to synthesis', async () => {
    const { post, structure } = await setup();
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ content: { markdown: 'Software company' }, citations: [expect.objectContaining({ url: 'https://example.com/report' })] });
    expect(structure.mock.calls[0]![0]).toContain('https://example.com/report');
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
