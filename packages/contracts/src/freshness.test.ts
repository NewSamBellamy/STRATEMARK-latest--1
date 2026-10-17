import { describe, expect, it } from 'vitest';
import {
  METRIC_VOLATILITY,
  VOLATILITY_SECONDS,
  isHumanAuthored,
  isMetricStale,
  markVerified,
  nextRefreshDueAtMs,
  overdueByMs,
  selectStaleMetrics,
  staleAfterSecondsFor,
  isUnauditedAtBirth,
} from './freshness';
import type { CompanyMetric } from './types';

const T0 = Date.parse('2026-08-01T00:00:00.000Z');
const DAY_MS = 86_400_000;

function metric(overrides: Partial<CompanyMetric> = {}): CompanyMetric {
  return {
    id: 'met_1',
    companyId: 'cmp_1',
    metricType: 'arr',
    value: 1_000_000,
    confidence: 'verified',
    source: null,
    citations: [],
    methodNote: null,
    capturedAt: new Date(T0).toISOString(),
    ...overrides,
  };
}

describe('volatility policy', () => {
  it('treats fast-moving financials as hot and scale figures as warm', () => {
    expect(METRIC_VOLATILITY.valuation).toBe('hot');
    expect(METRIC_VOLATILITY.arr).toBe('hot');
    expect(METRIC_VOLATILITY.employees).toBe('warm');
    expect(VOLATILITY_SECONDS.hot).toBeLessThan(VOLATILITY_SECONDS.warm);
    expect(VOLATILITY_SECONDS.warm).toBeLessThan(VOLATILITY_SECONDS.cold);
  });

  it('makes a weaker figure due sooner than a stronger one of the same type', () => {
    const verified = staleAfterSecondsFor({ metricType: 'arr', confidence: 'verified' });
    const estimated = staleAfterSecondsFor({ metricType: 'arr', confidence: 'estimated' });
    const unknown = staleAfterSecondsFor({ metricType: 'arr', confidence: 'unknown' });

    // An estimate is a standing invitation to find the real number, and a blank
    // is the strongest signal that research is incomplete.
    expect(estimated).toBeLessThan(verified as number);
    expect(unknown).toBeLessThan(estimated as number);
  });

  it('never schedules a human-entered figure for automatic refresh', () => {
    const human = metric({ confidence: 'user_verified' });
    expect(isHumanAuthored(human)).toBe(true);
    expect(staleAfterSecondsFor(human)).toBeNull();
    expect(nextRefreshDueAtMs(human)).toBeNull();
    expect(isMetricStale(human, T0 + 365 * DAY_MS)).toBe(false);
    expect(overdueByMs(human, T0 + 365 * DAY_MS)).toBeNull();
  });
});

describe('due dates', () => {
  it('backs off an inconclusive attempt without changing successful support history', () => {
    const m = metric({ confidence: 'unknown', value: null, lastVerifiedAt: null,
      lastVerificationAttemptAt: new Date(T0).toISOString() });
    expect(isMetricStale(m, T0 + 1_000)).toBe(false);
    expect(isMetricStale(m, T0 + DAY_MS)).toBe(true);
    expect(m.lastVerifiedAt).toBeNull();
  });

  it('is fresh immediately after verification and stale after its window', () => {
    const m = markVerified(metric(), new Date(T0).toISOString());
    expect(isMetricStale(m, T0 + 1_000)).toBe(false);
    // arr is hot (1 day) and verified (×1)
    expect(isMetricStale(m, T0 + DAY_MS + 1_000)).toBe(true);
  });

  it('prefers lastVerifiedAt over capturedAt', () => {
    // Row written long ago, but re-confirmed recently. Re-verifying an unchanged
    // value must count as progress, or stable figures would never look fresh.
    const m = metric({
      capturedAt: new Date(T0).toISOString(),
      lastVerifiedAt: new Date(T0 + 10 * DAY_MS).toISOString(),
      staleAfterSeconds: 86_400,
    });
    expect(isMetricStale(m, T0 + 10 * DAY_MS + 1_000)).toBe(false);
  });

  it('treats an unparseable timestamp as due now rather than as fresh', () => {
    const m = metric({ capturedAt: 'not-a-date', lastVerifiedAt: null });
    expect(nextRefreshDueAtMs(m)).toBe(0);
    expect(isMetricStale(m, T0)).toBe(true);
  });

  it('honours a stored window over the derived one', () => {
    // Policy may change; data already on disk keeps the window it was written
    // with, so a future policy edit cannot retroactively reinterpret freshness.
    const m = metric({ staleAfterSeconds: 10 });
    expect(isMetricStale(m, T0 + 11_000)).toBe(true);
  });

  it('stamps both the confirmation time and the window on verify', () => {
    const at = new Date(T0 + DAY_MS).toISOString();
    const m = markVerified(metric({ confidence: 'estimated' }), at);
    expect(m.lastVerifiedAt).toBe(at);
    expect(m.staleAfterSeconds).toBe(
      staleAfterSecondsFor({ metricType: 'arr', confidence: 'estimated' }),
    );
  });
});

