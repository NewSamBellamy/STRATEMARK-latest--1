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

  it('escalates to critical when shares are far past 100% (above 150%)', () => {
    const deck = [
      company('a', 'Alpha', [{ metricType: 'market_share', value: 90 }]),
      company('b', 'Beta', [{ metricType: 'market_share', value: 65 }]),
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
        { metricType: 'valuation', value: 40_000_000 }, // critical: 1625x below ARR, a unit slip
        { metricType: 'market_share', value: 90 },
      ]),
      company('b', 'Beta', [{ metricType: 'market_share', value: 70 }]),
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
    for (const ratio of [1, 2, 5, 33.6, 50, 1500, 5_000]) expect(unitSlipFactor(1, ratio), `${ratio}`).toBeNull();
    expect(unitSlipFactor(0, 10)).toBeNull();
    expect(unitSlipFactor(-1, -10)).toBeNull();
  });

  it('reads a revenue figure stored as revenue the way it reads ARR', () => {
    const findings = auditDeckConsistency([
      company('v', 'Revenue Only', [
        { metricType: 'revenue', value: 65_000_000_000 },
        { metricType: 'valuation', value: 40_000_000 },
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

// ── Second review: tolerance for valuation, share sums, what the face withholds, hostile input ──

const OWNERSHIP_CITE = { url: 'https://www.pepsico.com/newsroom/press-releases/2025/pepsico-completes-acquisition-of-poppi', title: 'PepsiCo' };
const acquiredFor200M = {
  status: 'acquired' as const, acquirer: 'PepsiCo', announcedOn: '2025-03-17', closedOn: '2025-05-27',
  price: { value: 200_000_000, currency: 'USD' }, citations: [OWNERSHIP_CITE], confidence: 'verified' as const,
};

function inputCompany(
  id: string,
  name: string,
  metrics: unknown[],
  extra: Record<string, unknown> = {},
): ConsistencyCompanyInput {
  return { companyId: id, name, metrics, ...extra } as unknown as ConsistencyCompanyInput;
}

describe('valuation below revenue is a doubt, and an error only as a unit slip', () => {
  it.each([
    ['a distributor', 250_000_000, 200_000_000],
    ['an installer', 90_000_000, 80_000_000],
    ['a stale round', 60_000_000, 50_000_000],
  ])('%s: $%i revenue on a $%i valuation is a warning and queues no paid check', (_who, arr, valuation) => {
    const findings = auditDeckConsistency([
      company('d', 'Ordinary Co', [
        { metricType: 'arr', value: arr },
        { metricType: 'valuation', value: valuation },
      ]),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: 'valuation_below_arr', severity: 'warning', metricTypes: ['arr', 'valuation'] });
    expect(verificationTargetsFrom(findings)).toEqual([]);
  });

  it('is critical only above 1000x, the size of a unit slip', () => {
    const slip = auditDeckConsistency([
      company('s', 'Slip Co', [
        { metricType: 'arr', value: 65_000_000_000 },
        { metricType: 'valuation', value: 40_000_000 },
      ]),
    ]);
    expect(slip[0]).toMatchObject({ code: 'valuation_below_arr', severity: 'critical' });
    expect(verificationTargetsFrom(slip)).toEqual([
      { companyId: 's', metricType: 'arr' },
      { companyId: 's', metricType: 'valuation' },
    ]);
    const edge = auditDeckConsistency([
      company('e', 'Edge Co', [
        { metricType: 'arr', value: 40_000_000_000 },
        { metricType: 'valuation', value: 40_000_000 },
      ]),
    ]);
    expect(edge[0]?.severity).toBe('warning');
  });

  it('says nothing when the valuation is at least the revenue, and does not divide by a zero valuation', () => {
    expect(auditDeckConsistency([
      company('a', 'Alpha', [{ metricType: 'arr', value: 100_000_000 }, { metricType: 'valuation', value: 100_000_000 }]),
    ])).toEqual([]);
    expect(auditDeckConsistency([
      company('z', 'Zero', [{ metricType: 'arr', value: 100_000_000 }, { metricType: 'valuation', value: 0 }]),
    ])).toEqual([]);
  });
});

describe('share sums are critical only far past 100%, and re-check only the largest shares', () => {
  it('40 + 35 + 36 = 111% is a warning on different bases, not an error', () => {
    const findings = auditDeckConsistency([
      company('a', 'Alpha', [{ metricType: 'market_share', value: 40 }]),
      company('b', 'Beta', [{ metricType: 'market_share', value: 35 }]),
      company('c', 'Gamma', [{ metricType: 'market_share', value: 36 }]),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: 'share_sum_exceeds_market', severity: 'warning' });
    expect(verificationTargetsFrom(findings)).toEqual([]);
  });

  it('is critical above 150% and not at exactly 150%', () => {
    const at = (total: number) => auditDeckConsistency([
      company('a', 'Alpha', [{ metricType: 'market_share', value: total - 40 }]),
      company('b', 'Beta', [{ metricType: 'market_share', value: 40 }]),
    ])[0]?.severity;
    expect(at(150)).toBe('warning');
    expect(at(150.5)).toBe('critical');
  });

  it('queues at most the 3 largest shares of a 72-company deck, not all 72', () => {
    const deck = Array.from({ length: 72 }, (_, i) =>
      company(`c${i}`, `Company ${i}`, [{ metricType: 'market_share', value: i < 2 ? 60 : 0.5 }]));
    // Two 60% shares on different bases plus 70 at 0.5% = 155%.
    const findings = auditDeckConsistency(deck);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('critical');
    // The finding still names every company, so the reader can see the whole claim.
    expect(findings[0]?.companyIds).toHaveLength(72);
    const targets = verificationTargetsFrom(findings);
    expect(targets).toHaveLength(3);
    expect(targets.map((t) => t.metricType)).toEqual(['market_share', 'market_share', 'market_share']);
    expect(targets.slice(0, 2).map((t) => t.companyId).sort()).toEqual(['c0', 'c1']);
  });
});

describe('the audit judges only what the card face shows', () => {
  const acquired = (valuation: Record<string, unknown>, ownership: unknown = acquiredFor200M) => auditDeckConsistency([
    inputCompany('p', 'Poppi', [
      { metricType: 'arr', value: 300_000_000, confidence: 'verified' },
      { metricType: 'valuation', confidence: 'estimated', ...valuation },
    ], { ownership }),
  ]);

  it('ignores an acquired company\'s valuation that equals the deal price (the face shows Valuation Unknown)', () => {
    const findings = acquired({ value: 200_000_000 });
    expect(findings).toEqual([]);
    expect(verificationTargetsFrom(findings)).toEqual([]);
  });

  it('ignores an undated valuation of an acquired company, and a valuation whose own evidence is a purchase price', () => {
    expect(acquired({ value: 150_000_000 }, { ...acquiredFor200M, price: null })).toEqual([]);
    const evidence = auditDeckConsistency([
      inputCompany('q', 'Poppi', [
        { metricType: 'arr', value: 3_000_000_000, confidence: 'verified' },
        { metricType: 'valuation', value: 1_950_000_000, confidence: 'estimated',
          methodNote: 'PepsiCo said Monday it will acquire prebiotic soda brand Poppi for $1.95 billion.' },
      ]),
    ]);
    expect(evidence).toEqual([]);
  });

  it('still audits what the face does show: a pending deal, a human-checked figure, a company with no ownership', () => {
    const pending = acquired({ value: 200_000_000 }, { ...acquiredFor200M, status: 'acquisition_pending', closedOn: null });
    expect(pending).toHaveLength(1);
    expect(acquired({ value: 200_000_000, confidence: 'user_verified' })).toHaveLength(1);
    expect(auditDeckConsistency([
      inputCompany('n', 'No Deal', [
        { metricType: 'arr', value: 300_000_000, confidence: 'verified' },
        { metricType: 'valuation', value: 200_000_000, confidence: 'estimated' },
      ]),
    ])).toHaveLength(1);
  });
});

describe('the audit never throws on hostile input and prefers the newest row', () => {
  it('ignores strings, negatives, non-finite numbers and missing values instead of throwing', () => {
    const hostile = [
      inputCompany('a', 'Alpha', [
        { metricType: 'market_share', value: '60', confidence: 'verified' },
        { metricType: 'arr', value: -65_000_000_000, confidence: 'verified' },
        { metricType: 'valuation', value: -1, confidence: 'verified' },
        { metricType: 'users', value: Number.POSITIVE_INFINITY, confidence: 'verified' },
        { metricType: 'employees', value: Number.NaN, confidence: 'verified' },
        { metricType: 'market_cap', value: undefined, confidence: 'verified' },
        null,
        undefined,
        'not a row',
      ]),
      inputCompany('b', 'Beta', [{ metricType: 'market_share', value: -80, confidence: 'verified' }]),
      inputCompany('c', 'Gamma', [{ metricType: 'market_share', value: 55, confidence: 'verified' }]),
      inputCompany('d', 'Delta', undefined as never),
      null,
      undefined,
      42,
    ];
    expect(() => auditDeckConsistency(hostile as never)).not.toThrow();
    expect(auditDeckConsistency(hostile as never)).toEqual([]);
    expect(() => auditDeckConsistency(undefined as never)).not.toThrow();
    expect(auditDeckConsistency(null as never)).toEqual([]);
    expect(() => verificationTargetsFrom(undefined as never)).not.toThrow();
  });

  it('does not let a negative value drive a critical', () => {
    expect(auditDeckConsistency([
      company('n', 'Negative', [
        { metricType: 'arr', value: 5_000_000_000 },
        { metricType: 'valuation', value: -40_000_000 },
        { metricType: 'users', value: -9_000_000_000 },
      ]),
    ])).toEqual([]);
  });

  it('survives malformed ownership', () => {
    expect(() => auditDeckConsistency([
      inputCompany('o', 'Odd', [{ metricType: 'valuation', value: 5, confidence: 'estimated' }], { ownership: { status: 'acquired', citations: 'nope' } }),
    ])).not.toThrow();
  });

  it('uses the newest row of a type, whichever is listed first', () => {
    const stale = { metricType: 'valuation', value: 100_000_000, confidence: 'estimated', capturedAt: '2023-01-01T00:00:00.000Z' };
    const fresh = { metricType: 'valuation', value: 9_000_000_000, confidence: 'estimated', capturedAt: '2026-06-01T00:00:00.000Z' };
    const arr = { metricType: 'arr', value: 2_000_000_000, confidence: 'verified', capturedAt: '2026-06-01T00:00:00.000Z' };
    for (const rows of [[stale, fresh, arr], [fresh, stale, arr]]) {
      expect(auditDeckConsistency([inputCompany('s', 'Stale First', rows)])).toEqual([]);
    }
    // The newest row is the one that counts when it is the bad one, too.
    const findings = auditDeckConsistency([inputCompany('s', 'Fresh Bad', [fresh, { ...stale, value: 90_000_000_000 }, { ...arr, value: 20_000_000_000 }])]);
    expect(findings[0]).toMatchObject({ code: 'valuation_below_arr', severity: 'warning' });
  });

  it('orders rows by the date of the source (asOf) when it is given, and prefers a human-checked row', () => {
    const older = { metricType: 'valuation', value: 100_000_000, confidence: 'estimated', asOf: '2022-12-31', capturedAt: '2026-06-01T00:00:00.000Z' };
    const newer = { metricType: 'valuation', value: 9_000_000_000, confidence: 'estimated', asOf: '2025-12-31', capturedAt: '2026-01-01T00:00:00.000Z' };
    const arr = { metricType: 'arr', value: 2_000_000_000, confidence: 'verified' };
    expect(auditDeckConsistency([inputCompany('a', 'As Of', [older, newer, arr])])).toEqual([]);
    const human = { metricType: 'valuation', value: 100_000_000, confidence: 'user_verified', capturedAt: '2020-01-01T00:00:00.000Z' };
    expect(auditDeckConsistency([inputCompany('h', 'Human', [human, { ...newer, capturedAt: '2026-06-01T00:00:00.000Z', asOf: undefined }, arr])])).toHaveLength(1);
  });

  it('ignores a type whose newest rows disagree and cannot be told apart', () => {
    const a = { metricType: 'valuation', value: 100_000_000, confidence: 'estimated', capturedAt: '2026-01-01T00:00:00.000Z' };
    const b = { metricType: 'valuation', value: 9_000_000_000, confidence: 'estimated', capturedAt: '2026-01-01T00:00:00.000Z' };
    const arr = { metricType: 'arr', value: 2_000_000_000, confidence: 'verified' };
    expect(auditDeckConsistency([inputCompany('t', 'Tie', [a, b, arr])])).toEqual([]);
    // Two rows that agree are not a tie in any way that matters.
    expect(auditDeckConsistency([inputCompany('t', 'Twins', [a, { ...a }, arr])])).toHaveLength(1);
  });
});

describe('a slip of 10^4, 10^5 or 10^6 is a unit slip too', () => {
  it.each([10_000, 100_000, 1_000_000] as const)('flags a market cap and a valuation that differ by exactly %i', (factor) => {
    for (const [cap, valuation] of [[7_000_000, 7_000_000 * factor], [7_000_000 * factor, 7_000_000]] as const) {
      const findings = auditDeckConsistency([
        company('m', 'Megacorp', [
          { metricType: 'market_cap', value: cap },
          { metricType: 'valuation', value: valuation },
        ]),
      ]);
      expect(findings.map((f) => f.code)).toEqual(['figures_differ_by_power_of_ten']);
      expect(findings[0]?.message).toContain(`${factor}×`);
    }
  });

  it('keeps the 2% tolerance and the gaps between the powers', () => {
    expect(unitSlipFactor(1, 1_000_000)).toBe(1_000_000);
    expect(unitSlipFactor(1, 1_019_000)).toBe(1_000_000);
    expect(unitSlipFactor(1, 1_021_000)).toBeNull();
    expect(unitSlipFactor(1, 98_000)).toBe(100_000);
    expect(unitSlipFactor(1, 97_000)).toBeNull();
    for (const ratio of [5_000, 50_000, 500_000, 10_000_000]) expect(unitSlipFactor(1, ratio), `${ratio}`).toBeNull();
  });
});
