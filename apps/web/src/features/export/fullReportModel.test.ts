import { describe, expect, it } from 'vitest';
import { MockRepository } from '@mi/mocks';
import type { CardWithCompany } from '@mi/contracts';
import { buildFullReport, overviewParagraphs } from './fullReportModel';

async function sampleDeck() {
  const repo = new MockRepository({ latencyMs: 0 });
  const [market] = await repo.listMarkets();
  const deck = (await repo.getDeckByMarket(market!.id))!;
  const cards = await repo.listCards(deck.id);
  const snapshot = await repo.exportShareSnapshot({ deckId: deck.id });
  return { market: market!, cards, tabs: snapshot.dashboards };
}

describe('overviewParagraphs', () => {
  const long = 'Acme makes industrial widgets for the logistics sector and sells them through a direct sales team across North America and Europe.';

  it('keeps plain paragraphs and drops headings, bullets, tables and figure lines', () => {
    const md = ['## Overview', long, '- a bullet that is not prose', '| a | table |\n| - | - |', `${long} A second paragraph.`].join('\n\n');
    const out = overviewParagraphs(md);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('industrial widgets');
  });

  it('reduces links and emphasis to their words', () => {
    const out = overviewParagraphs(`Acme is a [widget maker](https://example.com/a) with **three** plants and a long history in the sector across the region.`);
    expect(out[0]).toBe('Acme is a widget maker with three plants and a long history in the sector across the region.');
  });

  it('never prints the stored placeholders as if they were an overview', () => {
    expect(overviewParagraphs('No source-backed company snapshot is ready yet, so nothing is shown for this company at present.')).toEqual([]);
    expect(overviewParagraphs('This overview needs an evidence-backed refresh before it can be relied on by anyone reading it.')).toEqual([]);
    expect(overviewParagraphs(null)).toEqual([]);
  });

  it('caps the number of paragraphs', () => {
    const md = Array.from({ length: 6 }, (_, i) => `${long} Paragraph ${i}.`).join('\n\n');
    expect(overviewParagraphs(md, 3)).toHaveLength(3);
  });
});

