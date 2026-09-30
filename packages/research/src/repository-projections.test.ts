import { cardSchema, type Deck, type Market } from '@mi/contracts';
import { describe, expect, it } from 'vitest';
import {
  GeminiRepository,
  migrateSnapshot,
  RepositoryOwnershipLostError,
  type RepoSnapshot,
} from './repository';
import type { LlmClient } from './types';

const AT = '2026-09-30T12:00:00.000Z';

function market(id: string, name: string): Market {
  return {
    id,
    name,
    createdAt: AT,
    refreshCadence: 'daily',
    scopeDefinition: { vertical: 'Synthetic', geography: null, notes: null },
  };
}

function deck(id: string, marketId: string): Deck {
  return { id, marketId, createdAt: AT, lastRefreshedAt: null };
}

function companyCard(
  id: string,
  deckId: string,
  cardType: 'company' | 'infrastructure' | 'distribution' = 'company',
) {
  return cardSchema.parse({
    id,
    deckId,
    companyId: 'co_fixture',
    createdAt: AT,
    cardType,
    tier: null,
    tierReason: null,
    title: null,
    summary: null,
    citations: [],
  });
}

function opportunity(markdown: string): RepoSnapshot['opportunity'][string] {
  return { markdown, citations: [], at: AT };
}

function snapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    ...migrateSnapshot(null).snapshot,
    companies: [
      {
        id: 'co_fixture',
        name: 'Fixture Labs',
        oneLiner: 'Synthetic test company',
        logoUrl: null,
        websiteUrl: null,
        hqLocation: null,
        brandTheme: null,
      },
    ],
    ...overrides,
  };
}

function memory(initial: RepoSnapshot) {
  let current = structuredClone(initial);
  return {
    store: {
      read: () => structuredClone(current),
      write: (next: RepoSnapshot) => {
        current = structuredClone(next);
      },
    },
    read: () => structuredClone(current),
    replace: (next: RepoSnapshot) => {
      current = structuredClone(next);
    },
  };
}

function client(): LlmClient {
  return {
    ground: async () => ({ text: 'Synthetic notes', citations: [], queries: [] }),
    structure: async (_prompt, schema) => schema.parse({ markdown: 'Synthetic overview' }),
  };
}

async function correct(repo: GeminiRepository): Promise<void> {
  await repo.overrideMetric({
    companyId: 'co_fixture',
    metricType: 'arr',
    value: null,
    note: 'Synthetic correction',
  });
}

