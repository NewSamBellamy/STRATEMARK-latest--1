import { describe, expect, it } from 'vitest';
import { buildDataset } from '@mi/mocks';
import type { CardWithCompany, CompanyMetric } from '@mi/contracts';
import { buildOpportunityPoints } from './OpportunityPage';

const dataset = buildDataset();
const card = dataset.cards.find(
  (candidate) => candidate.cardType === 'company' && candidate.companyId,
)!;
const company = dataset.companies.find((candidate) => candidate.id === card.companyId)!;
const seed = dataset.metrics[0]!;
const cited = [{ title: 'Annual report', url: 'https://example.com/report' }];
const metric = (
  id: string,
  metricType: CompanyMetric['metricType'],
  value: number,
): CompanyMetric => ({
  ...seed,
  id,
  companyId: company.id,
  metricType,
  value,
  confidence: 'verified',
  source: cited[0]!.url,
  citations: cited,
});

describe('opportunity evidence threshold', () => {
  it('plots only companies with a sourced share and evidence-backed stage', () => {
    const sourced: CardWithCompany = {
      card: { ...card, tier: 5 },
      company,
      metrics: [metric('share', 'market_share', 18), metric('arr', 'arr', 12_000_000)],
      viceClaims: [],
    };
    const unsourced: CardWithCompany = {
      ...sourced,
      metrics: sourced.metrics.map((entry) => ({
        ...entry,
        confidence: 'estimated' as const,
        source: null,
        citations: [],
      })),
    };

    expect(buildOpportunityPoints([unsourced])).toEqual([]);
    expect(buildOpportunityPoints([sourced])).toEqual([
      expect.objectContaining({ name: company.name, tier: 5, share: 18, arr: 12_000_000 }),
    ]);
    const withoutArr = {
      ...sourced,
      metrics: [metric('share-only', 'market_share', 18), metric('value', 'valuation', 90_000_000)],
    };
    expect(buildOpportunityPoints([withoutArr])).toEqual([expect.objectContaining({ arr: null })]);
  });
});
