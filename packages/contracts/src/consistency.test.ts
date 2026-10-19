import { describe, expect, it } from 'vitest';
import {
  auditDeckConsistency,
  verificationTargetsFrom,
  unitSlipFactor,
  SHARE_SUM_WARNING_PCT,
  type ConsistencyCompanyInput,
} from './consistency';

function company(
  id: string,
  name: string,
  metrics: Array<{ metricType: string; value: number | null; confidence?: string }>,
): ConsistencyCompanyInput {
  return {
    companyId: id,
    name,
    metrics: metrics.map((m) => ({
      metricType: m.metricType as ConsistencyCompanyInput['metrics'][number]['metricType'],
      value: m.value,
      confidence: m.confidence ?? 'verified',
    })),
  };
}

describe('auditDeckConsistency', () => {
  it('returns no findings for a plausible deck', () => {
    const deck = [
      company('a', 'Alpha', [
        { metricType: 'arr', value: 2_000_000_000 },
        { metricType: 'valuation', value: 40_000_000_000 },
        { metricType: 'market_share', value: 30 },
        { metricType: 'employees', value: 2_000 },
        { metricType: 'users', value: 50_000_000 },
      ]),
      company('b', 'Beta', [
        { metricType: 'arr', value: 500_000_000 },
        { metricType: 'valuation', value: 8_000_000_000 },
        { metricType: 'market_share', value: 12 },
        { metricType: 'employees', value: 900 },
      ]),
    ];
    expect(auditDeckConsistency(deck)).toEqual([]);
  });

  it('flags market shares that sum past the whole market (the 61.7% + 40% bug)', () => {
    const deck = [
      company('openai', 'OpenAI', [{ metricType: 'market_share', value: 61.7 }]),
      company('anthropic', 'Anthropic', [{ metricType: 'market_share', value: 40 }]),
    ];
    const findings = auditDeckConsistency(deck);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('share_sum_exceeds_market');
    // 101.7% is over the market but plausibly mixed-basis → warning, not critical.
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('101.7%');
    // Largest claim listed first.
    expect(findings[0]?.companyIds[0]).toBe('openai');
  });

  it('escalates to critical when shares are far past 100%', () => {
    const deck = [
      company('a', 'Alpha', [{ metricType: 'market_share', value: 80 }]),
      company('b', 'Beta', [{ metricType: 'market_share', value: 55 }]),
    ];
    const findings = auditDeckConsistency(deck);
    expect(findings[0]?.code).toBe('share_sum_exceeds_market');
    expect(findings[0]?.severity).toBe('critical');
  });

  it(`tolerates share sums up to ${SHARE_SUM_WARNING_PCT}% (rounding slack)`, () => {
    const deck = [
      company('a', 'Alpha', [{ metricType: 'market_share', value: 60 }]),
      company('b', 'Beta', [{ metricType: 'market_share', value: 40.3 }]),
    ];
    expect(auditDeckConsistency(deck)).toEqual([]);
  });

  it('flags a valuation stored below ARR (the $65B ARR vs $965B-valuation-inversion class)', () => {
    const deck = [
      company('x', 'Xerxes AI', [
        { metricType: 'arr', value: 65_000_000_000 },
        { metricType: 'valuation', value: 40_000_000_000 },
      ]),
    ];
    const findings = auditDeckConsistency(deck);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('valuation_below_arr');
    expect(findings[0]?.metricTypes).toEqual(['arr', 'valuation']);
  });

  it('flags impossible revenue per employee', () => {
    const deck = [
      company('y', 'Ypsilon', [
        { metricType: 'arr', value: 65_000_000_000 },
        { metricType: 'employees', value: 3_000 },
      ]),
    ];
    const findings = auditDeckConsistency(deck);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('arr_per_employee_implausible');
    expect(findings[0]?.severity).toBe('warning');
  });

  it('flags user counts above the world population', () => {
    const deck = [
      company('z', 'Zeta', [{ metricType: 'users', value: 9_000_000_000 }]),
    ];
    const findings = auditDeckConsistency(deck);
    expect(findings[0]?.code).toBe('users_exceed_population');
    expect(findings[0]?.severity).toBe('critical');
  });

  it('ignores unknown-confidence rows entirely — an honest Unknown is never inconsistent', () => {
    const deck = [
      company('u', 'Umbra', [
        { metricType: 'market_share', value: 90, confidence: 'unknown' },
        { metricType: 'arr', value: null },
      ]),
      company('v', 'Vanta', [{ metricType: 'market_share', value: 80 }]),
    ];
    expect(auditDeckConsistency(deck)).toEqual([]);
  });

  it('uses market_cap when valuation is absent, but only for a unit-sized gap', () => {
    const slip = [
      company('p', 'PublicCo', [
        { metricType: 'arr', value: 60_000_000_000 },
        { metricType: 'market_cap', value: 5_000_000_000 },
      ]),
    ];
    const findings = auditDeckConsistency(slip);
    expect(findings[0]?.code).toBe('valuation_below_arr');
    expect(findings[0]?.metricTypes).toEqual(['arr', 'market_cap']);
  });

  it('does not call a listed company with revenue above its market cap an error (Sunrun: $3.0B revenue, $1.8B market cap)', () => {
    const deck = [
      company('s', 'Sunrun Inc.', [
        { metricType: 'arr', value: 3_000_000_000 },
        { metricType: 'market_cap', value: 1_800_000_000 },
      ]),
    ];
    expect(auditDeckConsistency(deck)).toEqual([]);
    expect(verificationTargetsFrom(auditDeckConsistency(deck))).toEqual([]);
  });
});

