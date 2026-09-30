import { describe, expect, it } from 'vitest';
import { applyNudge, buildCmsInput, computeCms, type CmsInput, type CmsContext } from './scoring';

const ctx: CmsContext = {
  userFootprintCohort: {
    basis: 'monthly_active_users',
    values: [1_000, 50_000, 500_000, 5_000_000],
  },
};

function fullInput(overrides: Partial<CmsInput> = {}): CmsInput {
  return {
    marketShare: { value: 12, confidence: 'verified' }, // tier 6
    value: { value: 5_000_000_000, confidence: 'verified', kind: 'valuation' }, // tier 6
    arr: { value: 100_000_000, confidence: 'verified' }, // tier 6
    users: {
      value: 5_000_000,
      confidence: 'verified',
      userBasis: 'monthly_active_users',
    }, // relative tier 8
    employees: { value: 2_000, confidence: 'verified' }, // tier 6
    ...overrides,
  };
}

describe('computeCms — base tier', () => {
  it('computes a weighted-average base tier across all signals', () => {
    const result = computeCms(fullInput(), ctx);
    // Weighted: 0.30*6 + 0.20*6 + 0.20*6 + 0.15*8 + 0.15*6 = 6.3 -> round 6
    expect(result.availableSignalCount).toBe(5);
    expect(result.weightedTierRaw).toBeCloseTo(6.3, 5);
    expect(result.baseTier).toBe(6);
    expect(result.finalTier).toBe(6);
  });

  it('gives every effective weight summing to 1 when all signals present', () => {
    const result = computeCms(fullInput(), ctx);
    const sum = result.perSignal.reduce((s, x) => s + x.effectiveWeight, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});

describe('computeCms — missing data protocol (spec §6.4)', () => {
  it('renormalizes weights across available signals; Unknown is never scored 0', () => {
    // Only market share (tier 6) and ARR (tier 2) known.
    const result = computeCms(
      fullInput({
        value: { value: null, confidence: 'unknown', kind: null },
        users: { value: null, confidence: 'unknown' },
        employees: { value: null, confidence: 'unknown' },
        marketShare: { value: 12, confidence: 'verified' }, // tier 6
        arr: { value: 500_000, confidence: 'estimated' }, // tier 2
      }),
      ctx,
    );
    expect(result.availableSignalCount).toBe(2);
    // Effective weights renormalize 0.30 & 0.20 -> 0.6 & 0.4
    // Weighted tier = 0.6*6 + 0.4*2 = 4.4 -> round 4
    expect(result.weightedTierRaw).toBeCloseTo(4.4, 5);
    expect(result.baseTier).toBe(4);
    const ms = result.perSignal.find((s) => s.key === 'marketShare')!;
    const arr = result.perSignal.find((s) => s.key === 'arr')!;
    expect(ms.effectiveWeight).toBeCloseTo(0.6, 5);
    expect(arr.effectiveWeight).toBeCloseTo(0.4, 5);
    // An unknown signal contributes zero weight but is NOT scored as tier 0.
    const users = result.perSignal.find((s) => s.key === 'users')!;
    expect(users.available).toBe(false);
    expect(users.signalTier).toBeNull();
    expect(users.effectiveWeight).toBe(0);
  });

  it('returns null tiers when no signal is available', () => {
    const result = computeCms(
      {
        marketShare: { value: null, confidence: 'unknown' },
        value: { value: null, confidence: 'unknown', kind: null },
        arr: { value: null, confidence: 'unknown' },
        users: { value: null, confidence: 'unknown' },
        employees: { value: null, confidence: 'unknown' },
      },
      ctx,
    );
    expect(result.baseTier).toBeNull();
    expect(result.finalTier).toBeNull();
    expect(result.weightedTierRaw).toBeNull();
    expect(result.availableSignalCount).toBe(0);
  });

  it('excludes the users signal when the deck lacks ranking context', () => {
    const result = computeCms(fullInput(), { userFootprintCohort: { basis: 'unknown', values: [] } });
    const users = result.perSignal.find((s) => s.key === 'users')!;
    expect(users.available).toBe(false);
    expect(result.availableSignalCount).toBe(4);
  });

  it('compares user footprints only with peers measured on the same basis', () => {
    const input = fullInput();
    input.users = {
      value: 500,
      confidence: 'verified',
      userBasis: 'monthly_active_users',
    };

    const result = computeCms(input, {
      userFootprintCohort: { basis: 'monthly_active_users', values: [100, 500, 1_000] },
    });

    expect(result.perSignal.find((signal) => signal.key === 'users')?.signalTier).toBe(5);
  });

  it('does not fall back to a mixed legacy user list when the company basis has no cohort', () => {
    const input = fullInput();
    input.users = {
      value: 500,
      confidence: 'verified',
      userBasis: 'monthly_active_users',
    };

    const result = computeCms(input, {
      userFootprintCohort: { basis: 'github_stars', values: [100, 500, 1_000] },
    });

    expect(result.perSignal.find((signal) => signal.key === 'users')?.available).toBe(false);
  });

  it('does not mislabel an unrankable one-company cohort as a basis mismatch', () => {
    const input = fullInput();
    input.users = {
      value: 500,
      confidence: 'verified',
      userBasis: 'monthly_active_users',
    };

    const result = computeCms(input, {
      userFootprintCohort: { basis: 'monthly_active_users', values: [500] },
    });
    const users = result.perSignal.find((signal) => signal.key === 'users')!;

    expect(users.available).toBe(false);
    expect(users.excludedReason).toBeNull();
  });
});

describe('computeCms — LLM review nudge (spec §6.3)', () => {
  it('applies a +1 nudge and records the reason', () => {
    const result = computeCms(fullInput(), ctx, {
      nudge: 1,
      nudgeReason: 'Valuation implies Scale, but share is growing fast per [source].',
    });
    expect(result.baseTier).toBe(6);
    expect(result.finalTier).toBe(7);
    expect(result.appliedNudge).toBe(1);
    expect(result.nudgeReason).toContain('growing fast');
  });

  it('clamps a nudge at the tier ceiling', () => {
    const input = fullInput({
      marketShare: { value: 55, confidence: 'verified' }, // tier 8
      value: { value: 120_000_000_000, confidence: 'verified', kind: 'market_cap' }, // tier 8
      arr: { value: 5_000_000_000, confidence: 'verified' }, // tier 8
      employees: { value: 60_000, confidence: 'verified' }, // tier 8
    });
    const result = computeCms(input, ctx, { nudge: 1 });
    expect(result.baseTier).toBe(8);
    expect(result.finalTier).toBe(8); // clamped, not 9
  });

  it('throws if asked to nudge beyond ±1 (LLM can never assign from scratch)', () => {
    // @ts-expect-error — deliberately invalid nudge to prove the guard.
    expect(() => applyNudge(5, 3)).toThrow(RangeError);
  });
});

describe('buildCmsInput', () => {
  it('maps flat metric rows to the five weighted signals and prefers valuation over cap', () => {
    const input = buildCmsInput([
      { metricType: 'market_share', value: 3, confidence: 'estimated' },
      { metricType: 'valuation', value: 80_000_000, confidence: 'verified' },
      { metricType: 'market_cap', value: 999, confidence: 'verified' },
      { metricType: 'arr', value: 8_000_000, confidence: 'verified' },
      { metricType: 'employees', value: 120, confidence: 'verified' },
    ]);
    expect(input.value.kind).toBe('valuation');
    expect(input.value.value).toBe(80_000_000);
    expect(input.users.confidence).toBe('unknown'); // no users row
    expect(input.users.value).toBeNull();
  });

  it('falls back to market cap for public companies with no valuation', () => {
    const input = buildCmsInput([
      { metricType: 'market_cap', value: 5_000_000_000, confidence: 'verified' },
    ]);
    expect(input.value.kind).toBe('market_cap');
    expect(input.value.value).toBe(5_000_000_000);
  });

  it('does not count headcount-derived ARR as a second independent scoring signal', () => {
    const input = buildCmsInput([
      {
        metricType: 'arr',
        value: 160_000_000,
        confidence: 'estimated',
        methodNote: 'Estimated: 1,000 FTEs × $160k benchmark = ~$160M ARR.',
      },
      { metricType: 'employees', value: 1_000, confidence: 'verified' },
    ]);
    const result = computeCms(input, { userFootprintCohort: { basis: 'unknown', values: [] } });
    const arr = result.perSignal.find((signal) => signal.key === 'arr')!;
    const employees = result.perSignal.find((signal) => signal.key === 'employees')!;

    expect(arr.available).toBe(false);
    expect(arr.effectiveWeight).toBe(0);
    expect(employees.available).toBe(true);
    expect(result.availableSignalCount).toBe(1);
  });

  it('uses structured dependencies when excluding pricing-footprint ARR from the user signal', () => {
    const input = buildCmsInput([
      {
        metricType: 'arr',
        value: 1_200_000,
        confidence: 'estimated',
        derivedFromMetricTypes: ['users'],
      },
      {
        metricType: 'users',
        value: 2_500,
        confidence: 'verified',
        userBasis: 'monthly_active_users',
      },
    ]);
    const result = computeCms(input, {
      userFootprintCohort: { basis: 'monthly_active_users', values: [1_000, 2_500, 5_000] },
    });
    const arr = result.perSignal.find((signal) => signal.key === 'arr')!;

    expect(arr.available).toBe(false);
    expect(result.availableSignalCount).toBe(1);
  });

  it('recognizes legacy pricing-footprint ARR rows when their dependency metadata is absent', () => {
    const input = buildCmsInput([
      {
        metricType: 'arr',
        value: 1_200_000,
        confidence: 'estimated',
        methodNote: 'Estimated: 2,500 active teams × $40/mo standard tier ($480/yr) = ~$1.2M ARR.',
      },
      {
        metricType: 'users',
        value: 2_500,
        confidence: 'verified',
        methodNote: '2,500 active teams',
      },
    ]);
    const result = computeCms(input, {
      userFootprintCohort: { basis: 'active_workspaces', values: [1_000, 2_500, 5_000] },
    });

    expect(result.perSignal.find((signal) => signal.key === 'arr')!.available).toBe(false);
    expect(result.availableSignalCount).toBe(1);
  });

  it('excludes derived ARR despite a citation but honors a human-confirmed correction', () => {
    const sourcedProxy = buildCmsInput([
      {
        metricType: 'arr',
        value: 160_000_000,
        confidence: 'verified',
        derivedFromMetricTypes: ['employees'],
      },
      { metricType: 'employees', value: 1_000, confidence: 'verified' },
    ]);
    const humanConfirmed = buildCmsInput([
      {
        metricType: 'arr',
        value: 130_000_000,
        confidence: 'user_verified',
        derivedFromMetricTypes: ['employees'],
      },
      { metricType: 'employees', value: 1_000, confidence: 'verified' },
    ]);

    expect(
      computeCms(sourcedProxy, { userFootprintCohort: { basis: 'unknown', values: [] } }).perSignal.find((s) => s.key === 'arr')!
        .available,
    ).toBe(false);
    expect(
      computeCms(humanConfirmed, { userFootprintCohort: { basis: 'unknown', values: [] } }).perSignal.find((s) => s.key === 'arr')!
        .available,
    ).toBe(true);
  });
});
