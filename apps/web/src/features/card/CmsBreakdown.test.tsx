import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildDataset } from '@mi/mocks';
import { CmsBreakdown } from './CmsBreakdown';

const dataset = buildDataset();

describe('CmsBreakdown', () => {
  it('explains when estimated ARR is excluded because it reuses headcount', () => {
    const companyCard = dataset.cards.find((card) => card.cardType === 'company')!;
    const employeeMetric = dataset.metrics.find(
      (metric) => metric.companyId === companyCard.companyId && metric.metricType === 'employees',
    )!;
    const arrMetric = {
      ...employeeMetric,
      id: 'proxy-arr-from-headcount',
      metricType: 'arr' as const,
      value: 160_000_000,
      confidence: 'estimated' as const,
      source: null,
      citations: [],
      methodNote: 'Estimated: 1,000 FTEs × $160k benchmark = ~$160M ARR.',
      derivedFromMetricTypes: ['employees' as const],
    };

    render(
      <CmsBreakdown
        card={{ ...companyCard, tier: 6 }}
        metrics={[arrMetric, employeeMetric]}
        userFootprintCohort={{ basis: 'unknown', values: [] }}
      />,
    );

    expect(screen.getByText('Excluded proxy')).toBeInTheDocument();
    expect(screen.getByTitle('This proxy reuses another counted input')).toBeInTheDocument();
  });

  it('explains when a footprint count does not match the deck comparison group', () => {
    const companyCard = dataset.cards.find((card) => card.cardType === 'company')!;
    const userMetric = dataset.metrics.find(
      (metric) => metric.companyId === companyCard.companyId && metric.metricType === 'users',
    )!;
    const activeUsers = {
      ...userMetric,
      userBasis: 'monthly_active_users' as const,
    };

    render(
      <CmsBreakdown
        card={{ ...companyCard, tier: null }}
        metrics={[activeUsers]}
        userFootprintCohort={{ basis: 'github_stars', values: [100, 200] }}
      />,
    );

    expect(screen.getByText('Monthly active users')).toBeInTheDocument();
    expect(screen.getByText('Not comparable')).toHaveAttribute(
      'title',
      "Not scored: this count does not match the deck's comparable footprint type.",
    );
  });

  it('labels the footprint that actually matches the deck scoring cohort', () => {
    const companyCard = dataset.cards.find((card) => card.cardType === 'company')!;
    const userMetric = dataset.metrics.find(
      (metric) => metric.companyId === companyCard.companyId && metric.metricType === 'users',
    )!;

    render(
      <CmsBreakdown
        card={{ ...companyCard, tier: null }}
        metrics={[
          { ...userMetric, id: 'mau', userBasis: 'monthly_active_users' },
          { ...userMetric, id: 'seats', userBasis: 'paid_seats', value: 500 },
        ]}
        userFootprintCohort={{ basis: 'paid_seats', values: [100, 500, 2_000] }}
      />,
    );

    expect(screen.getByText('Paid seats')).toBeInTheDocument();
  });
});
