/**
 * One figure, one value, everywhere: the same stored facts read through the card
 * face, the Overview tile, the compare table and the Metrics tab must agree on the
 * value, the currency it was reported in and whether it is a value, an estimate or
 * an honest unknown.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { buildDataset } from '@mi/mocks';
import type { CardWithCompany, Company, CompanyMetric } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { reportedEstimate } from '@/test/reportedEstimate';
import { buildCardView } from '@/features/card/card-view';
import { assessedMetrics } from './figureSet';
import { MetricsTab } from './tabs/MetricsTab';
import { OverviewTab } from './tabs/OverviewTab';
import { MarketPeers } from './tabs/OverviewSnapshot';

vi.mock('./tabs/LeaderGrid', () => ({ WikiAvatar: ({ name }: { name: string }) => <span data-testid="avatar">{name[0]}</span> }));

const ds = buildDataset();
const url = 'https://sec.gov/Archives/report';
const cited = { source: url, citations: [{ title: 'Annual report', url, credibility: 'primary' as const }] };

// Three companies: one reports in euros, one in dollars, one has only an estimate nothing supports.
const euro: Company = { ...ds.companies[0]!, name: 'Euroa AI' };
const dollar: Company = { ...ds.companies[1]!, name: 'Dollara Labs' };
const bare: Company = { ...ds.companies[2]!, name: 'Barely Co' };
const row = (company: Company, metricType: CompanyMetric['metricType'], value: number, patch: Partial<CompanyMetric> = {}): CompanyMetric =>
  ({ ...ds.metrics[0]!, id: `${company.id}_${metricType}`, companyId: company.id, metricType, value, confidence: 'verified',
    methodNote: null, passageSupport: null, reportedSupport: null, quotedSupport: null, assessment: undefined, ...cited, ...patch }) as CompanyMetric;
const metricsOf: Record<string, CompanyMetric[]> = {
  [euro.id]: [row(euro, 'valuation', 11.7e9, { methodNote: 'Series C round valuation reported in euros' })],
  [dollar.id]: [row(dollar, 'valuation', 9e9), reportedEstimate(row(dollar, 'arr', 4e8, { confidence: 'estimated', source: null, citations: [] }), dollar.name)],
  [bare.id]: [row(bare, 'arr', 2e9, { confidence: 'estimated', source: null, citations: [], methodNote: 'Confidence lowered automatically: no citation' })],
};
const companies = [euro, dollar, bare];
const cardFor = (c: Company) => ds.cards.find((k) => k.companyId === c.id && k.cardType === 'company')!;
const deckCards: CardWithCompany[] = companies.map((c) => ({ card: cardFor(c), company: c, metrics: metricsOf[c.id]!, viceClaims: [] }) as CardWithCompany);

function repository() {
  return Object.assign(makeRepo(), {
    getCompany: vi.fn(async (id: string) => companies.find((c) => c.id === id) ?? null),
    getCompanyMetrics: vi.fn(async (id: string) => metricsOf[id] ?? []),
    getDashboardTab: vi.fn().mockResolvedValue(null),
    getDeckByMarket: vi.fn().mockResolvedValue(ds.deck),
    listCards: vi.fn().mockResolvedValue(deckCards),
  });
}
const route = (metric?: string) => `/?deck=${ds.market.id}${metric ? `&metric=${metric}` : ''}`;

describe('one figure, one value, everywhere (Euroa AI: valuation reported in euros)', () => {
  it('the card face shows the euro figure as reported, never as dollars', () => {
    const view = buildCardView(deckCards[0]!);
    const face = view.faceMetrics.find((f) => f.label === 'Valuation')!;
    expect(face.display).toBe('€11.7B');
    expect(view.faceMetrics.map((f) => f.display).join(' ')).not.toContain('$11.7B');
  });

  it('the Overview tile shows the same value and currency', async () => {
    renderWithProviders(<OverviewTab companyId={euro.id} />, { repository: repository(), route: route() });
    const tile = await screen.findByRole('article', { name: /Valuation: €11\.7B/ });
    expect(within(tile).getByText(/Reported in euros \(EUR\); not converted to US dollars/)).toBeInTheDocument();
    expect(screen.queryByText(/\$11\.7B/)).not.toBeInTheDocument();
  });

  it('the compare table shows it with its currency, unranked and not as a dash', async () => {
    renderWithProviders(<MarketPeers companyId={dollar.id} />, { repository: repository(), route: route() });
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    // Dollars first (the ranked figure), then the euro figure, which is shown but not placed by its number.
    expect(rows.map((r) => r.querySelector('th')?.textContent ?? '')).toEqual([expect.stringContaining('Dollara'), expect.stringContaining('Euroa'), expect.stringContaining('Barely')]);
    const euroRow = rows[1]!;
    expect(euroRow).toHaveTextContent('€11.7B');
    expect(within(euroRow).getByText('EUR')).toHaveAttribute('title', expect.stringContaining('not converted to US dollars'));
    expect(euroRow).not.toHaveTextContent('$11.7B');
    // The first cell is the place (blank for an unranked figure); valuation is the next column, and the euro row is not a dash there.
    expect(euroRow.querySelectorAll('td')[1]).not.toHaveTextContent('—');
  });

  it('the Metrics tab lists it as known, in euros, never under "Unknown, not charted"', async () => {
    renderWithProviders(<MetricsTab companyId={dollar.id} />, { repository: repository(), route: route('valuation') });
    const note = await screen.findByText(/Not charted, reported in another currency/);
    expect(note.parentElement).toHaveTextContent('Euroa AI €11.7B (EUR)');
    expect(note.parentElement).toHaveTextContent('not converted to US dollars');
    // The unsourced-figure note ("Not charted, no sourced figure") lists only companies with nothing sourced, never the euro one.
    const unknown = await screen.findByText(/Not charted, no sourced figure/);
    expect(unknown.parentElement).toHaveTextContent('Barely');
    expect(unknown.parentElement).not.toHaveTextContent(/Euroa/);
  });

  it('a converted entry ends the line with "Not ranked", never "Shown as reported, not converted"', async () => {
    const metric = metricsOf[euro.id]![0]!;
    const original = metric.methodNote;
    metric.methodNote = 'Valuation of EUR 10B, converted from euros at the exchange rate';
    try {
      renderWithProviders(<MetricsTab companyId={dollar.id} />, { repository: repository(), route: route('valuation') });
      const note = await screen.findByText(/Not charted, reported in another currency/);
      expect(note.parentElement).toHaveTextContent('converted from EUR');
      expect(note.parentElement).toHaveTextContent('Not ranked: figures in, or converted from, other currencies.');
      expect(note.parentElement).not.toHaveTextContent('not converted to US dollars');
    } finally { metric.methodNote = original; }
  });

  it('the Metrics tab for the company itself shows the same value and currency', async () => {
    renderWithProviders(<MetricsTab companyId={euro.id} />, { repository: repository(), route: route() });
    const table = await screen.findByRole('table');
    expect(within(table).getByText('€11.7B')).toBeInTheDocument();
    expect(screen.queryByText('$11.7B')).not.toBeInTheDocument();
  });
});

describe('one state, everywhere (Barely Co: an estimate nothing supports)', () => {
  it('is "Not found yet" on the card, a dash in the compare table and not a tile or a Metrics row', async () => {
    const face = buildCardView(deckCards[2]!).faceMetrics;
    expect(face.map((f) => f.display).join(' ')).not.toMatch(/2(\.0)?B/);
    // Read-time facts: the figure is withheld with no value and no confidence it did not earn.
    const [arr] = assessedMetrics(metricsOf[bare.id]!, bare);
    expect(arr).toMatchObject({ value: null, confidence: 'unknown' });

    renderWithProviders(<MarketPeers companyId={dollar.id} />, { repository: repository(), route: route() });
    const table = await screen.findByRole('table');
    const barelyRow = within(table).getAllByRole('row').find((r) => /Barely/.test(r.textContent ?? ''))!;
    expect(barelyRow).not.toHaveTextContent(/\$2(\.0)?B/);
  });

  it('is not an Overview tile or a Metrics row either', async () => {
    renderWithProviders(<OverviewTab companyId={bare.id} />, { repository: repository(), route: route() });
    expect((await screen.findAllByText('Not found yet')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('article', { name: /ARR: \$2/ })).not.toBeInTheDocument();
  });
});

describe('one value for a dollar figure too (Dollara Labs)', () => {
  it('reads $9.0B in the card, tile and compare table, and the estimate keeps its marker', async () => {
    const face = buildCardView(deckCards[1]!).faceMetrics.find((f) => f.label === 'Valuation')!;
    expect(face.display.replace('.0', '')).toBe('$9B');
    renderWithProviders(<OverviewTab companyId={dollar.id} />, { repository: repository(), route: route() });
    expect(await screen.findByRole('article', { name: 'Valuation: $9.0B' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: /ARR: \$400\.0M \(estimated\)/ })).toBeInTheDocument();
  });
});
