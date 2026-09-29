import { describe, expect, it, vi } from 'vitest';
import {
  CARD_TYPES,
  DASHBOARD_CONTENT_SCHEMAS,
  DASHBOARD_TABS,
  MATURITY_TIERS,
  cardSchema,
  companyMetricSchema,
  companySchema,
  deckSchema,
  marketSchema,
  viceClaimSchema,
} from '@mi/contracts';
import { buildDataset } from './build-dataset';
import { MockRepository } from './mock-repository';

const data = buildDataset();

describe('fixtures validate against the contract (no drift)', () => {
  it('market and deck are valid', () => {
    expect(() => marketSchema.parse(data.market)).not.toThrow();
    expect(() => deckSchema.parse(data.deck)).not.toThrow();
  });

  it('every company, metric, card, and vice claim is valid', () => {
    for (const c of data.companies) expect(() => companySchema.parse(c)).not.toThrow();
    for (const m of data.metrics) expect(() => companyMetricSchema.parse(m)).not.toThrow();
    for (const c of data.cards) expect(() => cardSchema.parse(c)).not.toThrow();
    for (const v of data.viceClaims) expect(() => viceClaimSchema.parse(v)).not.toThrow();
  });

  it('every generated dashboard tab validates against its per-tab schema', () => {
    for (const record of Object.values(data.dashboards)) {
      for (const tab of DASHBOARD_TABS) {
        const schema = DASHBOARD_CONTENT_SCHEMAS[tab];
        expect(() => schema.parse(record.content[tab])).not.toThrow();
      }
    }
  });

  it('metric value/confidence invariant holds (unknown ⇒ null value)', () => {
    for (const m of data.metrics) {
      if (m.confidence === 'unknown') expect(m.value).toBeNull();
    }
  });
});

describe('coverage — no gaps', () => {
  it('all 6 card types are present in the deck', () => {
    const present = new Set(data.cards.map((c) => c.cardType));
    for (const t of CARD_TYPES) expect(present.has(t)).toBe(true);
  });

  it('company cards cover all 8 maturity tiers', () => {
    const tiers = new Set(
      data.cards.filter((c) => c.cardType === 'company' && c.tier != null).map((c) => c.tier),
    );
    for (const t of MATURITY_TIERS) expect(tiers.has(t)).toBe(true);
  });

  it('every company has a fully-populated 8-tab dashboard', () => {
    for (const company of data.companies) {
      const record = data.dashboards[company.id];
      expect(record).toBeDefined();
      for (const tab of DASHBOARD_TABS) expect(record!.content[tab]).toBeDefined();
    }
  });

  it('every Vice card has at least one sourced claim', () => {
    const viceCards = data.cards.filter((c) => c.cardType === 'vice');
    expect(viceCards.length).toBeGreaterThan(0);
    for (const card of viceCards) {
      const claims = data.viceClaims.filter((v) => v.cardId === card.id);
      expect(claims.length).toBeGreaterThan(0);
      for (const claim of claims) expect(claim.sourceUrl.length).toBeGreaterThan(0);
    }
  });

  it('barrier cards are not company-specific', () => {
    const barriers = data.cards.filter((c) => c.cardType === 'barrier');
    expect(barriers.length).toBeGreaterThan(0);
    for (const b of barriers) {
      expect(b.companyId).toBeNull();
      expect(b.title).not.toBeNull();
    }
  });
});

describe('MockRepository conforms to the interface behavior', () => {
  it('lists the sample market and its populated deck', async () => {
    const repo = new MockRepository();
    const markets = await repo.listMarkets();
    expect(markets.length).toBe(1);
    const deck = await repo.getDeckByMarket(markets[0]!.id);
    expect(deck).not.toBeNull();
    const cards = await repo.listCards(deck!.id);
    expect(cards.length).toBeGreaterThan(0);
  });

  it('filters cards by type and by tier', async () => {
    const repo = new MockRepository();
    const deck = (await repo.getDeckByMarket((await repo.listMarkets())[0]!.id))!;
    const companyCards = await repo.listCards(deck.id, { cardType: 'company' });
    expect(companyCards.every((c) => c.card.cardType === 'company')).toBe(true);
    const tier8 = await repo.listCards(deck.id, { cardType: 'company', tier: 8 });
    expect(tier8.length).toBeGreaterThan(0);
    expect(tier8.every((c) => c.card.tier === 8)).toBe(true);
  });

  it('hydrates a card with company, metrics, and (for vice) claims', async () => {
    const repo = new MockRepository();
    const deck = (await repo.getDeckByMarket((await repo.listMarkets())[0]!.id))!;
    const viceCards = await repo.listCards(deck.id, { cardType: 'vice' });
    expect(viceCards[0]!.viceClaims.length).toBeGreaterThan(0);
    expect(viceCards[0]!.company).not.toBeNull();
    const barriers = await repo.listCards(deck.id, { cardType: 'barrier' });
    expect(barriers[0]!.company).toBeNull();
  });

  it('serves all 8 dashboard tabs for a company', async () => {
    const repo = new MockRepository();
    const deck = (await repo.getDeckByMarket((await repo.listMarkets())[0]!.id))!;
    const card = (await repo.listCards(deck.id, { cardType: 'company' }))[0]!;
    for (const tab of DASHBOARD_TABS) {
      const result = await repo.getDashboardTab(card.company!.id, tab);
      expect(result).not.toBeNull();
      expect(result!.tab).toBe(tab);
    }
  });

  it('creates a market and populates its deck on first refresh, emitting an added event', async () => {
    const repo = new MockRepository();
    const listener = vi.fn();
    const unsub = repo.subscribeDeckRefresh(listener);

    const market = await repo.createMarket({
      name: 'Test Market',
      scopeDefinition: { vertical: 'Test', geography: 'CA', notes: null },
      refreshCadence: 'weekly',
    });
    const deck = (await repo.getDeckByMarket(market.id))!;
    expect(deck.lastRefreshedAt).toBeNull();
    expect((await repo.listCards(deck.id)).length).toBe(0);

    await repo.refreshDeck(market.id);
    const cards = await repo.listCards(deck.id);
    expect(cards.length).toBeGreaterThan(0);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0].addedCardIds.length).toBeGreaterThan(0);

    // Second refresh is incremental (updated, not added).
    await repo.refreshDeck(market.id);
    expect(listener.mock.calls[1]![0].updatedCardIds.length).toBeGreaterThan(0);

    unsub();
    await repo.refreshDeck(market.id);
    expect(listener).toHaveBeenCalledTimes(2); // no more after unsubscribe
  });

  it('updates market cadence', async () => {
    const repo = new MockRepository();
    const market = (await repo.listMarkets())[0]!;
    const updated = await repo.updateMarketCadence(market.id, 'twice_daily');
    expect(updated.refreshCadence).toBe('twice_daily');
  });

  it('never fabricates a research answer when no live engine is connected', async () => {
    const repo = new MockRepository();
    await expect(
      repo.askResearch({
        scope: { kind: 'deck', deckId: 'sample' },
        question: 'Who is winning?',
      }),
    ).rejects.toThrow(/Gemini API key/i);
    expect(await repo.listResearchThreads()).toEqual([]);
  });
});
