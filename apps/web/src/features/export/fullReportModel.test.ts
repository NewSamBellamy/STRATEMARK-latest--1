import { describe, expect, it } from 'vitest';
import { MockRepository } from '@mi/mocks';
import type { CardWithCompany } from '@mi/contracts';
import { buildFullReport, hasProseFigure, overviewParagraphs, withoutProseFigures } from './fullReportModel';

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

// -- What the printed report will not state --------------------------------------------------------------------------

/** The sample deck with no stored risk or culture cards, so each test adds exactly the signal cards it is about. */
async function plainDeck() {
  const { market, cards, tabs } = await sampleDeck();
  const plain = cards.filter((c) => c.card.cardType !== 'vice' && c.card.cardType !== 'culture');
  const company = plain.find((c) => c.company && c.card.cardType === 'company')!;
  return { market, cards: plain, tabs, company };
}

function viceCard(base: CardWithCompany, id: string, claims: Array<{ claimText: string; sourceUrl: string }>): CardWithCompany {
  return {
    ...base,
    card: { ...base.card, id, cardType: 'vice' as const, title: 'Risks', summary: null },
    viceClaims: claims.map((c, i) => ({ id: `${id}_${i}`, cardId: id, sourceTitle: null, capturedAt: '2026-01-01T00:00:00.000Z', ...c })),
  } as unknown as CardWithCompany;
}
const sourced = (texts: string[], host = 'reuters.com') => texts.map((claimText, i) => ({ claimText, sourceUrl: `https://${host}/story-${i}` }));