describe('buildFullReport', () => {
  it('builds a profile for every company on the deck, with the stored sections it has', async () => {
    const { market, cards, tabs } = await sampleDeck();
    const report = buildFullReport({ title: market.name, cards, tabs });
    const companyIds = new Set(cards.filter((c) => c.company && !['culture', 'vice', 'insight', 'barrier'].includes(c.card.cardType)).map((c) => c.company!.id));
    expect(report.companies).toHaveLength(companyIds.size);
    expect(report.thin).toBe(false);
    // At least some of the stored tabs reach the page: this is the whole point over the old one-table report.
    expect(report.companies.some((c) => c.overview.length > 0)).toBe(true);
    expect(report.companies.some((c) => c.products.length > 0 || c.leaders.length > 0 || c.timeline.length > 0)).toBe(true);
  });

  it('leaves a section out when nothing is stored for it, instead of padding it', async () => {
    const { market, cards } = await sampleDeck();
    const bare = buildFullReport({ title: market.name, cards, tabs: {} });
    for (const c of bare.companies) {
      expect(c.overview).toEqual([]);
      expect(c.products).toEqual([]);
      expect(c.leaders).toEqual([]);
      expect(c.timeline).toEqual([]);
      expect(c.news).toEqual([]);
    }
    expect(bare.thin).toBe(true);
  });

  it('shows the same figures as the card faces and the old report: nothing is added', async () => {
    const { market, cards, tabs } = await sampleDeck();
    const full = buildFullReport({ title: market.name, cards, tabs });
    const withoutTabs = buildFullReport({ title: market.name, cards, tabs: {} });
    expect(full.figureCount).toBe(withoutTabs.figureCount);
    expect(full.unknownCount).toBe(withoutTabs.unknownCount);
    for (const c of full.companies) {
      for (const f of c.keyFigures) expect(f.display).not.toMatch(/not found/i);
      expect(c.keyFigures.length).toBeLessThanOrEqual(4);
    }
  });

  it('carries each market signal with its own sources and no company metrics', async () => {
    const { market, cards, tabs } = await sampleDeck();
    const report = buildFullReport({ title: market.name, cards, tabs });
    const barrierCards = cards.filter((c) => c.card.cardType === 'barrier');
    const insightCards = cards.filter((c) => c.card.cardType === 'insight');
    expect(report.barriers).toHaveLength(barrierCards.length);
    expect(report.insights).toHaveLength(insightCards.length);
    for (const b of [...report.barriers, ...report.insights]) {
      expect(b.title.length).toBeGreaterThan(0);
      // The summary is never repeated as a point.
      if (b.summary) expect(b.points).not.toContain(b.summary);
    }
  });

  it('keeps a risk with the source that reports it, drops a repeat, and counts only what is shown', async () => {
    const { market, cards, tabs } = await sampleDeck();
    const company = cards.find((c) => c.company && c.card.cardType === 'company')!;
    const viceCard = {
      ...company,
      card: { ...company.card, id: 'vice_x', cardType: 'vice' as const, title: 'Risks', summary: null },
      viceClaims: [
        { id: 'v1', cardId: 'vice_x', claimText: 'Acme settled a safety complaint in 2024.', sourceUrl: 'https://reuters.com/acme', sourceTitle: 'reuters.com' },
        { id: 'v2', cardId: 'vice_x', claimText: 'Acme settled a safety complaint in 2024.', sourceUrl: 'https://reuters.com/acme', sourceTitle: 'reuters.com' },
      ],
    } as unknown as CardWithCompany;
    const report = buildFullReport({ title: market.name, cards: [...cards, viceCard], tabs });
    const mine = report.companies.find((c) => c.id === company.company!.id)!;
    expect(mine.risks).toHaveLength(1);
    expect(mine.risks[0]!.source?.title).toBe('reuters.com');
    expect(report.signalCount).toBeGreaterThanOrEqual(1);
  });

  it('only ever uses a stored culture note, with its own sources', async () => {
    const { market, cards, tabs } = await sampleDeck();
    const company = cards.find((c) => c.company && c.card.cardType === 'company')!;
    const cultureCard = {
      ...company,
      card: { ...company.card, id: 'culture_x', cardType: 'culture' as const, title: 'Culture', summary: 'Employees describe a flat structure and long hours.', citations: [{ title: 'glassdoor.com', url: 'https://glassdoor.com/acme' }] },
      viceClaims: [],
    } as unknown as CardWithCompany;
    const plain = cards.filter((c) => c.card.cardType !== 'culture');
    const report = buildFullReport({ title: market.name, cards: [...plain, cultureCard], tabs });
    const mine = report.companies.find((c) => c.id === company.company!.id)!;
    expect(mine.culture?.note).toBe('Employees describe a flat structure and long hours.');
    expect(mine.culture?.sources.map((s) => s.title)).toEqual(['glassdoor.com']);
    // The companies without a culture card have none, and nothing is borrowed from their neighbour.
    for (const other of report.companies.filter((c) => c.id !== company.company!.id)) expect(other.culture).toBeNull();
  });

  it('leaves a culture note out when it has no usable source', async () => {
    const { market, cards, tabs } = await sampleDeck();
    const company = cards.find((c) => c.company && c.card.cardType === 'company')!;
    const unsourced = {
      ...company,
      card: { ...company.card, id: 'culture_y', cardType: 'culture' as const, title: 'Culture', summary: 'A great place to work.', citations: [] },
      viceClaims: [],
    } as unknown as CardWithCompany;
    const report = buildFullReport({ title: market.name, cards: [...cards.filter((c) => c.card.cardType !== 'culture'), unsourced], tabs });
    expect(report.companies.every((c) => c.culture === null)).toBe(true);
  });
});
