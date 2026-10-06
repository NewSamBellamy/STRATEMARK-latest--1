import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardWithCompany } from '@mi/contracts';
import { createApp } from '../app';
import { readEnv } from '../env';
import { CloudDeckService, MockFirebaseAdapter } from '../lib/CloudDeckService';
import { MemoryDataStore } from '../lib/firestoreStore';
import { resolveClient } from '../lib/client';

vi.mock('../lib/client', async original => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...await original<typeof import('../lib/client')>(), resolveClient: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());
const headers = { Authorization: 'Bearer valid_token', 'X-Stratemark-Token': 'app-token', 'Content-Type': 'application/json' };
const input = { deckId: 'deck_test', companyId: 'cmp', tab: 'overview' };
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
  return { post, ground, structure, service };
}
describe('actual cloud dashboard source transport and authorization', () => {
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
