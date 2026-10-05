import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { buildDataset } from '@mi/mocks';
import type { CompanyMetric } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { MetricsTab } from './MetricsTab';

const seed = buildDataset().metrics[0]!;
function show(patch: Partial<CompanyMetric>) {
  const metric: CompanyMetric = { ...seed, metricType: 'employees', value: 123,
    confidence: 'verified', source: null, citations: [], ...patch };
  const repository = Object.assign(makeRepo(), {
    getCompanyMetrics: vi.fn().mockResolvedValue([metric]),
    getDashboardTab: vi.fn().mockResolvedValue(null),
  });
  renderWithProviders(<MetricsTab companyId={metric.companyId} />, { repository });
  return metric;
}

describe('dashboard metric evidence projection', () => {
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