describe('verificationTargetsFrom', () => {
  it('orders critical findings first and deduplicates company+metric pairs', () => {
    const deck = [
      company('a', 'Alpha', [
        { metricType: 'arr', value: 65_000_000_000 },
        { metricType: 'employees', value: 100 }, // warning: absurd per-head
        { metricType: 'valuation', value: 1_000_000_000 }, // critical: below ARR
        { metricType: 'market_share', value: 70 },
      ]),
      company('b', 'Beta', [{ metricType: 'market_share', value: 60 }]),
    ];
    const targets = verificationTargetsFrom(auditDeckConsistency(deck));
    // Critical targets (share sum + valuation_below_arr) come before the warning.
    expect(targets[0]).toEqual({ companyId: 'a', metricType: 'market_share' });
    // The warning (absurd revenue per head) names 'a:employees', but a warning never queues a paid re-check.
    expect(targets.some((t) => t.metricType === 'employees')).toBe(false);
    // 'a:arr' appears exactly once even though two findings name it.
    expect(targets.filter((t) => t.companyId === 'a' && t.metricType === 'arr')).toHaveLength(1);
    // No duplicates at all.
    const keys = targets.map((t) => `${t.companyId}:${t.metricType}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('a market cap against revenue, and against a second figure that should agree', () => {
  it('does not call revenue far above a LISTED market cap an error: $47B revenue on a $1.4B cap is a note', () => {
    const deck = [
      company('d', 'Distressed Holdings', [
        { metricType: 'arr', value: 47_000_000_000 },
        { metricType: 'market_cap', value: 1_400_000_000 },
      ]),
    ];
    const findings = auditDeckConsistency(deck);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: 'valuation_below_arr', severity: 'warning', metricTypes: ['arr', 'market_cap'] });
    // A warning is shown, never re-checked at a cost.
    expect(verificationTargetsFrom(findings)).toEqual([]);
  });

  it('is an error only above 1000x, a unit slip no business can be', () => {
    const slip = auditDeckConsistency([
      company('s', 'Slip Inc', [
        { metricType: 'arr', value: 47_000_000_000 },
        { metricType: 'market_cap', value: 40_000_000 },
      ]),
    ]);
    expect(slip).toHaveLength(1);
    expect(slip[0]).toMatchObject({ code: 'valuation_below_arr', severity: 'critical' });
    expect(verificationTargetsFrom(slip)).toEqual([
      { companyId: 's', metricType: 'arr' },
      { companyId: 's', metricType: 'market_cap' },
    ]);
    // Exactly 1000x is not above it.
    const edge = auditDeckConsistency([
      company('e', 'Edge Inc', [
        { metricType: 'arr', value: 40_000_000_000 },
        { metricType: 'market_cap', value: 40_000_000 },
      ]),
    ]);
    expect(edge[0]?.severity).toBe('warning');
  });

  it('notes a gap of exactly 10x, and says nothing below it', () => {
    const tenfold = auditDeckConsistency([
      company('t', 'Tenfold', [
        { metricType: 'arr', value: 50_000_000_000 },
        { metricType: 'market_cap', value: 5_000_000_000 },
      ]),
    ]);
    expect(tenfold).toHaveLength(1);
    expect(tenfold[0]).toMatchObject({ code: 'valuation_below_arr', severity: 'warning' });
    const ninefold = auditDeckConsistency([
      company('n', 'Ninefold', [
        { metricType: 'arr', value: 45_000_000_000 },
        { metricType: 'market_cap', value: 5_000_000_000 },
      ]),
    ]);
    expect(ninefold).toEqual([]);
  });

  it('judges the market cap whether or not a valuation is also stored, and never divides by zero', () => {
    const both = auditDeckConsistency([
      company('b', 'Both', [
        { metricType: 'arr', value: 47_000_000_000 },
        { metricType: 'valuation', value: 60_000_000_000 },
        { metricType: 'market_cap', value: 1_400_000_000 },
      ]),
    ]);
    expect(both).toHaveLength(1);
    expect(both[0]).toMatchObject({ code: 'valuation_below_arr', severity: 'warning', metricTypes: ['arr', 'market_cap'] });
    const zero = auditDeckConsistency([
      company('z', 'Zero', [
        { metricType: 'arr', value: 1_000_000_000 },
        { metricType: 'market_cap', value: 0 },
      ]),
    ]);
    expect(zero).toEqual([]);
  });

  it.each([10, 100, 1000] as const)('flags a market cap and a valuation that differ by exactly %ix, whichever is larger', (factor) => {
    for (const [cap, valuation] of [[7_000_000_000, 7_000_000_000 * factor], [7_000_000_000 * factor, 7_000_000_000]] as const) {
      const findings = auditDeckConsistency([
        company('m', 'Megacorp', [
          { metricType: 'market_cap', value: cap },
          { metricType: 'valuation', value: valuation },
        ]),
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ code: 'figures_differ_by_power_of_ten', severity: 'critical', metricTypes: ['valuation', 'market_cap'] });
      expect(findings[0]?.message).toContain(`${factor}×`);
      // A critical finding does queue the re-check that would settle which figure slipped.
      expect(verificationTargetsFrom(findings)).toEqual([
        { companyId: 'm', metricType: 'valuation' },
        { companyId: 'm', metricType: 'market_cap' },
      ]);
    }
  });

  it('catches the 100x slip: a $70B market cap against a $700M valuation', () => {
    const findings = auditDeckConsistency([
      company('p', 'Public Co', [
        { metricType: 'market_cap', value: 70_000_000_000 },
        { metricType: 'valuation', value: 700_000_000 },
      ]),
    ]);
    expect(findings.map((f) => f.code)).toEqual(['figures_differ_by_power_of_ten']);
  });

  it('catches a revenue stored two ways that differ by 100x: $2.2B ARR against $220B revenue on a $70B market cap', () => {
    const findings = auditDeckConsistency([
      company('r', 'Revenue Co', [
        { metricType: 'arr', value: 2_200_000_000 },
        { metricType: 'revenue', value: 220_000_000_000 },
        { metricType: 'market_cap', value: 70_000_000_000 },
      ]),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: 'figures_differ_by_power_of_ten', severity: 'critical', metricTypes: ['arr', 'revenue'] });
  });

  it('allows 2% either side of a power of ten and nothing else', () => {
    expect(unitSlipFactor(1, 10)).toBe(10);
    expect(unitSlipFactor(10.2, 1)).toBe(10);
    expect(unitSlipFactor(1, 9.8)).toBe(10);
    expect(unitSlipFactor(1, 10.21)).toBeNull();
    expect(unitSlipFactor(1, 9.79)).toBeNull();
    expect(unitSlipFactor(3, 300)).toBe(100);
    expect(unitSlipFactor(2, 2000)).toBe(1000);
    for (const ratio of [1, 2, 5, 33.6, 50, 1500, 10_000]) expect(unitSlipFactor(1, ratio), `${ratio}`).toBeNull();
    expect(unitSlipFactor(0, 10)).toBeNull();
    expect(unitSlipFactor(-1, -10)).toBeNull();
  });

  it('reads a revenue figure stored as revenue the way it reads ARR', () => {
    const findings = auditDeckConsistency([
      company('v', 'Revenue Only', [
        { metricType: 'revenue', value: 65_000_000_000 },
        { metricType: 'valuation', value: 40_000_000_000 },
      ]),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: 'valuation_below_arr', severity: 'critical', metricTypes: ['revenue', 'valuation'] });
  });
});

describe('a warning never queues a paid re-check', () => {
  it('queues nothing for shares a little over 100% or for an implausible revenue per head', () => {
    const shares = auditDeckConsistency([
      company('a', 'Alpha', [{ metricType: 'market_share', value: 61.7 }]),
      company('b', 'Beta', [{ metricType: 'market_share', value: 40 }]),
    ]);
    expect(shares.map((f) => f.severity)).toEqual(['warning']);
    expect(verificationTargetsFrom(shares)).toEqual([]);
    const perHead = auditDeckConsistency([
      company('y', 'Ypsilon', [
        { metricType: 'arr', value: 65_000_000_000 },
        { metricType: 'employees', value: 3_000 },
      ]),
    ]);
    expect(perHead.map((f) => f.severity)).toEqual(['warning']);
    expect(verificationTargetsFrom(perHead)).toEqual([]);
  });

  it('queues only the critical findings from a mixed deck', () => {
    const findings = auditDeckConsistency([
      company('a', 'Alpha', [
        { metricType: 'arr', value: 65_000_000_000 },
        { metricType: 'employees', value: 100 },
        { metricType: 'market_cap', value: 1_400_000_000 },
      ]),
    ]);
    expect(findings.map((f) => f.severity).sort()).toEqual(['warning', 'warning']);
    expect(verificationTargetsFrom(findings)).toEqual([]);
  });
});
