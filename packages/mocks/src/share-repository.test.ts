import { describe, expect, it } from 'vitest';
import { MockRepository } from './mock-repository';
import { createShareRepository } from './share-repository';

async function demo() {
  const source = new MockRepository({ latencyMs: 0 });
  const [market] = await source.listMarkets();
  const deck = await source.getDeckByMarket(market!.id);
  const cards = await source.listCards(deck!.id);
  return { source, deck: deck!, cards };
}

describe('MockRepository.exportShareSnapshot', () => {
  it('packages one company card with only that company and its tabs', async () => {
    const { source, deck, cards } = await demo();
    const card = cards.find((c) => c.company && c.card.cardType === 'company')!;
    const snapshot = await source.exportShareSnapshot({ deckId: deck.id, cardId: card.card.id });
    expect(snapshot.kind).toBe('card');
    expect(snapshot.cards.map((c) => c.id)).toEqual([card.card.id]);
    expect(snapshot.companies.map((c) => c.id)).toEqual([card.company!.id]);
    expect(snapshot.metrics.every((m) => m.companyId === card.company!.id)).toBe(true);
    expect(Object.keys(snapshot.dashboards)).toEqual([card.company!.id]);
  });

  it('packages a whole deck', async () => {
    const { source, deck, cards } = await demo();
    const snapshot = await source.exportShareSnapshot({ deckId: deck.id });
    expect(snapshot.kind).toBe('deck');
    expect(snapshot.cards).toHaveLength(cards.length);
  });

  it('refuses a deck or card that is not there', async () => {
    const { source, deck } = await demo();
    await expect(source.exportShareSnapshot({ deckId: 'nope' })).rejects.toThrow('Deck not found');
    await expect(source.exportShareSnapshot({ deckId: deck.id, cardId: 'nope' })).rejects.toThrow('Card not found');
  });
});

describe('the share repository', () => {
  it('holds only what was shared, not the demo companies', async () => {
    const { source, deck, cards } = await demo();
    const card = cards.find((c) => c.company && c.card.cardType === 'company')!;
    const share = createShareRepository(await source.exportShareSnapshot({ deckId: deck.id, cardId: card.card.id }));
    const markets = await share.listMarkets();
    expect(markets).toHaveLength(1);
    const shared = await share.listCards(deck.id);
    expect(shared.map((c) => c.card.id)).toEqual([card.card.id]);
    expect(await share.getCompany(card.company!.id)).not.toBeNull();
    const other = cards.find((c) => c.company && c.company.id !== card.company!.id)!;
    expect(await share.getCompany(other.company!.id)).toBeNull();
  });

  it('serves the stored dashboard tabs', async () => {
    const { source, deck, cards } = await demo();
    const card = cards.find((c) => c.company && c.card.cardType === 'company')!;
    const share = createShareRepository(await source.exportShareSnapshot({ deckId: deck.id, cardId: card.card.id }));
    expect(await share.getDashboardTab(card.company!.id, 'overview')).not.toBeNull();
  });

  it('keeps a figure exactly as it was shared, and each tab its own research date', async () => {
    const { source, deck, cards } = await demo();
    const card = cards.find((c) => c.company && c.card.cardType === 'company')!;
    const snapshot = await source.exportShareSnapshot({ deckId: deck.id, cardId: card.card.id });
    const id = card.company!.id;
    snapshot.dashboards[id] = {
      overview: { content: snapshot.dashboards[id]!.overview!.content, lastRefreshedAt: '2026-01-01T00:00:00.000Z' },
      history: { content: snapshot.dashboards[id]!.history!.content, lastRefreshedAt: '2026-09-01T00:00:00.000Z' },
    };
    snapshot.metrics = [{
      id: 'm1', companyId: id, metricType: 'employees', value: 450, confidence: 'verified', source: 'https://acme.example/about',
      citations: [{ title: 'acme.example', url: 'https://acme.example/about' }], methodNote: null, capturedAt: '2026-10-01T00:00:00.000Z',
    }] as never;
    const share = createShareRepository(snapshot);
    const [metric] = await share.getCompanyMetrics(id);
    expect(metric).toMatchObject({ value: 450, confidence: 'verified' });
    expect((await share.getDashboardTab(id, 'overview'))!.lastRefreshedAt).toBe('2026-01-01T00:00:00.000Z');
    expect((await share.getDashboardTab(id, 'history'))!.lastRefreshedAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('never lends a signal card a company', async () => {
    const { source, deck, cards } = await demo();
    const signal = cards.find((c) => !c.company || c.card.cardType !== 'company');
    expect(signal).toBeDefined();
    const snapshot = await source.exportShareSnapshot({ deckId: deck.id, cardId: signal!.card.id });
    expect(snapshot.metrics).toEqual([]);
    expect(snapshot.dashboards).toEqual({});
  });

  it('refuses to change or research anything, and hides what it does not offer', async () => {
    const { source, deck } = await demo();
    const share = createShareRepository(await source.exportShareSnapshot({ deckId: deck.id }));
    await expect(share.refreshDeck('x')).rejects.toThrow('read-only shared copy');
    await expect(share.generateReport({ kind: 'deck', subjectId: 'x' })).rejects.toThrow('read-only shared copy');
    expect((share as unknown as Record<string, unknown>).askResearch).toBeUndefined();
    expect((share as unknown as Record<string, unknown>).saveCard).toBeUndefined();
    expect(share.capabilities!().unsupported).toEqual(expect.arrayContaining(['deepDive', 'generateReport', 'askResearch']));
    expect(share.capabilities!().ground).toBe(false);
  });
});
