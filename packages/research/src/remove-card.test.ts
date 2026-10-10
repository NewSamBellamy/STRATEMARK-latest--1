/**
 * removeCard — a user takes a company out of a deck it doesn't belong in, and
 * re-discovery by later research can't quietly put it back.
 */
import { describe, expect, it } from 'vitest';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

const now = new Date().toISOString();
const company = (id: string, name: string) => ({
  id, name, oneLiner: `${name} makes things.`, websiteUrl: null, logoUrl: null, hqLocation: null, brandTheme: null,
});
const card = (id: string, deckId: string, companyId: string, cardType = 'company') => ({
  id, deckId, companyId, cardType, title: null, summary: null, tier: null, tierReason: null,
  citations: [], keyPoints: [], createdAt: now,
});

function snapshot(): RepoSnapshot {
  return {
    schemaVersion: 2,
    markets: [
      { id: 'mkt_spirits', name: 'NA Spirits', scopeDefinition: { vertical: 'Spirits', geography: null, inclusions: [], exclusions: [] }, refreshCadence: 'manual', createdAt: now },
      { id: 'mkt_beer', name: 'NA Beer', scopeDefinition: { vertical: 'Beer', geography: null, inclusions: [], exclusions: [] }, refreshCadence: 'manual', createdAt: now },
    ],
    decks: [
      { id: 'deck_spirits', marketId: 'mkt_spirits', createdAt: now, lastRefreshedAt: now },
      { id: 'deck_beer', marketId: 'mkt_beer', createdAt: now, lastRefreshedAt: now },
    ],
    companies: [company('cmp_athletic', 'Athletic Brewing Company'), company('cmp_lyres', "Lyre's Spirit Co.")],
    metrics: [],
    cards: [
      card('c1', 'deck_spirits', 'cmp_athletic'),
      card('c1b', 'deck_spirits', 'cmp_athletic', 'distribution'),
      card('c2', 'deck_spirits', 'cmp_lyres'),
      card('c3', 'deck_beer', 'cmp_athletic'),
    ],
    viceClaims: [], dashboards: {}, companyMarket: {}, opportunity: {}, reports: [], briefings: [],
    savedCards: [{ cardId: 'c1', savedAt: now }], researchJobs: [], threads: [],
  } as unknown as RepoSnapshot;
}

function memoryStore(initial: RepoSnapshot): ResearchStore & { data: () => RepoSnapshot | null } {
  let data: RepoSnapshot | null = initial;
  return { read: () => data, write: (snap: RepoSnapshot) => { data = snap; }, data: () => data };
}

describe('removeCard', () => {
  it('takes the company out of that deck only, with its facet cards and saved bookmark', async () => {
    const store = memoryStore(snapshot());
    const repo = new GeminiRepository({ apiKey: 'k', store, client: {} as LlmClient });
    await repo.removeCard('c1');
    expect((await repo.listCards('deck_spirits')).map((c) => c.card.id)).toEqual(['c2']);
    expect((await repo.listCards('deck_beer')).map((c) => c.card.id)).toEqual(['c3']);
    expect(store.data()!.savedCards).toEqual([]);
  });
  it('keeps a re-discovered copy out of the deck it was removed from', async () => {
    const store = memoryStore(snapshot());
    const repo = new GeminiRepository({ apiKey: 'k', store, client: {} as LlmClient });
    await repo.removeCard('c1');
    // Later research re-adds the same company under a new card id.
    const snap = store.data()!;
    snap.cards.push(card('c9', 'deck_spirits', 'cmp_athletic') as never);
    const reopened = new GeminiRepository({ apiKey: 'k', store, client: {} as LlmClient });
    expect((await reopened.listCards('deck_spirits')).map((c) => c.card.id)).toEqual(['c2']);
  });
});
