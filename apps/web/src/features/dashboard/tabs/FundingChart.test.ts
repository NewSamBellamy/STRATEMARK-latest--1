import { describe, expect, it } from 'vitest';
import { fundingPoints } from './FundingChart';

describe('fundingPoints', () => {
  it('keeps only rounds with a real amount and date, sorted, no zero-fill', () => {
    const pts = fundingPoints([
      { round: 'Series B', amountUsd: 200e6, date: '2023-05-01', leadInvestors: ['X'] },
      { round: 'Seed', amountUsd: null, date: '2021-01-01', leadInvestors: [] },
      { round: 'Series A', amountUsd: 50e6, date: '2022-03', leadInvestors: [] },
      { round: 'Bridge', amountUsd: 10e6, date: null, leadInvestors: [] },
      { round: 'Zero', amountUsd: 0, date: '2020-01-01', leadInvestors: [] },
      { round: 'Bad date', amountUsd: 5e6, date: 'soon', leadInvestors: [] },
    ]);
    expect(pts.map((p) => p.round)).toEqual(['Series A', 'Series B']);
    expect(pts.every((p) => p.amountUsd > 0)).toBe(true);
  });
  it('handles undefined', () => {
    expect(fundingPoints(undefined)).toEqual([]);
  });
});
