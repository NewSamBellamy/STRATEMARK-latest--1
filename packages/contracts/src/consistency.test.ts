import { describe, expect, it } from 'vitest';
import type { UserFootprintBasis } from './enums';
import {
  auditDeckConsistency,
  verificationTargetsFrom,
  SHARE_SUM_WARNING_PCT,
  type ConsistencyCompanyInput,
} from './consistency';

function company(
  id: string,
  name: string,
  metrics: Array<{
    metricType: string;
    value: number | null;
    confidence?: string;
    userBasis?: UserFootprintBasis;
    methodNote?: string | null;
  }>,
): ConsistencyCompanyInput {
  return {
    companyId: id,
    name,
    metrics: metrics.map((m) => ({
      metricType: m.metricType as ConsistencyCompanyInput['metrics'][number]['metricType'],
      value: m.value,
      confidence: m.confidence ?? 'verified',
      userBasis: m.userBasis,
      methodNote: m.methodNote,
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
      company('z', 'Zeta', [
        { metricType: 'users', value: 9_000_000_000, userBasis: 'monthly_active_users' },
      ]),
    ];
    const findings = auditDeckConsistency(deck);
    expect(findings[0]?.code).toBe('users_exceed_population');
    expect(findings[0]?.severity).toBe('critical');
  });

  it('does not apply a human-population ceiling to downloads or other non-person footprints', () => {
    const deck = [
      company('z', 'Zeta', [
        { metricType: 'users', value: 20_000_000_000, userBasis: 'downloads_or_installs' },
      ]),
    ];
    expect(auditDeckConsistency(deck)).toEqual([]);
  });

  it('audits each human footprint independently and keeps the exact basis on its verification target', () => {
    const deck = [
      company('z', 'Zeta', [
        { metricType: 'users', value: 20_000_000_000, userBasis: 'github_stars' },
        { metricType: 'users', value: 9_000_000_000, userBasis: 'monthly_active_users' },
      ]),
    ];
    const findings = auditDeckConsistency(deck);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('Monthly active users');
    expect(verificationTargetsFrom(findings)).toEqual([
      { companyId: 'z', metricType: 'users', userBasis: 'monthly_active_users' },
    ]);
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

  it('uses market_cap when valuation is absent (public companies)', () => {
    const deck = [
      company('p', 'PublicCo', [
        { metricType: 'arr', value: 10_000_000_000 },
        { metricType: 'market_cap', value: 5_000_000_000 },
      ]),
    ];
    expect(auditDeckConsistency(deck)[0]?.code).toBe('valuation_below_arr');
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
    // 'a:arr' appears exactly once even though two findings name it.
    expect(targets.filter((t) => t.companyId === 'a' && t.metricType === 'arr')).toHaveLength(1);
    // No duplicates at all.
    const keys = targets.map((t) => `${t.companyId}:${t.metricType}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
