import { describe, expect, it, beforeEach, vi } from 'vitest';
import { SentinelRepository } from './SentinelRepository';
import * as sentinelApi from '@/lib/sentinelApi';
import type { DeckResearchBrief } from '@mi/contracts';

describe('SentinelRepository — Stale Local Cloud Deck Cache (#55)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('displays last fetched Cloud Deck data offline as read-only with stale indicator, revision, and timestamp', async () => {
    const repo = new SentinelRepository();

    // 1. Initial successful online fetch populates local cache
    vi.spyOn(sentinelApi, 'getCloudDecks').mockResolvedValueOnce([
      {
        id: 'deck_cloud_1',
        marketId: 'deck_cloud_1',
        title: 'Frontier AI Agents',
        revision: 4,
        updatedAt: '2026-08-30T10:00:00Z',
        createdAt: '2026-08-30T09:00:00Z',
      },
    ]);
    vi.spyOn(sentinelApi, 'getCloudMarkets').mockResolvedValueOnce([
      {
        id: 'deck_cloud_1',
        name: 'Frontier AI Agents',
        revision: 4,
        updatedAt: '2026-08-30T10:00:00Z',
      },
    ]);
    vi.spyOn(sentinelApi, 'getCloudDeck').mockResolvedValueOnce({
      deck: {
        id: 'deck_cloud_1',
        marketId: 'deck_cloud_1',
        title: 'Frontier AI Agents',
        revision: 4,
        lastRefreshedAt: '2026-08-30T10:00:00Z',
      },
      market: { id: 'deck_cloud_1', name: 'Frontier AI Agents', revision: 4 },
      cards: [
        {
          id: 'card_1',
          deckId: 'deck_cloud_1',
          title: 'Anthropic',
          cardType: 'company',
          tier: 1,
        },
      ],
      companies: [{ id: 'comp_1', name: 'Anthropic' }],
      metrics: [],
      viceClaims: [],
    });

    const onlineMarkets = await repo.listMarkets();
    expect(onlineMarkets.length).toBe(1);
    expect(onlineMarkets[0]?.id).toBe('deck_cloud_1');

    const onlineDeck = await repo.getDeckByMarket('deck_cloud_1');
    expect(onlineDeck?.id).toBe('deck_cloud_1');

    const onlineCards = await repo.listCards('deck_cloud_1');
    expect(onlineCards.length).toBe(1);

    // 2. Simulate API outage / offline scenario
    const freshRepoInstance = new SentinelRepository();
    vi.spyOn(sentinelApi, 'getCloudDecks').mockRejectedValue(new Error('Network offline'));
    vi.spyOn(sentinelApi, 'getCloudMarkets').mockRejectedValue(new Error('Network offline'));
    vi.spyOn(sentinelApi, 'getCloudDeck').mockRejectedValue(new Error('Network offline'));

    const offlineMarkets = await freshRepoInstance.listMarkets();
    expect(offlineMarkets.length).toBe(1);
    const cachedMarket = offlineMarkets[0] as unknown as {
      id: string;
      stale?: boolean;
      isOffline?: boolean;
      revision?: number;
      lastSyncedAt?: string;
    };
    expect(cachedMarket.id).toBe('deck_cloud_1');
    expect(cachedMarket.stale).toBe(true);
    expect(cachedMarket.isOffline).toBe(true);
    expect(cachedMarket.revision).toBe(4);

    const offlineDeck = (await freshRepoInstance.getDeckByMarket('deck_cloud_1')) as unknown as {
      id: string;
      stale?: boolean;
      isOffline?: boolean;
      revision?: number;
      lastSyncedAt?: string;
    };
    expect(offlineDeck).not.toBeNull();
    expect(offlineDeck.id).toBe('deck_cloud_1');
    expect(offlineDeck.stale).toBe(true);
    expect(offlineDeck.isOffline).toBe(true);
    expect(offlineDeck.revision).toBe(4);
    expect(offlineDeck.lastSyncedAt).toBeDefined();

    const offlineCards = await freshRepoInstance.listCards('deck_cloud_1');
    expect(offlineCards.length).toBe(1);
    expect(offlineCards[0]?.card.title).toBe('Anthropic');
  });

  it('rejects offline writes from claiming cloud persistence', async () => {
    const repo = new SentinelRepository();
    vi.spyOn(sentinelApi, 'runCloudResearchDeck').mockRejectedValueOnce(new Error('Network unreachable'));

    const brief: DeckResearchBrief = {
      prompt: 'Autonomous Flying Taxis',
      region: 'North America',
    };

    await expect(repo.createResearchedDeck(brief)).rejects.toThrow(/offline|unreachable|failed/i);
  });

  it('removes cached cloud deck upon confirmed deletion without touching BYOK data', async () => {
    const repo = new SentinelRepository();

    // Cache a cloud deck
    repo.cacheCloudDeckResponse({
      ok: true,
      deckId: 'deck_to_delete',
      market: { id: 'deck_to_delete', name: 'Delete Me Market' },
      deck: { id: 'deck_to_delete', marketId: 'deck_to_delete', revision: 2 },
      cards: [],
    });

    vi.spyOn(sentinelApi, 'deleteCloudDeck').mockResolvedValueOnce(true);

    const deleteResult = await repo.deleteDeck('deck_to_delete');
    expect(deleteResult).toBe(true);
    expect(sentinelApi.deleteCloudDeck).toHaveBeenCalledWith('deck_to_delete');

    // Fresh repo offline check verifies deck is removed from cache
    const freshRepo = new SentinelRepository();
    vi.spyOn(sentinelApi, 'getCloudDecks').mockRejectedValue(new Error('Offline'));
    vi.spyOn(sentinelApi, 'getCloudMarkets').mockRejectedValue(new Error('Offline'));

    const markets = await freshRepo.listMarkets();
    expect(markets.some((m) => m.id === 'deck_to_delete')).toBe(false);
  });

  it('marks cache pending deletion during offline deletion and does not resurrect it', async () => {
    const repo = new SentinelRepository();

    // Cache a deck
    repo.cacheCloudDeckResponse({
      ok: true,
      deckId: 'deck_offline_del',
      market: { id: 'deck_offline_del', name: 'Offline Del' },
      deck: { id: 'deck_offline_del', marketId: 'deck_offline_del', revision: 1 },
      cards: [],
    });

    // Offline deletion attempt fails network call
    vi.spyOn(sentinelApi, 'deleteCloudDeck').mockRejectedValueOnce(new Error('Failed to reach server'));

    await repo.deleteDeck('deck_offline_del');

    // Subsequent reads do not resurrect the pending deletion deck
    const freshRepo = new SentinelRepository();
    vi.spyOn(sentinelApi, 'getCloudDecks').mockRejectedValue(new Error('Offline'));
    vi.spyOn(sentinelApi, 'getCloudMarkets').mockRejectedValue(new Error('Offline'));
    vi.spyOn(sentinelApi, 'getCloudDeck').mockRejectedValue(new Error('Offline'));

    const markets = await freshRepo.listMarkets();
    expect(markets.some((m) => m.id === 'deck_offline_del')).toBe(false);

    const deck = await freshRepo.getDeckByMarket('deck_offline_del');
    expect(deck?.id).not.toBe('deck_offline_del');
  });

  it('preserves company-less signal cards returned by the Cloud Deck aggregate', async () => {
    const repo = new SentinelRepository();
    vi.spyOn(sentinelApi, 'getCloudDeck').mockResolvedValueOnce({
      deck: { id: 'deck_signal', marketId: 'deck_signal', revision: 1 },
      market: { id: 'deck_signal', name: 'Signal Market' },
      cards: [
        {
          card: {
            id: 'barrier_1',
            deckId: 'deck_signal',
            companyId: null,
            cardType: 'barrier',
            title: 'Power access',
            summary: 'Grid access limits expansion.',
            tier: null,
            tierReason: null,
            citations: [],
            keyPoints: [],
            createdAt: '2026-08-31T00:00:00.000Z',
          },
          company: null,
          metrics: [],
          viceClaims: [],
        },
      ],
      companies: [],
      metrics: [],
      viceClaims: [],
    });

    const cards = await repo.listCards('deck_signal');

    expect(cards).toHaveLength(1);
    expect(cards[0]?.card.id).toBe('barrier_1');
    expect(cards[0]?.card.cardType).toBe('barrier');
    expect(cards[0]?.card.title).toBe('Power access');
    expect(cards[0]?.company).toBeNull();
    expect(cards[0]?.metrics).toEqual([]);
  });

  it('does not replace an empty running Cloud Deck with seeded sample cards', async () => {
    const repo = new SentinelRepository();
    vi.spyOn(sentinelApi, 'getCloudDeck').mockResolvedValueOnce({
      deck: { id: 'dck_frontier-ai-ecosystem_ckgrf', marketId: 'dck_frontier-ai-ecosystem_ckgrf', revision: 1 },
      market: { id: 'dck_frontier-ai-ecosystem_ckgrf', name: 'Running Market' },
      cards: [],
      companies: [],
      metrics: [],
      viceClaims: [],
      state: { status: 'running' },
    });

    const cards = await repo.listCards('dck_frontier-ai-ecosystem_ckgrf');

    expect(cards).toEqual([]);
  });

  it('does not replace an unavailable Cloud Deck with the seeded sample deck', async () => {
    const repo = new SentinelRepository();
    vi.spyOn(sentinelApi, 'getCloudDeck').mockResolvedValueOnce(null);

    const cards = await repo.listCards('dck_frontier-ai-ecosystem_ckgrf');

    expect(cards).toEqual([]);
  });

  it('does not replace an unavailable Cloud Deck lookup with the seeded sample deck', async () => {
    const repo = new SentinelRepository();
    vi.spyOn(sentinelApi, 'getCloudDeck').mockResolvedValueOnce(null);

    const deck = await repo.getDeckByMarket('mkt_frontier-ai-ecosystem_s248s');

    expect(deck).toBeNull();
  });

  it('does not replace an unavailable Cloud market list with seeded sample markets', async () => {
    const repo = new SentinelRepository();
    vi.spyOn(sentinelApi, 'getCloudDecks').mockResolvedValueOnce([]);
    vi.spyOn(sentinelApi, 'getCloudMarkets').mockResolvedValueOnce([]);

    const markets = await repo.listMarkets();

    expect(markets).toEqual([]);
  });

  it('refreshes cached cards while a Cloud Deck is partial', async () => {
    const repo = new SentinelRepository();
    repo.cacheCloudDeckResponse({
      ok: true,
      deckId: 'deck_partial',
      market: { id: 'deck_partial', name: 'Partial Market' },
      state: { status: 'partial' },
      cards: [
        {
          card: { id: 'card_old', deckId: 'deck_partial', companyId: 'company_1', cardType: 'company', title: 'Old card' },
          company: { id: 'company_1', name: 'Old Company', oneLiner: 'Old data' },
          metrics: [],
          viceClaims: [],
        },
      ],
    });
    vi.spyOn(sentinelApi, 'getCloudDeck').mockResolvedValueOnce({
      deck: { id: 'deck_partial', marketId: 'deck_partial', revision: 2 },
      market: { id: 'deck_partial', name: 'Partial Market' },
      cards: [
        {
          card: { id: 'card_new', deckId: 'deck_partial', companyId: 'company_1', cardType: 'company', title: 'New card' },
          company: { id: 'company_1', name: 'New Company', oneLiner: 'Hydrated data' },
          metrics: [],
          viceClaims: [],
        },
      ],
      companies: [],
      metrics: [],
      viceClaims: [],
      state: { status: 'partial' },
    });

    const freshRepo = new SentinelRepository();
    const cards = await freshRepo.listCards('deck_partial');

    expect(cards[0]?.card.id).toBe('card_new');
    expect(cards[0]?.company?.name).toBe('New Company');
    expect(sentinelApi.getCloudDeck).toHaveBeenCalledWith('deck_partial');
  });
});