describe('selectStaleMetrics', () => {
  it('returns the most overdue first, capped by the caller budget', () => {
    const slightly = metric({ id: 'a', staleAfterSeconds: 86_400 });
    const badly = metric({
      id: 'b',
      capturedAt: new Date(T0 - 30 * DAY_MS).toISOString(),
      staleAfterSeconds: 86_400,
    });
    const fresh = metric({
      id: 'c',
      capturedAt: new Date(T0 + 10 * DAY_MS).toISOString(),
      staleAfterSeconds: 86_400,
    });

    const now = T0 + 2 * DAY_MS;
    const picked = selectStaleMetrics([slightly, badly, fresh], now, 2);

    expect(picked.map((p) => p.metric.id)).toEqual(['b', 'a']);
    expect(picked[0]?.overdueByMs).toBeGreaterThan(picked[1]?.overdueByMs ?? 0);
  });

  it('excludes fresh and human-authored figures entirely', () => {
    const human = metric({ id: 'h', confidence: 'user_verified' });
    const fresh = metric({
      id: 'f',
      lastVerifiedAt: new Date(T0).toISOString(),
      staleAfterSeconds: 86_400,
    });
    expect(selectStaleMetrics([human, fresh], T0 + 1_000, 10)).toEqual([]);
  });

  it('returns nothing when the budget is zero — the loop must be affordable', () => {
    const stale = metric({ capturedAt: new Date(T0 - 99 * DAY_MS).toISOString() });
    expect(selectStaleMetrics([stale], T0, 0)).toEqual([]);
  });
});

describe('birth audit — soft figures are due immediately, not after a decay window', () => {
  const base = {
    id: 'm1',
    companyId: 'c1',
    metricType: 'arr' as const,
    source: null,
    citations: [],
    methodNote: null,
    capturedAt: new Date('2026-08-25T10:00:00Z').toISOString(),
  };
  const now = Date.parse('2026-08-25T10:05:00Z'); // five minutes after creation

  it('an estimated figure with no verification history is stale NOW (the born-stale ARR case)', () => {
    const metric = { ...base, value: 61_600_000, confidence: 'estimated' as const };
    expect(isUnauditedAtBirth(metric)).toBe(true);
    expect(isMetricStale(metric, now)).toBe(true);
  });

  it('a blank (unknown) figure is due immediately so desks fill gaps first', () => {
    const metric = { ...base, value: null, confidence: 'unknown' as const };
    expect(isMetricStale(metric, now)).toBe(true);
  });

  it('a verified figure fresh from research is NOT due — it earned its window', () => {
    const metric = { ...base, value: 40_000_000_000, confidence: 'verified' as const };
    expect(isUnauditedAtBirth(metric)).toBe(false);
    expect(isMetricStale(metric, now)).toBe(false);
  });

  it('an estimate that has survived a verification pass follows normal decay', () => {
    const metric = {
      ...base,
      value: 61_600_000,
      confidence: 'estimated' as const,
      lastVerifiedAt: new Date('2026-08-25T10:02:00Z').toISOString(),
    };
    expect(isUnauditedAtBirth(metric)).toBe(false);
    expect(isMetricStale(metric, now)).toBe(false);
  });

  it('human-authored figures are never scheduled, born-soft or not', () => {
    const metric = { ...base, value: 5, confidence: 'user_verified' as const };
    expect(isUnauditedAtBirth(metric)).toBe(false);
    expect(nextRefreshDueAtMs(metric)).toBeNull();
  });
});
