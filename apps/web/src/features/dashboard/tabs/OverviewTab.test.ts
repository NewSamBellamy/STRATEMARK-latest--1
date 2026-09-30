import { describe, expect, it } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { strongestMetrics } from './OverviewTab';

function footprint(
  id: string,
  userBasis: CompanyMetric['userBasis'],
  confidence: CompanyMetric['confidence'],
): CompanyMetric {
  return {
    id,
    companyId: 'company-1',
    metricType: 'users',
    value: 500,
    confidence,
    source: null,
    citations: [],
    methodNote: userBasis ?? null,
    userBasis,
    capturedAt: '2026-09-29T00:00:00.000Z',
  };
}

describe('overview headline metrics', () => {
  it('prefers the deck-comparable user footprint and leaves the other counts for Metrics', () => {
    const metrics = [
      footprint('seats', 'paid_seats', 'user_verified'),
      footprint('mau', 'monthly_active_users', 'estimated'),
    ];

    const headline = strongestMetrics(metrics, 'monthly_active_users');

    expect(headline.filter((metric) => metric.metricType === 'users').map((metric) => metric.id)).toEqual([
      'mau',
    ]);
  });
});
