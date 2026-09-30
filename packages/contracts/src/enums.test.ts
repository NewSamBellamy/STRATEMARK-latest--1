import { describe, expect, it } from 'vitest';
import { MATURITY_TIERS, TIER_BLURBS, TIER_LABELS } from './enums';

describe('company size-band copy', () => {
  it('uses neutral footprint labels for all eight bands', () => {
    expect(MATURITY_TIERS.map((tier) => TIER_LABELS[tier])).toEqual([
      'Minimal footprint',
      'Very small footprint',
      'Small footprint',
      'Mid-sized footprint',
      'Substantial footprint',
      'Large footprint',
      'Very large footprint',
      'Largest footprint',
    ]);
  });

  it('makes clear the bands are size signals, not business-quality judgments', () => {
    for (const tier of MATURITY_TIERS) {
      expect(TIER_BLURBS[tier]).toContain('size signals');
      expect(TIER_BLURBS[tier]).toContain(
        'not a measure of growth, product quality, or leadership',
      );
    }
  });
});
