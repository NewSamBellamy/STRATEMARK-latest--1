import { describe, expect, it } from 'vitest';
import { metricDisplayLabel } from './metric-label';

describe('metricDisplayLabel', () => {
  it('names the basis of a structured user-footprint metric', () => {
    expect(metricDisplayLabel({ metricType: 'users', userBasis: 'github_stars' })).toBe(
      'GitHub stars',
    );
  });

  it('uses a conservative label for legacy user rows with ambiguous notes', () => {
    expect(
      metricDisplayLabel({ metricType: 'users', methodNote: 'social reach and app installs' }),
    ).toBe('Unclassified footprint');
  });

  it('preserves the canonical label for other metric types', () => {
    expect(metricDisplayLabel({ metricType: 'arr' })).toBe('ARR');
  });
});
