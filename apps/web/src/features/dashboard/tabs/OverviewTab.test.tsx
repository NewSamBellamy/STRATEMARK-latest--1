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
    const takeaways = await screen.findByRole('region', { name: 'What matters' });
    expect(within(takeaways).getByRole('link', { name: 'Reuters' })).toHaveAttribute('href', 'https://reuters.com/a');
    await user.click(screen.getByRole('tab', { name: 'Where they stand' }));
    expect(screen.getByRole('tabpanel', { name: 'Where they stand' })).toHaveTextContent('leading share');
  });
  it('never shows an unsourced estimate as a figure, matching the card face', async () => {
    render([{ ...seed, metricType: 'employees', value: 250, confidence: 'estimated', source: null, citations: [],
      passageSupport: null, reportedSupport: null }]);
    expect(await screen.findByRole('region', { name: 'What matters' })).toBeInTheDocument();
    expect(screen.queryByText('250')).not.toBeInTheDocument();
  });
  it('renders an intentional empty state for a company with no figures and no peers', async () => {
    render([], null);
    expect((await screen.findAllByText('Not found yet')).length).toBe(4);
    expect(screen.getByText('Open this company from its deck to compare')).toBeInTheDocument();
    expect(screen.getByText('Not researched yet')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
