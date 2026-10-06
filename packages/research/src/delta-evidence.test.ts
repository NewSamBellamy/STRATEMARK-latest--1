import { describe, expect, it, vi } from 'vitest';
import { expandDeckWithDeltaAgent, IncrementalDeltaAgent } from './delta-agent';
import { expandDeckResearch } from './pipeline';
import { GeminiRepository, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';
import type { OriginalSourceServices } from './original-source';

vi.mock('./logos', () => ({ faviconUrl: () => null, resolveLogo: async () => ({ url: null }) }));
const url = 'https://sec.gov/Archives/acme';
const quote = 'Acme Inc. reported 45 employees as of 2026-10-01.';
function fixture(proof = true) {
  const client: LlmClient = {
    ground: vi.fn(async () => ({ text: 'Provider research', citations: [{ title: 'SEC', url }], queries: [] })),
    structure: vi.fn(async (prompt, schema) => schema.parse(prompt.includes('"companies"')
      ? { companies: [{ name: 'Acme Inc.', domain: 'acme.com', descriptor: 'Software', cardTypes: ['company'] }] }
      : prompt.includes('BASE TIER') ? { nudge: 1, reason: 'Model opinion' }
        : { metrics: { employees: { value: 45, confidence: 'verified', sourceIndex: 0,
          ...(proof ? { passageSupport: { sourceUrl: url, quote, asOf: '2026-10-01', basis: 'employees', unit: 'count' } } : {}) } }, facts: { headcount: 45 } })) as LlmClient['structure'],
  };
  const originals: OriginalSourceServices = {
    retrieve: vi.fn(async (requestedUrl: string) => ({ requestedUrl, finalUrl: requestedUrl, status: 'retrieved' as const,
      httpStatus: 200, text: quote, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-04T00:00:00.000Z' })),
    save: vi.fn(async () => {}), list: async () => [],
  };
  return { client, originals };
}
const context = { marketName: 'Software', vertical: 'SaaS', deckId: 'dck_test' };
function publishedState(snapshot: RepoSnapshot | null): string {
  if (!snapshot) throw new Error('Missing saved repository');
  return JSON.stringify({ ...snapshot, researchEvidence: [] });
}

describe('original-backed deck expansion', () => {
  it.each(['company', 'infrastructure', 'distribution'] as const)('requires original support for an added %s card without an extra tier-model call', async (cardType) => {
    const { client, originals } = fixture();
    const cards = await expandDeckWithDeltaAgent({ ...context, client, focus: { cardType }, target: 1, originalSources: originals });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.card.cardType).toBe(cardType);
    expect(cards[0]!.metrics.find((metric) => metric.metricType === 'employees')).toMatchObject({ value: 45, confidence: 'verified', source: url });
    expect(cards[0]!.metrics.find((metric) => metric.metricType === 'arr')).toMatchObject({ value: null, confidence: 'unknown' });
    expect(cards[0]!.card.tierReason).not.toBe('Model opinion');
    expect(originals.save).toHaveBeenCalledTimes(2);
    expect(client.ground).toHaveBeenCalledTimes(3);
    expect(client.structure).toHaveBeenCalledTimes(3);
  });
  it('keeps citation-only additions unknown through the direct delta-agent interface', async () => {
    const { client, originals } = fixture(false);
    const result = await new IncrementalDeltaAgent(client, context).searchDelta({ focus: { cardType: 'company' }, target: 1, originalSources: originals });
    expect(result.cards[0]!.metrics.every((metric) => metric.value === null && metric.confidence === 'unknown')).toBe(true);
    expect(result.cards[0]!.card.tier).toBeNull();
  });
  it('passes original services through the empty-state expansion wrapper', async () => {
    const { client, originals } = fixture(false);
    const cards = await expandDeckResearch({ ...context, client, geography: null, focusPrompt: 'More companies', excludeNames: [], deckUserValues: [], target: 1, originalSources: originals });
    expect(cards[0]!.metrics.every((metric) => metric.value === null)).toBe(true);
    expect(originals.save).toHaveBeenCalledTimes(2);
  });
  it('does not emit a card if its source artifact cannot be saved', async () => {
    const { client, originals } = fixture();
    originals.save = vi.fn(async () => { throw new Error('Disk full'); });
    const onEvent = vi.fn();
    await expect(expandDeckWithDeltaAgent({ ...context, client, focus: { cardType: 'company' }, originalSources: originals, onEvent })).rejects.toThrow('Disk full');
    expect(onEvent.mock.calls.some(([event]) => event.type === 'card')).toBe(false);
    expect(client.structure).toHaveBeenCalledTimes(1);
  });
  it('never treats an unavailable source as support for an otherwise valid proposed quote', async () => {
    const { client, originals } = fixture();
    originals.retrieve = vi.fn(async (requestedUrl: string) => ({ requestedUrl, status: 'unavailable' as const, retrievedAt: '2026-10-04T00:00:00.000Z' }));
    const cards = await expandDeckWithDeltaAgent({ ...context, client, focus: { cardType: 'company' }, originalSources: originals });
    expect(cards[0]!.metrics.every((metric) => metric.value === null && metric.confidence === 'unknown')).toBe(true);
    expect(cards[0]!.card.tier).toBeNull();
  });
  it('keeps published deck state unchanged while retaining recovery notes after an original-save failure', async () => {
    const { client, originals } = fixture();
    originals.save = vi.fn(async () => { throw new Error('Disk full'); });
    let snapshot: RepoSnapshot | null = null;
    const repo = new GeminiRepository({ apiKey: 'test-key', client, originalSources: originals,
      store: { read: () => snapshot, write: (next) => { snapshot = next; } } });
    const market = await repo.createMarket({ name: 'Software', scopeDefinition: { vertical: 'SaaS', geography: null, notes: null }, refreshCadence: 'weekly' });
    const before = publishedState(snapshot);
    const events = vi.fn();
    repo.subscribeDeckRefresh(events);
    await expect(repo.expandDeck(market.id, { cardType: 'company' })).rejects.toThrow('Disk full');
    expect(publishedState(snapshot)).toBe(before);
    const notes = await repo.getResearchEvidence({ companyId: 'cmp_acme-inc' });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toBe('Provider research');
    expect(events).not.toHaveBeenCalled();
  });
  it('persists protected additions and their matching reader metrics through the repository', async () => {
    const { client, originals } = fixture(false);
    let snapshot: RepoSnapshot | null = null;
    const repo = new GeminiRepository({ apiKey: 'test-key', client, originalSources: originals,
      store: { read: () => snapshot, write: (next) => { snapshot = next; } } });
    const market = await repo.createMarket({ name: 'Software', scopeDefinition: { vertical: 'SaaS', geography: null, notes: null }, refreshCadence: 'weekly' });
    expect(await repo.expandDeck(market.id, { cardType: 'company' })).toEqual({ added: 1 });
    const deck = await repo.getDeckByMarket(market.id);
    const cards = await repo.listCards(deck!.id);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.metrics.every((metric) => metric.value === null && metric.confidence === 'unknown')).toBe(true);
    expect((await repo.getCard(cards[0]!.card.id))!.metrics).toEqual(cards[0]!.metrics);
    expect(originals.save).toHaveBeenCalledTimes(2);
    expect(await repo.expandDeck(market.id, { cardType: 'company' })).toEqual({ added: 0 });
    expect(originals.save).toHaveBeenCalledTimes(2);
  });
});