describe('company correction projection invalidation', () => {
  it('does not guess between ambiguous legacy market names', async () => {
    const source = snapshot({
      markets: [market('market_a', 'Same label'), market('market_b', 'Same label')],
      companyMarket: { co_fixture: 'Same label' },
      opportunity: { market_a: opportunity('A'), market_b: opportunity('B') },
    });
    const data = memory(source);
    await correct(new GeminiRepository({ client: client(), store: data.store }));
    expect(data.read().opportunity).toEqual(source.opportunity);
  });
  it('ignores a stale legacy name when explicit deck membership identifies the owner', async () => {
    const source = snapshot({
      markets: [market('market_a', 'Actual owner'), market('market_b', 'Stale legacy owner')],
      decks: [deck('deck_a', 'market_a')],
      cards: [companyCard('card_a', 'deck_a')],
      companyMarket: { co_fixture: 'Stale legacy owner' },
      opportunity: { market_a: opportunity('A'), market_b: opportunity('B') },
    });
    const data = memory(source);
    await correct(new GeminiRepository({ client: client(), store: data.store }));
    expect(data.read().opportunity).toEqual({ market_b: opportunity('B') });
  });
  it('invalidates every linked market across all decks and preserves unrelated markets', async () => {
    const source = snapshot({
      markets: [
        market('market_a', 'Synthetic A'),
        market('market_b', 'Synthetic B'),
        market('market_c', 'Unrelated'),
      ],
      decks: [
        deck('deck_a1', 'market_a'),
        deck('deck_a2', 'market_a'),
        deck('deck_b', 'market_b'),
        deck('deck_c', 'market_c'),
      ],
      cards: [
        companyCard('card_a1', 'deck_a1'),
        companyCard('card_a2', 'deck_a2'),
        companyCard('card_b', 'deck_b', 'distribution'),
      ],
      companyMarket: { co_fixture: 'Synthetic A' },
      opportunity: {
        market_a: opportunity('A'),
        market_b: opportunity('B'),
        market_c: opportunity('C'),
      },
    });
    const data = memory(source);
    const repo = new GeminiRepository({ client: client(), store: data.store });

    await correct(repo);

    expect(data.read().opportunity).toEqual({ market_c: opportunity('C') });
  });

  it('uses a uniquely matched legacy companyMarket entry when membership links are absent', async () => {
    const source = snapshot({
      markets: [market('market_a', 'Legacy market'), market('market_b', 'Unrelated')],
      companyMarket: { co_fixture: 'Legacy market' },
      opportunity: {
        market_a: opportunity('A'),
        market_b: opportunity('B'),
      },
    });
    const data = memory(source);
    const repo = new GeminiRepository({ client: client(), store: data.store });

    await correct(repo);

    expect(data.read().opportunity).toEqual({ market_b: opportunity('B') });
  });

  it('invalidates linked markets for cited verifyMetric corrections too', async () => {
    const source = snapshot({
      markets: [market('market_a', 'Synthetic A'), market('market_b', 'Synthetic B')],
      decks: [deck('deck_a', 'market_a'), deck('deck_b', 'market_b')],
      cards: [companyCard('card_a', 'deck_a'), companyCard('card_b', 'deck_b')],
      metrics: [
        {
          id: 'metric_fixture',
          companyId: 'co_fixture',
          metricType: 'arr',
          value: 10,
          confidence: 'estimated',
          source: null,
          citations: [],
          methodNote: null,
          capturedAt: AT,
        },
      ],
      opportunity: {
        market_a: opportunity('A'),
        market_b: opportunity('B'),
      },
    });
    const data = memory(source);
    const repo = new GeminiRepository({ client: client(), store: data.store });

    await repo.verifyMetric({
      companyId: 'co_fixture',
      metricType: 'arr',
      correction: {
        value: 20,
        citations: [
          {
            title: 'reuters.com',
            url: 'https://reuters.com/synthetic-arr',
            credibility: 'reputable_secondary',
          },
        ],
      },
    });

    expect(data.read().opportunity).toEqual({});
  });

  it('preserves projections when membership links and legacy ownership are absent', async () => {
    const source = snapshot({
      markets: [market('market_a', 'Synthetic A'), market('market_b', 'Synthetic B')],
      opportunity: {
        market_a: opportunity('A'),
        market_b: opportunity('B'),
      },
    });
    const data = memory(source);
    const repo = new GeminiRepository({ client: client(), store: data.store });

    await correct(repo);

    expect(data.read().opportunity).toEqual(source.opportunity);
  });

  it('preserves projections when malformed links cannot identify an owning market', async () => {
    const source = snapshot({
      markets: [market('market_a', 'Synthetic A'), market('market_b', 'Synthetic B')],
      decks: [deck('orphan_deck', 'missing_market')],
      cards: [companyCard('orphan_card', 'orphan_deck')],
      companyMarket: { co_fixture: 'missing market' },
      opportunity: {
        market_a: opportunity('A'),
        market_b: opportunity('B'),
      },
    });
    const data = memory(source);
    const repo = new GeminiRepository({ client: client(), store: data.store });

    await correct(repo);

    expect(data.read().opportunity).toEqual(source.opportunity);
  });

  it('keeps correction writes ownership-fenced', async () => {
    const source = snapshot({
      markets: [market('market_a', 'Synthetic A')],
      decks: [deck('deck_a', 'market_a')],
      cards: [companyCard('card_a', 'deck_a')],
      companyMarket: { co_fixture: 'Synthetic A' },
      opportunity: { market_a: opportunity('A') },
    });
    const data = memory(source);
    const repo = new GeminiRepository({ client: client(), store: data.store });
    const concurrent = data.read();
    concurrent.opportunity.market_a = opportunity('Concurrent owner update');
    data.replace(concurrent);

    await expect(correct(repo)).rejects.toBeInstanceOf(RepositoryOwnershipLostError);
    expect(data.read()).toEqual(concurrent);
  });
});
