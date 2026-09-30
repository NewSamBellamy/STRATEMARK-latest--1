import { describe, expect, it } from 'vitest';
import {
  buildUserFootprintCohort,
  findUserFootprint,
  inferUserFootprintBasis,
  userFootprintBasisFor,
} from './user-footprint';

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

  it('targets one of several user footprints by basis while keeping legacy first-row lookup', () => {
    const metrics = [
      {
        metricType: 'users',
        value: 12_000,
        confidence: 'verified' as const,
        userBasis: 'monthly_active_users' as const,
      },
      {
        metricType: 'users',
        value: 500,
        confidence: 'verified' as const,
        userBasis: 'paid_seats' as const,
      },
    ];

    expect(findUserFootprint(metrics, 'paid_seats')?.value).toBe(500);
    expect(findUserFootprint(metrics)?.value).toBe(12_000);
    expect(userFootprintBasisFor({ methodNote: 'Monthly active users' })).toBe(
      'monthly_active_users',
    );
  });

  it('requires the method note to target one of several other or unknown footprints', () => {
    const metrics = [
      {
        id: 'community-count',
        metricType: 'users',
        value: 2_000,
        confidence: 'estimated' as const,
        userBasis: 'unknown' as const,
        methodNote: 'Community members, source A',
      },
      {
        id: 'repo-count',
        metricType: 'users',
        value: 800,
        confidence: 'estimated' as const,
        userBasis: 'unknown' as const,
        methodNote: 'Repository watchers, source B',
      },
      {
        id: 'partner-count',
        metricType: 'users',
        value: 12,
        confidence: 'estimated' as const,
        userBasis: 'other' as const,
        methodNote: 'Partner organizations',
      },
      {
        id: 'event-count',
        metricType: 'users',
        value: 4,
        confidence: 'estimated' as const,
        userBasis: 'other' as const,
        methodNote: 'Event attendees',
      },
    ];

    expect(findUserFootprint(metrics, 'unknown')).toBeUndefined();
    expect(findUserFootprint(metrics, 'unknown', '  COMMUNITY members,  source A ')?.id).toBe(
      'community-count',
    );
    expect(findUserFootprint(metrics, 'other')).toBeUndefined();
    expect(findUserFootprint(metrics, 'other', 'Event attendees')?.id).toBe('event-count');
  });
});
