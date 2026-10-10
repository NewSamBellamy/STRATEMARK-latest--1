import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LlmClient, MarketPlan } from '@mi/research';
import { extractProviderGrounding } from '../../../../packages/research/src/grounding-support';
import { CloudDeckWorker } from '../lib/CloudDeckWorker';
import { CloudDeckService, MockFirebaseAdapter } from '../lib/CloudDeckService';
import { MemoryDataStore } from '../lib/firestoreStore';
import { readEnv } from '../env';
import { createApp } from '../app';

const mocks = vi.hoisted(() => ({ resolveClient: vi.fn(), retrieve: vi.fn() }));
vi.mock('../lib/client', async original => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...await original<typeof import('../lib/client')>(), resolveClient: mocks.resolveClient,
}));
vi.mock('../lib/original-source', () => ({ retrieveOriginalSource: mocks.retrieve }));
vi.mock('../../../../packages/research/src/logos', () => ({ faviconUrl: () => null, resolveLogo: async () => ({ url: null }) }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
const plan: MarketPlan = { marketName: 'Software', vertical: 'SaaS', geography: null, notes: null, searchThemes: [] };
const env = readEnv({ GEMINI_API_KEY: 'fixture-key', APP_TOKEN: 'fixture-token' });
const url = 'https://sec.gov/Archives/acme';
const quote = 'Acme Inc. reported 45 employees as of 2026-10-01.';
async function fixture(proof = false) {
  const store = new MemoryDataStore();
  const auth = new MockFirebaseAdapter();
  const service = new CloudDeckService(store, auth, auth);
  await service.saveDeck('user_pro', 'deck_a', { deck: { id: 'deck_a' }, market: {}, cards: [], plan, state: { status: 'running' } });
  const client: LlmClient = {
    ground: vi.fn(async () => ({ text: quote, citations: [{ title: 'SEC', url }], queries: [],
      ...(proof ? { grounding: extractProviderGrounding(quote, {
        groundingChunks: [{ web: { uri: url, title: 'SEC' } }],
        groundingSupports: [{ segment: { text: quote }, groundingChunkIndices: [0] }],
      }) } : {}) })),
    structure: vi.fn(async (prompt, schema) => schema.parse(prompt.includes('"companies"')
      ? { companies: [{ name: 'Acme Inc.', domain: 'acme.com', descriptor: 'Software', cardTypes: ['company'] }] }
      : prompt.includes('BASE TIER') ? { nudge: 0, reason: null }
        : { metrics: { employees: { value: 45, confidence: 'verified', sourceIndex: 0,
          reportedClaim: { sourceUrl: url, quote, asOf: '2026-10-01', basis: 'employees', unit: 'count' } } },
          facts: { headcount: 45 } })) as LlmClient['structure'],
  };
  mocks.resolveClient.mockReturnValue({ client, keySource: 'server' });
  return { store, service, client, worker: new CloudDeckWorker(env, service) };
}
const expectedMetric = (proof: boolean) => proof
  ? { value: 45, confidence: 'estimated', passageSupport: null, lastVerifiedAt: null,
    reportedSupport: { provider: 'google-search', support: { text: quote, sources: [{ url }] } } }
  : { value: null, confidence: 'unknown', reportedSupport: null };

describe('cloud company ingestion through real orchestration and a fake provider', () => {
  it.each([false, true])('initial worker saves fast cards with truthful reported support, never automatic original reads (provider proof: %s)', async proof => {
    const s = await fixture(proof);
    await s.worker.processDeckCreation({ userId: 'user_pro', deckId: 'deck_a', plan, query: 'Software', maxCandidates: 1, watch: false });
    const deck = await s.service.getDeck('user_pro', 'deck_a');
    expect(deck!.cards).toHaveLength(1);
    expect(deck!.cards[0]!.metrics.find(row => row.metricType === 'employees')).toMatchObject(expectedMetric(proof));
    expect(deck!.cards[0]!.metrics.find(row => row.metricType === 'arr')).toMatchObject({ value: null, confidence: 'unknown' });
    expect(deck!.companySourceAttempts ?? []).toEqual([]);
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(deck!.state!.status).toBe('ready');
    const profileCalls = vi.mocked(s.client.ground).mock.calls.filter(([, opts]) => opts?.researchContext?.topic === 'company_profile');
    expect(profileCalls).toHaveLength(1); // No automatic missing-metric hunt or original-verification opt-in.
  });
  it('does not acknowledge publication when actual deck checkpoint and final storage writes fail', async () => {
    const s = await fixture(true);
    const committedSave = s.store.saveDeck.bind(s.store);
    vi.spyOn(s.store, 'saveDeck').mockImplementation(async (...args) => {
      if (args[1].cards?.length) throw new Error('Evidence storage unavailable');
      return committedSave(...args);
    });
    await expect(s.worker.processDeckCreation({ userId: 'user_pro', deckId: 'deck_a', plan, query: 'Software', maxCandidates: 1, watch: false }))
      .rejects.toThrow('Evidence storage unavailable');
    const deck = await s.service.getDeck('user_pro', 'deck_a');
    expect(deck!.cards).toEqual([]); expect(deck!.state!.status).not.toBe('ready');
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });
  it.each([false, true])('scheduled delta refresh retains provider-proof semantics without automatic original reads (provider proof: %s)', async proof => {
    const s = await fixture(proof);
    await s.worker.processDeckRefresh({ userId: 'user_pro', deckId: 'deck_a', query: 'Software' });
    const deck = await s.service.getDeck('user_pro', 'deck_a');
    expect(deck!.cards).toHaveLength(1);
    expect(deck!.cards[0]!.metrics.find(row => row.metricType === 'employees')).toMatchObject(expectedMetric(proof));
    expect(deck!.companySourceAttempts ?? []).toEqual([]); expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(s.client.ground).toHaveBeenCalledTimes(2); expect(s.client.structure).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])('authenticated expand persists fast card evidence through the actual route (provider proof: %s)', async proof => {
    const s = await fixture(proof);
    const app = createApp(env, { store: s.store, cloudDeckService: s.service, forceMemoryStore: true });
    const response = await app.request('/api/research/expand', { method: 'POST',
      headers: { Authorization: 'Bearer valid_pro_token', 'X-Stratemark-Token': 'fixture-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketId: 'deck_a', focus: { cardType: 'company' } }) });
    expect(response.status).toBe(200);
    const deck = await s.service.getDeck('user_pro', 'deck_a');
    expect(deck!.cards).toHaveLength(1);
    expect(deck!.cards[0]!.metrics.find(row => row.metricType === 'employees')).toMatchObject(expectedMetric(proof));
    expect(deck!.companySourceAttempts ?? []).toEqual([]); expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(s.client.ground).toHaveBeenCalledTimes(2); expect(s.client.structure).toHaveBeenCalledTimes(2);
  });
  it('does not use inactive original-save failures as a fake durability gate for provider-reported publication', async () => {
    const s = await fixture(true);
    const saveOriginal = vi.spyOn(s.store, 'saveCompanyOriginal').mockRejectedValue(new Error('Original artifact storage unavailable'));
    await s.worker.processDeckCreation({ userId: 'user_pro', deckId: 'deck_a', plan, query: 'Software', maxCandidates: 1, watch: false });
    const deck = await s.service.getDeck('user_pro', 'deck_a');
    expect(deck!.cards[0]!.metrics.find(row => row.metricType === 'employees')).toMatchObject(expectedMetric(true));
    expect(deck!.state!.status).toBe('ready'); expect(saveOriginal).not.toHaveBeenCalled();
  });
});
