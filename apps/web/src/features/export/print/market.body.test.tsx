import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MockRepository, type SeedSnapshot } from '@mi/mocks';
import sample from '@/sample/frontier-snapshot.json';
import { PrintDocument } from '../PrintDocument';
import { buildFullReport, type FullReportModel, type OverviewSeries } from '../fullReportModel';
import { PrintBars } from './PrintBars';
import { SectionOpener } from './SectionOpener';
import { fanCompanies } from './MarketCover';

async function sampleModel(): Promise<FullReportModel> {
  const repo = new MockRepository({ seedSnapshot: sample as unknown as SeedSnapshot, latencyMs: 0 });
  const [market] = await repo.listMarkets();
  const deck = (await repo.getDeckByMarket(market!.id))!;
  const cards = await repo.listCards(deck.id);
  const snapshot = await repo.exportShareSnapshot({ deckId: deck.id });
  return buildFullReport({ title: market!.name, cards, tabs: snapshot.dashboards });
}

const entry = (name: string, value: number | null, display: string | null) => ({
  companyId: name, name, status: value == null ? ('unknown' as const) : ('sourced' as const), display, label: 'L', value, asOf: null, note: null,
  confidence: value == null ? null : ('verified' as const),
});

describe('market report body', () => {
  it('fans the three companies with the most sourced figures on the cover', async () => {
    const model = await sampleModel();
    const fan = fanCompanies(model);
    expect(fan).toHaveLength(3);
    const best = Math.max(...model.companies.map((c) => c.faceSourced));
    expect(fan[0]!.faceSourced).toBe(best);
    const { container } = render(<PrintDocument job={{ kind: 'marketReport', model }} />);
    expect(container.querySelectorAll('[data-testid="cover-fan"] [data-testid="print-card-face"]')).toHaveLength(3);
    expect(container.querySelector('[data-testid="lineup"]')?.querySelectorAll('[data-testid="print-card-face"]')).toHaveLength(model.companies.length);
  });

  it('draws bars only when chartable and never draws an unknown as a bar', () => {
    const series = (chartable: boolean, entries: OverviewSeries['entries']): OverviewSeries => ({ key: 'revenue', label: 'Revenue', entries, unknown: entries.filter((e) => e.status === 'unknown').map((e) => e.name), chartable });
    const ok = render(<PrintBars sources={[]} series={series(true, [entry('A', 10, '$10B'), entry('B', 5, '$5B'), entry('C', null, null)])} />);
    expect(ok.container.querySelectorAll('[data-testid="chart-bar"]')).toHaveLength(2);
    expect(ok.container.textContent).toContain('Not found: C');
    expect(ok.container.textContent).toContain('$10B');
    const no = render(<PrintBars sources={[]} series={series(false, [entry('A', 10, '$10B'), entry('B', null, null)])} />);
    expect(no.container.querySelector('svg')).toBeNull();
    expect(no.container.querySelectorAll('[data-testid="chart-bar"]')).toHaveLength(0);
  });

  it('prints every figure string only as the model wrote it, with confidence marked one way', async () => {
    const base = await sampleModel();
    // The test seed holds no figures, so give the model some: the printed text must be exactly these strings.
    const first = base.companies[0]!;
    const fig = (display: string, confidence: 'verified' | 'estimated') => ({ label: 'Valuation', status: 'sourced' as const, display, asOf: null, note: 3, confidence });
    const model: FullReportModel = {
      ...base,
      companies: [{ ...first, faceFigures: [fig('$41.5B', 'verified'), { ...fig('$7.2M', 'estimated') }, { label: 'Employees', status: 'unknown', display: null, asOf: null, note: null, confidence: null }], faceSourced: 2 }, ...base.companies.slice(1)],
    };
    const { container } = render(<PrintDocument job={{ kind: 'marketReport', model }} />);
    const spread = container.querySelector('[data-testid="company-spread"]')!;
    const figs = [...spread.querySelectorAll('.sm-spread__fig .sm-fv')];
    expect(figs).toHaveLength(3);
    expect(figs[0]!.textContent).toBe('$41.5B3');
    expect(figs[0]!.className).not.toContain('estimated');
    expect(figs[1]!.className).toContain('estimated');
    expect(figs[1]!.textContent).toBe('$7.2M est.3');
    expect(figs[2]!.textContent).toBe('Unknown');
    // No money figure appears anywhere in the printed text except the strings the model holds.
    const allowed = new Set(['$41.5B', '$7.2M']);
    for (const c of model.companies) for (const r of c.rows) if (!r.unknown) allowed.add(r.valueText);
    for (const s of model.overview) for (const e of s.entries) if (e.display) allowed.add(e.display);
    for (const m of (container.textContent ?? '').match(/\$\d[\d.,]*[KMBT]?/g) ?? []) {
      expect([...allowed].some((a) => a.includes(m))).toBe(true);
    }
  });

  it('renders the opener numeral, title and lead', () => {
    const { getByTestId, container } = render(<SectionOpener numeral="02" title="Companies" lead="What follows." id="x" />);
    expect(getByTestId('opener-numeral').textContent).toBe('02');
    expect(container.querySelector('h2')?.textContent).toBe('Companies');
    expect(container.textContent).toContain('What follows.');
  });

  it('prints unknown as the word Unknown and has no header or aside', async () => {
    const model = await sampleModel();
    const { container } = render(<PrintDocument job={{ kind: 'marketReport', model }} />);
    expect(container.querySelectorAll('.sm-spread__fig .sm-fv--unknown').length).toBeGreaterThan(0);
    for (const el of container.querySelectorAll('.sm-fv--unknown')) expect(el.textContent).toBe('Unknown');
    expect(container.querySelectorAll('header, aside')).toHaveLength(0);
  });
});
