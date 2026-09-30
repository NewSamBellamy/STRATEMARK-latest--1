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
        deckUserValues={[]}
      />,
    );

    expect(screen.getByText('Excluded proxy')).toBeInTheDocument();
    expect(screen.getByTitle('This proxy reuses another counted input')).toBeInTheDocument();
  });
});
