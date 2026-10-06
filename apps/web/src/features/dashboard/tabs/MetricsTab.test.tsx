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
  it('keeps headline figures in a dedicated region separate from research actions', async () => {
    show({ confidence: 'estimated' });
    const band = await screen.findByRole('region', { name: 'Company headline metrics' });
    expect(within(band).getByText('Employees')).toBeInTheDocument();
    expect(within(band).queryByRole('button')).not.toBeInTheDocument();
  });
  it('does not label unsupported legacy figures as verified when cards reject them', async () => {
    const metric = show({ source: 'https://reuters.com.attacker.test/figure',
      citations: [{ title: 'Reuters', url: 'https://reuters.com.attacker.test/figure', credibility: 'primary' }] });
    await screen.findByRole('button', { name: 'Correct Employees' });
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(screen.getByText('Estimated')).toBeInTheDocument();
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
});
