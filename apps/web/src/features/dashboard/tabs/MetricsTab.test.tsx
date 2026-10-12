import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { buildDataset } from '@mi/mocks';
import type { CompanyMetric } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { MetricsTab } from './MetricsTab';
import { OverviewTab } from './OverviewTab';

const seed = buildDataset().metrics[0]!;
function show(patch: Partial<CompanyMetric>, overview = false) {
  const metric: CompanyMetric = { ...seed, metricType: 'employees', value: 123,
    confidence: 'verified', source: null, citations: [], ...patch };
  const repository = Object.assign(makeRepo(), {
    getCompanyMetrics: vi.fn().mockResolvedValue([metric]),
    getDashboardTab: vi.fn().mockResolvedValue(overview ? { companyId: metric.companyId, tab: 'overview', content: { markdown: 'Source-reported overview.' }, citations: [] } : null),
  });
  renderWithProviders(overview ? <OverviewTab companyId={metric.companyId} /> : <MetricsTab companyId={metric.companyId} />, { repository });
  return metric;
}

describe('dashboard metric evidence projection', () => {
  it.each([false, true])('preserves annual revenue rather than relabeling it ARR (overview: %s)', async overview => {
    show({ metricType: 'arr', value: 331839000000, confidence: 'verified',
      source: 'https://data.sec.gov/report', citations: [{ title: 'SEC filing', url: 'https://data.sec.gov/report' }],
      passageSupport: { sourceUrl: 'https://data.sec.gov/report', quote: 'Retained annual observation.',
        basis: 'arr', unit: 'USD', definition: 'annual_revenue', asOf: '2026-06-30', periodStart: '2025-07-01' },
    }, overview);
    expect((await screen.findAllByText('Annual revenue')).length).toBeGreaterThan(0);
    expect(screen.queryByText('ARR', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Where this value sits on the T1–T8 signal band')).not.toBeInTheDocument();
  });
  it('makes the retained evidence failure available on the existing Unknown badge', async () => {
    show({ value: null, confidence: 'unknown', methodNote: 'Original source could not be read. Try an accessible original publisher.' });
    await screen.findByRole('button', { name: 'Correct Employees' });
    expect(screen.getByLabelText('Confidence: Unknown. Original source could not be read. Try an accessible original publisher.')).toBeInTheDocument();
    expect(screen.queryByText('123')).not.toBeInTheDocument();
  });
  it('lists found figures once, in the table, with no repeated headline strip', async () => {
    show({ confidence: 'estimated' });
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Employees')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Company headline metrics' })).not.toBeInTheDocument();
  });
  it('does not label unsupported legacy figures as verified when cards reject them', async () => {
    const metric = show({ source: 'https://reuters.com.attacker.test/figure',
      citations: [{ title: 'Reuters', url: 'https://reuters.com.attacker.test/figure', credibility: 'primary' }] });
    await screen.findByRole('button', { name: 'Correct Employees' });
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(screen.getAllByText('Estimated').length).toBeGreaterThan(0);
    expect(metric.confidence).toBe('verified');
  });
  it.each([
    { metricType: 'employees' as const, value: -5 },
    { metricType: 'users' as const, value: 0 },
  ])('keeps invalid or unestablished figures unknown: %j', async patch => {
    show({ ...patch, source: 'https://sec.gov/Archives/report',
      citations: [{ title: 'Filing', url: 'https://sec.gov/Archives/report', credibility: 'primary' }] });
    expect((await screen.findAllByText('Unknown')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
  });

  it('shows a labelled gap with what would fill it for sparse companies, never a zero', async () => {
    show({ value: null, confidence: 'unknown' });
    await screen.findByRole('button', { name: 'Correct Employees' });
    expect(screen.getAllByText(/What would fill this/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(1);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
  it('keeps missing figures out of the table and opens what would fill one when selected', async () => {
    const { user } = (() => {
      const metrics = [
        { ...seed, id: 'm1', metricType: 'employees' as const, value: 120, confidence: 'estimated' as const, source: null, citations: [] },
        { ...seed, id: 'm2', metricType: 'valuation' as const, value: 5e9, confidence: 'estimated' as const, source: null, citations: [] },
      ];
      const repository = Object.assign(makeRepo(), {
        getCompanyMetrics: vi.fn().mockResolvedValue(metrics),
        getDashboardTab: vi.fn().mockResolvedValue(null),
      });
      return renderWithProviders(<MetricsTab companyId={seed.companyId} />, { repository });
    })();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Employees')).toBeInTheDocument();
    expect(within(table).queryByText('Unknown')).not.toBeInTheDocument();
    await user.click(within(table).getByText('Valuation'));
    expect(screen.getByRole('complementary', { name: 'Valuation detail' })).toBeInTheDocument();
    expect(screen.getByText(/Open this company from its deck to compare/)).toBeInTheDocument();
    const gap = screen.getByText('Not found yet:').parentElement!;
    await user.click(within(gap).getAllByRole('button')[0]!);
    expect(screen.getAllByText(/What would fill this/).length).toBeGreaterThan(0);
  });
  it('sorts found figures by value when a header is clicked', async () => {
    const metrics = [
      { ...seed, id: 'm1', metricType: 'employees' as const, value: 120, confidence: 'estimated' as const, source: null, citations: [] },
      { ...seed, id: 'm2', metricType: 'valuation' as const, value: 5e9, confidence: 'estimated' as const, source: null, citations: [] },
    ];
    const repository = Object.assign(makeRepo(), {
      getCompanyMetrics: vi.fn().mockResolvedValue(metrics),
      getDashboardTab: vi.fn().mockResolvedValue(null),
    });
    const { user } = renderWithProviders(<MetricsTab companyId={seed.companyId} />, { repository });
    const table = await screen.findByRole('table');
    await user.click(within(table).getByRole('button', { name: /Value/ }));
    const rows = within(table).getAllByRole('row').slice(1).map((r) => r.textContent ?? '');
    expect(rows[0]).toMatch(/Valuation/);
    expect(rows[1]).toMatch(/Employees/);
    expect(rows).toHaveLength(2);
  });
});
