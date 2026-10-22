/**
 * Latest wins (PLAN-CRAAP 1.3 and the section 2 red-team list). Fixed now: 2026-10-20T12:00:00Z.
 */
import { describe, expect, it } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { CONFLICTS_MAX, PRIOR_FIGURES_MAX, compareObservations, resolveWrite } from './compare-observations';

const NOW = new Date('2026-10-20T12:00:00Z');
const ctx = { now: NOW, companyWebsite: 'https://acme.com' };

function fig(over: Partial<CompanyMetric> & { asOf?: string; url?: string; quote?: string } = {}): CompanyMetric {
  const { asOf = '2026-09-01', url = 'https://www.sec.gov/Archives/acme', quote = 'Acme reported revenue of $40 million.', ...rest } = over;
  return {
    id: 'm1', companyId: 'cmp', metricType: 'revenue', value: 40_000_000, confidence: 'verified', source: url,
    citations: [{ title: 'SEC', url }], methodNote: null, capturedAt: '2026-10-01T00:00:00.000Z',
    passageSupport: { sourceUrl: url, quote, basis: 'revenue', asOf, unit: 'USD', periodStart: undefined },
    ...rest,
  } as CompanyMetric;
}
const article = (value: number, asOf: string, over: Partial<CompanyMetric> = {}): CompanyMetric => ({
  ...fig({ asOf, value, confidence: 'estimated', url: 'https://www.reuters.com/a', passageSupport: undefined, ...over }),
  passageSupport: null,
  quotedSupport: { sourceUrl: 'https://www.reuters.com/a', quote: `Acme revenue was ${value}.`, asOf, value, unit: 'USD', basis: 'revenue' },
}) as unknown as CompanyMetric;

describe('compareObservations', () => {
  // 5b (owner audit 2026-10-22): fast-moving figures only. A reputable newer report replaces a
  // stronger held valuation once the held one is more than a quarter older; inside that window it does not.
  const heldValuation = (asOf: string) => fig({ asOf, metricType: 'valuation', value: 130_000_000_000,
    quote: 'Acme was valued at $130 billion.' });
  const reportedValuation = (asOf: string, url = 'https://www.reuters.com/a') => ({
    ...article(300_000_000_000, asOf, { metricType: 'valuation', source: url, citations: [{ title: 'r', url }] }),
    quotedSupport: { sourceUrl: url, quote: 'Acme was valued at $300 billion.', asOf, value: 300_000_000_000, unit: 'USD', basis: 'valuation' },
  }) as unknown as CompanyMetric;
  it('5b: a reputable newer valuation replaces a stronger one held more than 90 days older', () => {
    expect(compareObservations(reportedValuation('2026-09-15'), heldValuation('2026-03-01'), ctx).decision).toBe('replace');
  });
  it('5b: inside 90 days the stronger held valuation stays and the newer one is recorded', () => {
    expect(compareObservations(reportedValuation('2026-09-15'), heldValuation('2026-08-01'), ctx))
      .toMatchObject({ decision: 'keep', newerObservation: true });
  });
  it('5b: a weak site (aggregator) never displaces a stronger held valuation on date alone', () => {
    expect(compareObservations(reportedValuation('2026-09-15', 'https://tracxn.com/acme'), heldValuation('2026-03-01'), ctx).decision).toBe('keep');
  });
  it('a fresh article beats a stale 10-K only if as authoritative; a newer but weaker one is recorded, not adopted', () => {
    const stale10k = fig({ asOf: '2023-12-31' });
    const fresh = article(55_000_000, '2026-09-15');
    const verdict = compareObservations(fresh, stale10k, ctx);
    // The 10-K is verified (lane 3) but demoted to lane 2 once stale; the article is a lane 2 quote
    // from a tier-3 outlet, below the regulator's publisher level: newer but weaker.
    expect(verdict).toMatchObject({ decision: 'keep', newerObservation: true });
  });
  it('a newer figure at least as authoritative replaces', () => {
    expect(compareObservations(fig({ asOf: '2026-09-30', value: 45_000_000 }), fig({ asOf: '2026-03-31' }), ctx).decision).toBe('replace');
  });
  it('an older figure never replaces a newer one', () => {
    expect(compareObservations(fig({ asOf: '2025-03-31' }), fig({ asOf: '2026-03-31' }), ctx).decision).toBe('keep');
  });
  it('a human figure is never replaced, however old', () => {
    const human = fig({ confidence: 'user_verified', asOf: '2019-01-01' });
    expect(compareObservations(fig({ asOf: '2026-09-30', value: 99 }), human, ctx).decision).toBe('keep');
  });
  it('a human figure always wins', () => {
    expect(compareObservations(fig({ confidence: 'user_verified', asOf: '2001-01-01' }), fig(), ctx).decision).toBe('replace');
  });
  it('an undated figure never beats a dated one', () => {
    const undated = { ...article(60_000_000, '2026-09-30'), quotedSupport: null, reportedSupport: null, citations: [{ title: 'x', url: 'https://example.com/p' }], source: 'https://example.com/p' } as CompanyMetric;
    expect(compareObservations(undated, fig(), ctx).decision).toBe('keep');
  });
  it('FY and TTM revenue are not comparable and do not replace each other', () => {
    const fy = fig({ quote: 'Fiscal year revenue was $40 million.', asOf: '2025-12-31' });
    const ttm = fig({ quote: 'Trailing twelve months revenue was $44 million.', asOf: '2026-06-30', value: 44_000_000 });
    expect(compareObservations(ttm, fy, ctx).decision).toBe('not_comparable');
  });
  it('same date and agreeing values re-confirm', () => {
    expect(compareObservations(fig({ value: 40_500_000 }), fig(), ctx).decision).toBe('replace');
  });
  it('same date, differing values from equal evidence is a conflict', () => {
    expect(compareObservations(fig({ value: 60_000_000 }), fig(), ctx).decision).toBe('conflict');
  });
  it('same date, differing values: the stronger evidence wins', () => {
    const weaker = article(60_000_000, '2026-09-01');
    expect(compareObservations(weaker, fig(), ctx).decision).toBe('keep');
    expect(compareObservations(fig({ value: 60_000_000 }), weaker, ctx).decision).toBe('replace');
  });
  it('an empty result never replaces a figure, and a figure fills an empty slot', () => {
    const empty = { ...fig(), value: null, confidence: 'unknown' } as CompanyMetric;
    expect(compareObservations(empty, fig(), ctx).decision).toBe('keep');
    expect(compareObservations(fig(), empty, ctx).decision).toBe('replace');
  });
});

