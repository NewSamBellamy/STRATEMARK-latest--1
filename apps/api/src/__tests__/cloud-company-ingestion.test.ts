import { describe, expect, it, vi } from 'vitest';
import type { LlmClient, MarketPlan } from '@mi/research';
import { CloudDeckWorker } from '../lib/CloudDeckWorker';
import { CloudDeckService, MockFirebaseAdapter } from '../lib/CloudDeckService';
import { MemoryDataStore } from '../lib/firestoreStore';
import { readEnv } from '../env';
import { createApp } from '../app';

const mocks = vi.hoisted(() => ({ resolveClient: vi.fn() }));
vi.mock('../lib/client', async (original) => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...await original<typeof import('../lib/client')>(), resolveClient: mocks.resolveClient,
}));
vi.mock('../lib/original-source', () => ({ retrieveOriginalSource: async (url: string) => ({
  requestedUrl: url, finalUrl: url, status: 'retrieved', retrievedAt: '2026-10-04T00:00:00.000Z',
  text: 'Acme Inc. reported 45 employees as of 2026-10-01.',
}) }));
vi.mock('../../../../packages/research/src/logos', () => ({ faviconUrl: () => null, resolveLogo: async () => ({ url: null }) }));
const plan: MarketPlan = { marketName: 'Software', vertical: 'SaaS', geography: null, notes: null, searchThemes: [] };
const env = readEnv({ GEMINI_API_KEY: 'fixture-key', APP_TOKEN: 'fixture-token' });
async function fixture() {
  const store = new MemoryDataStore();
  const auth = new MockFirebaseAdapter();
  const service = new CloudDeckService(store, auth, auth);
  await service.saveDeck('user_pro', 'deck_a', { deck: { id: 'deck_a' }, market: {}, cards: [], plan, state: { status: 'running' } });
  const client: LlmClient = {
    ground: vi.fn(async () => ({ text: 'Provider research', citations: [{ title: 'SEC', url: 'https://sec.gov/Archives/acme' }], queries: [] })),
    structure: vi.fn(async (prompt, schema) => schema.parse(prompt.includes('"companies"')
      ? { companies: [{ name: 'Acme Inc.', domain: 'acme.com', descriptor: 'Software', cardTypes: ['company'] }] }
      : prompt.includes('BASE TIER') ? { nudge: 0, reason: null }
        : { metrics: { employees: { value: 45, confidence: 'verified', sourceIndex: 0 } }, facts: { headcount: 45 } })) as LlmClient['structure'],
  };
  mocks.resolveClient.mockReturnValue({ client, keySource: 'server' });
  return { store, service, client, worker: new CloudDeckWorker(env, service) };
}
describe('cloud company ingestion (real orchestration, fake provider)', () => {
  it('saves originals before publishing citation-only unknowns from initial worker research', async () => {
    const { service, worker } = await fixture();
    await worker.processDeckCreation({ userId: 'user_pro', deckId: 'deck_a', plan, query: 'Software', maxCandidates: 1, watch: false });
    const deck = await service.getDeck('user_pro', 'deck_a');
    expect(deck!.cards).toHaveLength(1);
    expect(deck!.cards[0]!.metrics.every((metric) => metric.value === null && metric.confidence === 'unknown')).toBe(true);
    expect(deck!.companySourceAttempts).toHaveLength(2);
    expect(deck!.companySourceAttempts?.map(attempt => attempt.metricType)).toContain('metrics_hunt');
    expect(deck!.state!.status).toBe('ready');
  });
  it('marks failed original writes as incomplete without publishing that company', async () => {
    const { store, service, worker } = await fixture();
    vi.spyOn(store, 'saveCompanyOriginal').mockRejectedValue(new Error('Evidence storage unavailable'));
    await worker.processDeckCreation({ userId: 'user_pro', deckId: 'deck_a', plan, query: 'Software', maxCandidates: 1, watch: false });
    const deck = await service.getDeck('user_pro', 'deck_a');
    expect(deck!.cards).toEqual([]);
    expect(deck!.state!.status).not.toBe('ready');
  });
  it('protects scheduled delta refresh as well as initial worker research', async () => {
    const { service, worker } = await fixture();
    await worker.processDeckRefresh({ userId: 'user_pro', deckId: 'deck_a', query: 'Software' });
    const deck = await service.getDeck('user_pro', 'deck_a');
    expect(deck!.cards).toHaveLength(1);
    expect(deck!.cards[0]!.metrics.every((metric) => metric.value === null)).toBe(true);
    expect(deck!.companySourceAttempts).toHaveLength(2);
  });
  it('protects the authenticated expand action with the same saved originals', async () => {
    const { store, service } = await fixture();
    const app = createApp(env, { store, cloudDeckService: service, forceMemoryStore: true });
    const response = await app.request('/api/research/expand', { method: 'POST',
      headers: { Authorization: 'Bearer valid_pro_token', 'X-Stratemark-Token': 'fixture-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketId: 'deck_a', focus: { cardType: 'company' } }) });
    expect(response.status).toBe(200);
    const deck = await service.getDeck('user_pro', 'deck_a');
    expect(deck!.cards).toHaveLength(1);
    expect(deck!.cards[0]!.metrics.every((metric) => metric.value === null)).toBe(true);
    expect(deck!.companySourceAttempts).toHaveLength(2);
  });
});
