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
    expect(container.querySelectorAll('.sm-company-head h2').length).toBe(model.companies.length);
  });

  it('puts a company history in time order, whatever way its dates are written', () => {
    const written = ['Q4 2022', 'Q1 2021', '2025 Q3 (July–September)', '2022 Q2 (June)', 'Q3 2023', '2024', 'Q1 2023'];
    expect([...written].sort((a, b) => dateKey(a).localeCompare(dateKey(b)))).toEqual([
      'Q1 2021', '2022 Q2 (June)', 'Q4 2022', 'Q1 2023', 'Q3 2023', '2024', '2025 Q3 (July–September)',
    ]);
    // A date with no year goes last rather than first.
    expect(dateKey('Today')).toBe('9999-0');
  });
});
