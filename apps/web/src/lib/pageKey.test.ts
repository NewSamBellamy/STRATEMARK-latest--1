import { describe, expect, it } from 'vitest';
import { pageKey } from './pageKey';

describe('pageKey', () => {
  it('treats every tab of one company dashboard as the same page', () => {
    expect(pageKey('/company/cmp_a/dashboard/history')).toBe('/company/cmp_a/dashboard');
    expect(pageKey('/company/cmp_a/dashboard/metrics')).toBe('/company/cmp_a/dashboard');
    expect(pageKey('/company/cmp_a/dashboard')).toBe('/company/cmp_a/dashboard');
  });

  it('separates different subjects and different pages', () => {
    expect(pageKey('/company/cmp_b/dashboard/history')).not.toBe(pageKey('/company/cmp_a/dashboard/history'));
    expect(pageKey('/markets/m1/deck')).not.toBe(pageKey('/markets/m2/deck'));
    expect(pageKey('/markets/m1/deck')).not.toBe(pageKey('/markets/m1/briefing'));
    expect(pageKey('/reports/r1')).not.toBe(pageKey('/reports'));
  });

  it('ignores a trailing slash', () => {
    expect(pageKey('/history/')).toBe('/history');
    expect(pageKey('/')).toBe('/');
  });
});
