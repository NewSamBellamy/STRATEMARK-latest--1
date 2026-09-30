import { describe, expect, it } from 'vitest';
import { buildUserFootprintCohort, inferUserFootprintBasis } from './user-footprint';

describe('user footprint basis', () => {
  it('recognizes explicit measurement units and periods without guessing from vague labels', () => {
    expect(inferUserFootprintBasis('25 million monthly active users')).toBe('monthly_active_users');
    expect(inferUserFootprintBasis('Active GitHub repository stars')).toBe('github_stars');
    expect(inferUserFootprintBasis('App downloads')).toBe('downloads_or_installs');
    expect(inferUserFootprintBasis('App downloads and social reach')).toBe('unknown');
    expect(inferUserFootprintBasis('User base')).toBe('unknown');
    expect(inferUserFootprintBasis('2,500 signups')).toBe('unknown');
    expect(inferUserFootprintBasis('500 paying business accounts')).toBe(
      'paying_business_accounts',
    );
  });

  it('groups only comparable user counts and leaves attention/download proxies out of score cohorts', () => {
    expect(
      buildUserFootprintCohort([
        {
          metricType: 'users',
          companyId: 'a',
          value: 1_000,
          confidence: 'verified',
          userBasis: 'monthly_active_users',
        },
        {
          metricType: 'users',
          companyId: 'b',
          value: 2_000,
          confidence: 'verified',
          userBasis: 'monthly_active_users',
        },
        {
          metricType: 'users',
          companyId: 'c',
          value: 90_000,
          confidence: 'verified',
          userBasis: 'github_stars',
        },
        {
          metricType: 'users',
          companyId: 'd',
          value: 500,
          confidence: 'estimated',
          methodNote: '500 business customer accounts',
        },
        {
          metricType: 'users',
          companyId: 'e',
          value: null,
          confidence: 'unknown',
          userBasis: 'monthly_active_users',
        },
      ]),
    ).toEqual({ basis: 'monthly_active_users', values: [1_000, 2_000] });
  });
});
