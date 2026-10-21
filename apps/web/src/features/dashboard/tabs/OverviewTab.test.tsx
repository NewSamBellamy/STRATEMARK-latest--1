import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { buildDataset } from '@mi/mocks';
import type { CompanyMetric } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { OverviewTab } from './OverviewTab';

const seed = buildDataset().metrics[0]!;
const markdown = [
  '## Source-reported background',
  'Acme builds industrial widgets for factories across Europe and Asia since 2012.',
  '[Reuters](https://reuters.com/a) · [SEC](https://sec.gov/x)',
  '',
  '## Market position',
  'Acme holds a leading share of the European widget market according to analysts.',
  '[Gartner](https://gartner.com/b)',
  '',
].join('\n');

function render(metrics: CompanyMetric[], md: string | null = markdown) {
  const repository = Object.assign(makeRepo(), {
    getCompanyMetrics: vi.fn().mockResolvedValue(metrics),
    getDashboardTab: vi.fn().mockResolvedValue(md == null ? null : { companyId: seed.companyId, tab: 'overview', content: { markdown: md }, citations: [] }),
  });
  return renderWithProviders(<OverviewTab companyId={seed.companyId} />, { repository });
}

describe('OverviewTab executive summary', () => {
  it('shows the card face figures with their sources, cited takeaways and a sectioned brief', async () => {
    const { user } = render([{ ...seed, metricType: 'employees', value: 250, confidence: 'verified', source: 'https://sec.gov/x',
      citations: [{ title: 'SEC filing', url: 'https://sec.gov/x', credibility: 'primary' }],
      passageSupport: null, reportedSupport: null, capturedAt: '2026-05-04T00:00:00Z' }]);
    const tile = await screen.findByRole('article', { name: 'Employees: 250' });
    expect(within(tile).getByRole('link', { name: /SEC filing/ })).toHaveAttribute('href', 'https://sec.gov/x');
    const takeaways = await screen.findByRole('region', { name: 'Summary' });
    expect(within(takeaways).getByRole('link', { name: 'Reuters' })).toHaveAttribute('href', 'https://reuters.com/a');
    await user.click(screen.getByRole('tab', { name: 'Where they stand' }));
    expect(screen.getByRole('tabpanel', { name: 'Where they stand' })).toHaveTextContent('leading share');
  });
  it('shows an estimated figure with its est. marker and says it has no link, as Metrics does', async () => {
    render([{ ...seed, metricType: 'employees', value: 250, confidence: 'estimated', source: null, citations: [],
      passageSupport: null, reportedSupport: null }]);
    const tile = await screen.findByRole('article', { name: 'Employees: 250 (estimated)' });
    expect(within(tile).getByText('est.')).toBeInTheDocument();
    expect(within(tile).getByText('No link recorded')).toBeInTheDocument();
    expect(within(tile).getByText(/Period not reported/)).toBeInTheDocument();
  });
  it('shows every figure Metrics shows, including a fifth one, and counts them the same way', async () => {
    const row = (metricType: CompanyMetric['metricType'], value: number, confidence: CompanyMetric['confidence']) =>
      ({ ...seed, id: `m_${metricType}`, metricType, value, confidence, source: null, citations: [], passageSupport: null, reportedSupport: null }) as CompanyMetric;
    render([row('valuation', 11.7e9, 'estimated'), row('arr', 4e8, 'estimated'), row('market_share', 2, 'estimated'), row('users', 450000, 'estimated'), row('employees', 350, 'estimated')]);
    expect(await screen.findByRole('article', { name: 'ARR: $400.0M (estimated)' })).toBeInTheDocument();
    expect(screen.getAllByRole('article').filter((a) => /\(estimated\)/.test(a.getAttribute('aria-label') ?? '')).length).toBe(5);
  });
  it('shows the currency a figure was reported in instead of silently calling it dollars', async () => {
    render([{ ...seed, metricType: 'valuation', value: 11.7e9, confidence: 'estimated', source: null, citations: [],
      methodNote: 'Series C round valuation reported in euros (~$13.8B USD)', passageSupport: null, reportedSupport: null }]);
    const tile = await screen.findByRole('article', { name: /Valuation: €11\.7B/ });
    expect(within(tile).getByText(/Reported in euros \(EUR\); not converted to US dollars/)).toBeInTheDocument();
  });
  it('renders an intentional empty state for a company with no figures or research', async () => {
    render([], null);
    expect((await screen.findAllByText('Not found yet')).length).toBe(4);
    expect(screen.getByText('Not researched yet')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
