import { describe, expect, it, vi } from 'vitest';
import { expandDeckWithDeltaAgent, IncrementalDeltaAgent } from './delta-agent';
import { expandDeckResearch } from './pipeline';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot } from './repository';
import { extractProviderGrounding } from './grounding-support';
import type { LlmClient } from './types';
import type { OriginalSourceServices } from './original-source';

vi.mock('./logos', () => ({ faviconUrl: () => null, resolveLogo: async () => ({ url: null }) }));
const url = 'https://sec.gov/Archives/acme';
const quote = 'Acme Inc. reported 45 employees as of 2026-10-01.';
function fixture(proof = true) {
  const client: LlmClient = {
    ground: vi.fn(async () => ({ text: quote, citations: [{ title: 'SEC', url }], queries: [],
      ...(proof ? { grounding: extractProviderGrounding(quote, {
        groundingChunks: [{ web: { uri: url, title: 'SEC' } }],
        groundingSupports: [{ segment: { text: quote }, groundingChunkIndices: [0] }],
      }) } : {}) })),
    structure: vi.fn(async (prompt, schema) => schema.parse(prompt.includes('"companies"')
      ? { companies: [{ name: 'Acme Inc.', domain: 'acme.com', descriptor: 'Software', cardTypes: ['company'] }] }
      : prompt.includes('BASE TIER') ? { nudge: 1, reason: 'Model opinion' }
        : { metrics: { employees: { value: 45, confidence: 'verified', sourceIndex: 0,
          reportedClaim: { sourceUrl: url, quote, asOf: '2026-10-01', basis: 'employees', unit: 'count' } } },
        facts: { headcount: 45 } })) as LlmClient['structure'],
  };
  const originals: OriginalSourceServices = {
    retrieve: vi.fn(async (requestedUrl: string) => ({ requestedUrl, finalUrl: requestedUrl, status: 'retrieved' as const,
      httpStatus: 200, text: quote, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-04T00:00:00.000Z' })),
    save: vi.fn(async () => {}), list: vi.fn(async () => []),
  };
  return { client, originals };
}
const context = { marketName: 'Software', vertical: 'SaaS', deckId: 'dck_test' };
function publishedState(snapshot: RepoSnapshot): string {
  return JSON.stringify({ ...snapshot, researchEvidence: [] });
}
function repository(failOn: 'notes' | 'cards' | null = null, proof = true) {
  const { client, originals } = fixture(proof);
  let saved = migrateSnapshot(null).snapshot;
  const write = vi.fn(async (next: RepoSnapshot) => {
    if (failOn === 'notes' && next.researchEvidence?.some(row => row.companyId)) throw new Error('Disk full');
    if (failOn === 'cards' && next.cards.length) throw new Error('Disk full');
    saved = structuredClone(next);
  });
  const options = { apiKey: 'test-placeholder', client, originalSources: originals,
    store: { read: () => structuredClone(saved), write } };
  return { client, originals, options, write, snapshot: () => structuredClone(saved), repo: new GeminiRepository(options) };
}

describe('fast provider-reported deck expansion through actual production wrappers', () => {
  it.each(['company', 'infrastructure', 'distribution'] as const)('publishes an added %s with Google-reported support, no original reads or extra recovery/tier call', async cardType => {
    const s = fixture();
    const cards = await expandDeckWithDeltaAgent({ ...context, client: s.client, focus: { cardType }, target: 1, originalSources: s.originals });
    expect(cards).toHaveLength(1); expect(cards[0]!.card.cardType).toBe(cardType);
    expect(cards[0]!.metrics.find(metric => metric.metricType === 'employees')).toMatchObject({ value: 45,
      confidence: 'estimated', source: url, passageSupport: null, lastVerifiedAt: null,
      reportedSupport: { provider: 'google-search', support: { text: quote, sources: [{ url }] } } });
    expect(cards[0]!.metrics.find(metric => metric.metricType === 'arr')).toMatchObject({ value: null, confidence: 'unknown' });
    expect(cards[0]!.card.tierReason).not.toBe('Model opinion');
    expect(s.originals.retrieve).not.toHaveBeenCalled(); expect(s.originals.save).not.toHaveBeenCalled();
    expect(s.client.ground).toHaveBeenCalledTimes(2); expect(s.client.structure).toHaveBeenCalledTimes(2);
  });
  it('keeps citation-only additions unknown through the direct delta-agent interface', async () => {
    const s = fixture(false);
    const result = await new IncrementalDeltaAgent(s.client, context).searchDelta({ focus: { cardType: 'company' }, target: 1, originalSources: s.originals });
    expect(result.cards[0]!.metrics.every(metric => metric.value === null && metric.confidence === 'unknown')).toBe(true);
    expect(result.cards[0]!.card.tier).toBeNull(); expect(s.originals.retrieve).not.toHaveBeenCalled();
  });
  it('uses fast publication in the empty-state pipeline expansion wrapper without enabling test-only original verification', async () => {
    const s = fixture(false);
    const cards = await expandDeckResearch({ ...context, client: s.client, geography: null, focusPrompt: 'More companies',
      excludeNames: [], deckUserValues: [], target: 1, originalSources: s.originals });
    expect(cards[0]!.metrics.every(metric => metric.value === null)).toBe(true);
    expect(s.originals.retrieve).not.toHaveBeenCalled(); expect(s.originals.save).not.toHaveBeenCalled();
    expect(s.client.ground).toHaveBeenCalledTimes(2); expect(s.client.structure).toHaveBeenCalledTimes(2);
  });
  it('does not emit or synthesize a new card if its scoped provider notes cannot be saved by the repository', async () => {
    const s = repository('notes');
    const market = await s.repo.createMarket({ name: 'Software', scopeDefinition: { vertical: 'SaaS', geography: null, notes: null }, refreshCadence: 'weekly' });
    const before = publishedState(s.snapshot()); const events = vi.fn(); s.repo.subscribeDeckRefresh(events);
    await expect(s.repo.expandDeck(market.id, { cardType: 'company' })).rejects.toThrow('Disk full');
    expect(publishedState(s.snapshot())).toBe(before); expect(events).not.toHaveBeenCalled();
    expect(s.client.structure).toHaveBeenCalledTimes(1); // Discovery only; company synthesis never started.
    expect(await s.repo.getResearchEvidence({ companyId: 'cmp_acme-inc' })).toEqual([]);
    const calls = vi.mocked(s.client.ground).mock.calls.length;
    await expect(s.repo.expandDeck(market.id, { cardType: 'company' })).rejects.toThrow(/saved/);
    expect(s.client.ground).toHaveBeenCalledTimes(calls);
  });
  it('retains a reported figure even when original services are unavailable, without calling them', async () => {
    const s = fixture();
    s.originals.retrieve = vi.fn(async requestedUrl => ({ requestedUrl, status: 'unavailable' as const,
      retrievedAt: '2026-10-04T00:00:00.000Z' }));
    const cards = await expandDeckWithDeltaAgent({ ...context, client: s.client, focus: { cardType: 'company' }, target: 1, originalSources: s.originals });
    expect(cards[0]!.metrics.find(metric => metric.metricType === 'employees')).toMatchObject({ value: 45, confidence: 'estimated' });
    expect(s.originals.retrieve).not.toHaveBeenCalled();
  });
  it('keeps acknowledged deck state unchanged and retains saved provider notes when final card persistence fails', async () => {
    const s = repository('cards');
    const market = await s.repo.createMarket({ name: 'Software', scopeDefinition: { vertical: 'SaaS', geography: null, notes: null }, refreshCadence: 'weekly' });
    const before = publishedState(s.snapshot()); const events = vi.fn(); s.repo.subscribeDeckRefresh(events);
    await expect(s.repo.expandDeck(market.id, { cardType: 'company' })).rejects.toThrow('Disk full');
    expect(publishedState(s.snapshot())).toBe(before); expect(events).not.toHaveBeenCalled();
    const notes = await s.repo.getResearchEvidence({ companyId: 'cmp_acme-inc' });
    expect(notes).toHaveLength(1); expect(notes[0]!.text).toBe(quote);
    expect(notes[0]!.grounding?.supports[0]?.text).toBe(quote);
    expect(await s.repo.listCards((await s.repo.getDeckByMarket(market.id))!.id)).toEqual([]);
    expect(s.originals.save).not.toHaveBeenCalled();
  });
  it.each([false, true])('persists reader facts and attribution through repository reopen without duplicating hydration (provider proof: %s)', async proof => {
    const s = repository(null, proof);
    const market = await s.repo.createMarket({ name: 'Software', scopeDefinition: { vertical: 'SaaS', geography: null, notes: null }, refreshCadence: 'weekly' });
    expect(await s.repo.expandDeck(market.id, { cardType: 'company' })).toEqual({ added: 1 });
    const deck = await s.repo.getDeckByMarket(market.id); const cards = await s.repo.listCards(deck!.id);
    expect(cards).toHaveLength(1);
    if (proof) expect(cards[0]!.metrics.find(row => row.metricType === 'employees')).toMatchObject({ value: 45,
      confidence: 'estimated', reportedSupport: { provider: 'google-search' } });
    else expect(cards[0]!.metrics.every(row => row.value === null && row.confidence === 'unknown')).toBe(true);
    const reopened = new GeminiRepository(s.options);
    expect((await reopened.getCard(cards[0]!.card.id))!.metrics).toEqual(cards[0]!.metrics);
    expect(s.originals.retrieve).not.toHaveBeenCalled(); expect(s.originals.save).not.toHaveBeenCalled();
    await s.repo.overrideMetric({ companyId: cards[0]!.company!.id, metricType: 'employees', value: 77, note: 'Analyst confirmed' });
    const calls = vi.mocked(s.client.ground).mock.calls.length;
    expect(await s.repo.expandDeck(market.id, { cardType: 'company' })).toEqual({ added: 0 });
    expect(s.client.ground).toHaveBeenCalledTimes(calls + 1); // Discovery; no duplicate company hydration.
    expect((await s.repo.getCompanyMetrics(cards[0]!.company!.id)).find(row => row.metricType === 'employees'))
      .toMatchObject({ value: 77, confidence: 'user_verified' });
  });
});