describe('risks in the printed report', () => {
  it('drops a risk with no usable http source, and never lets it hide a sourced repeat', async () => {
    const { market, cards, tabs, company } = await plainDeck();
    const claim = 'Acme settled a safety complaint in 2024.';
    const card = viceCard(company, 'vice_a', [
      { claimText: claim, sourceUrl: '' },
      { claimText: 'Acme faces a recall.', sourceUrl: '   ' },
      { claimText: 'Acme was fined by a regulator.', sourceUrl: 'ftp://files.example.com/fine' },
      { claimText: 'Acme was sued by a supplier.', sourceUrl: 'javascript:alert(1)' },
      { claimText: 'Acme is under investigation.', sourceUrl: 'not a url' },
      { claimText: claim, sourceUrl: 'https://reuters.com/acme' },
    ]);
    const report = buildFullReport({ title: market.name, cards: [...cards, card], tabs });
    const mine = report.companies.find((c) => c.id === company.company!.id)!;
    expect(mine.risks.map((r) => r.text)).toEqual([claim]);
    expect(mine.risks[0]!.source.title).toBe('reuters.com');
    expect(mine.risks.every((r) => /^https?:\/\//.test(r.source.url))).toBe(true);
  });

  it('prints no risk at all, and counts no card, when none of its claims has a source', async () => {
    const { market, cards, tabs, company } = await plainDeck();
    const baseline = buildFullReport({ title: market.name, cards, tabs }).signalCount;
    const card = viceCard(company, 'vice_b', [{ claimText: 'Acme hides defects.', sourceUrl: '' }, { claimText: 'Acme lies.', sourceUrl: 'nope' }]);
    const report = buildFullReport({ title: market.name, cards: [...cards, card], tabs });
    expect(report.companies.find((c) => c.id === company.company!.id)!.risks).toEqual([]);
    expect(report.signalCount).toBe(baseline);
  });

  it('counts the signal cards it prints, not the claims on them', async () => {
    const { market, cards, tabs, company } = await plainDeck();
    const baseline = buildFullReport({ title: market.name, cards, tabs }).signalCount;
    const countWith = (...extra: CardWithCompany[]) => buildFullReport({ title: market.name, cards: [...cards, ...extra], tabs }).signalCount;
    const a = viceCard(company, 'vice_1', sourced(['Risk one.', 'Risk two.', 'Risk three.']));
    // One risk card with three printed claims is one signal.
    expect(countWith(a)).toBe(baseline + 1);
    // A card whose claims only repeat what is already printed adds nothing.
    const repeat = viceCard(company, 'vice_2', sourced(['Risk one.', 'Risk two.']));
    expect(countWith(a, repeat)).toBe(baseline + 1);
    // Four risks are printed per company: card B supplies the fourth, card C is entirely past the cap, so it is not a printed card.
    const b = viceCard(company, 'vice_3', sourced(['Risk four.', 'Risk five.', 'Risk six.']));
    const c = viceCard(company, 'vice_4', sourced(['Risk seven.', 'Risk eight.']));
    const capped = buildFullReport({ title: market.name, cards: [...cards, a, b, c], tabs });
    expect(capped.companies.find((x) => x.id === company.company!.id)!.risks).toHaveLength(4);
    expect(capped.signalCount).toBe(baseline + 2);
  });
});

describe('free prose in the printed profiles', () => {
  it('recognises money, headcount, user and market-share figures, and nothing that merely has a number in it', () => {
    for (const text of [
      'It raised $500M at a $5B valuation.', 'It raised €2.1bn from investors.', 'A USD 500 million round.',
      'The company has about 1,200 employees.', 'It employs about 300 people.', 'Headcount reached 1,200.',
      'It serves 3 million monthly active users.', 'It has 12,000 customers.', 'It holds a 40% market share.',
      'Its market share rose to 12.5% last year.', 'A 500M Series C.', 'A team of 50 engineers built it.',
    ]) expect(hasProseFigure(text), text).toBe(true);
    for (const text of [
      'Founded in 2015 in Austin, Texas.', 'It closed its Series C in Q1 2021.', 'ISO 9001 certified plants in three states.',
      'It launched a GPT-4 based assistant.', 'It opened offices in 12 countries.', 'It was founded by three engineers.', '',
    ]) expect(hasProseFigure(text), text).toBe(false);
    expect(hasProseFigure(null)).toBe(false);
  });

  it('keeps the sentences around a figure as stored, and nothing when nothing is left', () => {
    expect(withoutProseFigures('Acme makes widgets. It raised $500M in 2024. Its customers are retailers.')).toBe('Acme makes widgets. Its customers are retailers.');
    expect(withoutProseFigures('It raised $500M in 2024. It employs 1,200 people.')).toBeNull();
    expect(withoutProseFigures(null)).toBeNull();
  });

  it('prints no money or headcount figure from an overview, a timeline, a product line or a one-liner', async () => {
    const { market, cards, tabs, company } = await plainDeck();
    const id = company.company!.id;
    const stored = {
      ...tabs,
      [id]: {
        ...tabs[id],
        overview: { content: { markdown: [
          'Acme makes industrial widgets for the logistics sector across North America and Europe. It raised $500M at a $5B valuation in 2024. Its customers include several large retailers and carriers.',
          'The company now employs about 1,200 people worldwide and serves 3 million monthly active users. Revenue passed $200 million last year.',
          'Founded in 2015 in Austin, Texas, the company grew from a garage workshop into a regional supplier with plants in three states.',
        ].join('\n\n') } },
        history: { content: { founderStory: '', quotes: [], timeline: [
          { date: '2019', title: 'Opened Berlin office', detail: '' },
          { date: '2021', title: 'Raised $500M Series C at a $5B valuation', detail: '' },
          { date: '2023', title: 'Grew to 1,200 employees', detail: '' },
          { date: 'Q2 2022', title: 'Launched the Atlas platform', detail: '' },
        ] } },
        products_roadmap: { content: { roadmap: [], products: [
          { name: 'Atlas', description: 'Our flagship widget. It has 2 million users.', revenueNote: '', url: null, status: 'live' },
          { name: 'Beacon', description: 'Serves 2 million users.', revenueNote: '', url: null, status: null },
        ] } },
      },
    };
    const withLiner = cards.map((c) => (c.company?.id === id ? { ...c, company: { ...c.company, oneLiner: 'Widget maker with a $5B valuation' } } : c));
    const report = buildFullReport({ title: market.name, cards: withLiner, tabs: stored });
    const mine = report.companies.find((c) => c.id === id)!;
    const overview = mine.overview.join(' ');
    // What it states without a figure stays...
    expect(overview).toContain('industrial widgets');
    expect(overview).toContain('large retailers and carriers');
    expect(overview).toContain('Founded in 2015');
    // ...and what it states with one does not.
    expect(overview).not.toMatch(/\$|million|1,200|employs/);
    expect(mine.timeline.map((t) => t.title)).toEqual(['Opened Berlin office', 'Launched the Atlas platform']);
    expect(mine.products.find((p) => p.name === 'Atlas')!.description).toBe('Our flagship widget.');
    expect(mine.products.find((p) => p.name === 'Beacon')!.description).toBeNull();
    expect(mine.oneLiner).toBeNull();
  });

  it('prints no unchecked figure anywhere in the prose of the sample deck', async () => {
    const { market, cards, tabs } = await sampleDeck();
    const report = buildFullReport({ title: market.name, cards, tabs });
    for (const c of report.companies) {
      for (const text of [c.oneLiner, ...c.overview, ...c.timeline.map((t) => t.title), ...c.products.map((p) => p.description)]) {
        expect(hasProseFigure(text), `${c.name}: ${text}`).toBe(false);
      }
    }
  });
});
