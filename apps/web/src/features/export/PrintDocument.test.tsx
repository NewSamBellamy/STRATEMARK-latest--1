import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MockRepository } from '@mi/mocks';
import { PrintDocument } from './PrintDocument';
import { buildFullReport, dateKey } from './fullReportModel';
import { buildReportModel, companiesFromCards } from './exportModel';

async function sampleDeck() {
  const repo = new MockRepository({ latencyMs: 0 });
  const [market] = await repo.listMarkets();
  const deck = (await repo.getDeckByMarket(market!.id))!;
  const cards = await repo.listCards(deck.id);
  const snapshot = await repo.exportShareSnapshot({ deckId: deck.id });
  return { market: market!, cards, tabs: snapshot.dashboards };
}

describe('the printed market report', () => {
  it('prints every company with its name, and never as a <header>, which print styles hide', async () => {
    const { market, cards: stored, tabs } = await sampleDeck();
    // The sample deck's barriers carry no source, and a finding the report cannot attribute is not printed.
    const cards = stored.map((c) => c.card.cardType === 'barrier'
      ? { ...c, card: { ...c.card, citations: [{ title: 'reuters.com', url: `https://reuters.com/${c.card.id}` }] } } : c);
    const model = buildFullReport({ title: market.name, cards, tabs });
    const { container } = render(<PrintDocument job={{ kind: 'marketReport', model }} />);
    // index.css hides every header element when printing; a company heading in one prints as a blank gap.
    expect(container.querySelectorAll('header')).toHaveLength(0);
    const headings = [...container.querySelectorAll('.sm-company-head h2')].map((h) => h.textContent);
    for (const company of model.companies) expect(headings.some((h) => h?.includes(company.name))).toBe(true);
    const text = container.textContent ?? '';
    expect(text).toContain('The market at a glance');
    expect(text).toContain('Barriers to entry');
    expect(text).toContain('Figures');
  });

  it('names every company in the single-company and short reports too', async () => {
    const { market, cards } = await sampleDeck();
    const model = buildReportModel({ title: market.name, kind: 'deck', companies: companiesFromCards(cards) });
    const { container } = render(<PrintDocument job={{ kind: 'report', model }} />);
    expect(container.querySelectorAll('header')).toHaveLength(0);
    // Each company is a running-head section: its name is in the thead, which Chromium repeats on every page it covers.
    const heads = [...container.querySelectorAll('table.sm-run > thead .sm-r-h2')].map((h) => h.textContent ?? '');
    expect(heads).toHaveLength(model.companies.length);
    for (const company of model.companies) expect(heads.some((h) => h.includes(company.name))).toBe(true);
  });

  it('puts a company history in time order, whatever way its dates are written', () => {
    const written = ['Q4 2022', 'Q1 2021', '2025 Q3 (July–September)', '2022 Q2 (June)', 'Q3 2023', '2024', 'Q1 2023'];
    expect([...written].sort((a, b) => dateKey(a).localeCompare(dateKey(b)))).toEqual([
      'Q1 2021', '2022 Q2 (June)', 'Q4 2022', 'Q1 2023', 'Q3 2023', '2024', '2025 Q3 (July–September)',
    ]);
    // A date with no year goes last rather than first.
    expect(dateKey('Today')).toBe('9999-0');
  });
  it('prints no Market signals heading, and counts none on the cover, when every signal card is unsourced', async () => {
    const { market, cards: stored, tabs } = await sampleDeck();
    // Drop every citation: nothing a signal section could print is attributable.
    const bare = stored.map((c) => ['barrier', 'insight'].includes(c.card.cardType) ? { ...c, card: { ...c.card, citations: [] } } : c);
    const model = buildFullReport({ title: market.name, cards: bare, tabs });
    expect(model.marketSignalCount).toBe(0);
    const { container } = render(<PrintDocument job={{ kind: 'marketReport', model }} />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('Market signals');
    expect(container.querySelector('#sm-signals')).toBeNull();
    expect(text).not.toMatch(/\d+ market signals/);
  });

  it('counts on the cover, and lists in the contents, exactly the signals the section prints', async () => {
    const { market, cards: stored, tabs } = await sampleDeck();
    const cards = stored.map((c, i) => ['barrier', 'insight'].includes(c.card.cardType)
      ? { ...c, card: { ...c.card, citations: i % 2 === 0 ? [{ title: 'reuters.com', url: `https://reuters.com/${c.card.id}` }] : [] } } : c);
    const model = buildFullReport({ title: market.name, cards, tabs });
    const printed = model.barriers.length + model.insights.length;
    expect(printed).toBeGreaterThan(0);
    const { container } = render(<PrintDocument job={{ kind: 'marketReport', model }} />);
    expect(container.querySelectorAll('#sm-signals .sm-signal')).toHaveLength(printed);
    expect(container.querySelector('.sm-cover-meta')?.textContent).toContain(`${printed} market signals`);
  });

  it('repeats a running head with the company name through every company profile and the signal section', async () => {
    const { market, cards: stored, tabs } = await sampleDeck();
    const cards = stored.map((c) => c.card.cardType === 'barrier'
      ? { ...c, card: { ...c.card, citations: [{ title: 'reuters.com', url: `https://reuters.com/${c.card.id}` }] } } : c);
    const model = buildFullReport({ title: market.name, cards, tabs });
    const { container } = render(<PrintDocument job={{ kind: 'marketReport', model }} />);
    const profiles = [...container.querySelectorAll('.sm-profile')];
    expect(profiles).toHaveLength(model.companies.length);
    profiles.forEach((p, i) => {
      expect(p.querySelector('table.sm-run > thead .sm-company-head h2')?.textContent).toContain(model.companies[i]!.name);
    });
    expect(container.querySelector('#sm-signals table.sm-run > thead')?.textContent).toBe('Market signals');
    expect(container.querySelectorAll('header, aside')).toHaveLength(0);
  });

  it('labels history, products and leaders that carry no source, and only those', async () => {
    const { market, cards, tabs } = await sampleDeck();
    const model = buildFullReport({ title: market.name, cards, tabs });
    const NOTE = 'From the stored company profile; no source was attached to this item.';
    const withHistory = model.companies.filter((c) => c.timeline.length > 0).length;
    const { container, unmount } = render(<PrintDocument job={{ kind: 'marketReport', model }} />);
    expect(withHistory).toBeGreaterThan(0);
    const labelled = (blockTitle: string) => [...container.querySelectorAll('.sm-block')].filter((b) => b.querySelector('.sm-h3')?.textContent === blockTitle && (b.textContent ?? '').includes(NOTE)).length;
    expect(labelled('History')).toBe(withHistory);
    expect(labelled('Products')).toBe(model.companies.filter((c) => c.products.length > 0).length);
    expect(labelled('Overview')).toBe(0);
    unmount();
    // A block whose every item is sourced carries no label.
    const sourced = { ...model, companies: model.companies.map((c) => ({ ...c, products: c.products.map((p) => ({ ...p, sourced: true })), leaders: c.leaders.map((l) => ({ ...l, sourced: true })), timeline: c.timeline.map((t) => ({ ...t, sourced: true })) })) };
    const again = render(<PrintDocument job={{ kind: 'marketReport', model: sourced }} />);
    expect(again.container.textContent ?? '').not.toContain(NOTE);
  });
});