describe('resolveWrite', () => {
  it('keeps the replaced figure dated in priorFigures', () => {
    const prior = fig({ asOf: '2026-03-31' });
    const metric = structuredClone(fig({ asOf: '2026-09-30', value: 45_000_000 }));
    expect(resolveWrite(metric, prior, ctx)).toBe(true);
    expect(metric.value).toBe(45_000_000);
    expect(metric.priorFigures).toEqual([expect.objectContaining({ value: 40_000_000, asOf: '2026-03-31', supersededAt: NOW.toISOString() })]);
  });
  it('re-confirming the same figure adds no prior entry but takes the fresh row', () => {
    const prior = fig();
    const metric = structuredClone({ ...fig(), lastVerifiedAt: '2026-10-20T11:00:00.000Z' });
    expect(resolveWrite(metric, prior, ctx)).toBe(true);
    expect(metric.priorFigures).toBeUndefined();
    expect(metric.lastVerifiedAt).toBe('2026-10-20T11:00:00.000Z');
  });
  it('puts the old row back untouched and records a newer weaker figure', () => {
    const prior = fig({ asOf: '2025-12-31' });
    const metric = structuredClone(article(55_000_000, '2026-09-15'));
    expect(resolveWrite(metric, prior, ctx)).toBe(false);
    expect(metric).toMatchObject({ value: 40_000_000, confidence: 'verified' });
    expect(metric.newerObservation).toMatchObject({ value: 55_000_000, asOf: '2026-09-15' });
  });
  it('never averages: the kept value is one of the observed values', () => {
    const prior = fig({ asOf: '2026-03-31' });
    const metric = structuredClone(fig({ asOf: '2026-09-30', value: 50_000_000 }));
    resolveWrite(metric, prior, ctx);
    expect([40_000_000, 50_000_000]).toContain(metric.value);
  });
  it('records a conflict without changing the figure, and caps conflicts at 8', () => {
    const prior = fig();
    let held = prior;
    for (let i = 0; i < 12; i++) {
      const metric = structuredClone({ ...fig({ value: 80_000_000 + i * 10_000_000 }), conflicts: held.conflicts });
      expect(resolveWrite(metric, held, ctx)).toBe(false);
      held = metric;
    }
    expect(held.value).toBe(40_000_000);
    expect(held.conflicts).toHaveLength(CONFLICTS_MAX);
  });
  it('keeps at most 8 prior figures', () => {
    let held = fig({ asOf: '2024-01-31', value: 10_000_000 });
    for (let i = 1; i <= 12; i++) {
      const month = String(i).padStart(2, '0');
      const metric = structuredClone({ ...fig({ asOf: `2025-${month}-28`, value: 10_000_000 + i * 5_000_000 }), priorFigures: held.priorFigures });
      resolveWrite(metric, held, ctx);
      held = metric;
    }
    expect(held.priorFigures).toHaveLength(PRIOR_FIGURES_MAX);
  });
  it('leaves an empty slot to the new figure', () => {
    const metric = fig();
    expect(resolveWrite(metric, null, ctx)).toBe(true);
    expect(metric.priorFigures).toBeUndefined();
  });
});
