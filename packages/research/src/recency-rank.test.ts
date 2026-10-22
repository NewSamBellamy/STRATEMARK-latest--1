/**
 * Newest credible report first (owner audit 2026-10-22). Ordering only: no value is created.
 */
import { describe, expect, it } from 'vitest';
import {
  RECENCY_OVERRIDE_DAYS, beats, orderFiguresNewestFirst, rankNewestCredible, rehuntDue, sourceCandidate, type RecencyCandidate,
} from './recency-rank';

const c = (asOf: string | null, credibility: number, primary = false, fastMoving = true): RecencyCandidate => ({ asOf, credibility, primary, fastMoving });

describe('beats', () => {
  it('a newer dated figure beats an older dated one at equal credibility', () => {
    expect(beats(c('2026-09-30', 2), c('2025-10-01', 2))).toBe(true);
    expect(beats(c('2025-10-01', 2), c('2026-09-30', 2))).toBe(false);
  });

  it('an undated figure loses to a dated one, whatever its credibility', () => {
    expect(beats(c(null, 3, true), c('2024-01-01', 1))).toBe(false);
    expect(beats(c('2024-01-01', 1), c(null, 3, true))).toBe(true);
    expect(beats(c('not a date', 3), c('2024-01-01', 1))).toBe(false);
  });

  it(`a reputable newer report beats an older primary one only past ${RECENCY_OVERRIDE_DAYS} days`, () => {
    const companyPage = c('2026-06-01', 2, true);
    expect(beats(c('2026-07-15', 2), companyPage)).toBe(false); // 44 days: the company's own figure stands
    expect(beats(c('2026-08-30', 2), companyPage)).toBe(false); // exactly 90 days: still inside the window
    expect(beats(c('2026-08-31', 2), companyPage)).toBe(true); // 91 days: the newer report wins
  });

  it('for a fast-moving figure, a reputable newer report beats a stronger older one only past the window', () => {
    const regulator = c('2026-01-01', 3, true);
    expect(beats(c('2026-03-01', 2), regulator)).toBe(false);
    expect(beats(c('2026-09-01', 2), regulator)).toBe(true);
  });

  it('for other figures (a filed revenue) the stronger older source stays', () => {
    expect(beats(c('2026-09-01', 2, false, false), c('2024-01-01', 3, true, false))).toBe(false);
  });

  it('a weak site never wins on date alone', () => {
    expect(beats(c('2026-10-01', 1), c('2025-01-01', 2))).toBe(false);
  });

  it('same date: the more credible, then the primary one', () => {
    expect(beats(c('2026-05-01', 3), c('2026-05-01', 2))).toBe(true);
    expect(beats(c('2026-05-01', 2, true), c('2026-05-01', 2))).toBe(true);
  });
});

describe('sourceCandidate', () => {
  it('reads credibility and primacy from the publisher registry', () => {
    expect(sourceCandidate('valuation', 'https://www.reuters.com/x', '2026-09-01', 'https://openai.com')).toMatchObject({ credibility: 2, primary: false });
    expect(sourceCandidate('valuation', 'https://openai.com/news', '2026-09-01', 'https://openai.com')).toMatchObject({ credibility: 2, primary: true });
    expect(sourceCandidate('valuation', 'https://tracxn.com/x', '2026-09-01')).toMatchObject({ credibility: 1 });
    expect(sourceCandidate('valuation', 'https://en.wikipedia.org/wiki/OpenAI', '2026-09-01')).toMatchObject({ credibility: 1 });
  });
});

describe('orderFiguresNewestFirst', () => {
  it('puts the newest credible valuation first and keeps metric order', () => {
    const figs = [
      { metricType: 'employees' as const, id: 'emp' },
      { metricType: 'valuation' as const, id: 'old-wiki', passageSupport: { sourceUrl: 'https://en.wikipedia.org/wiki/X', asOf: '2025-03-31' } },
      { metricType: 'valuation' as const, id: 'undated', passageSupport: { sourceUrl: 'https://www.reuters.com/u', asOf: null } },
      { metricType: 'valuation' as const, id: 'old-reuters', passageSupport: { sourceUrl: 'https://www.reuters.com/a', asOf: '2025-03-31' } },
      { metricType: 'valuation' as const, id: 'new-reuters', passageSupport: { sourceUrl: 'https://www.reuters.com/b', asOf: '2026-10-02' } },
    ];
    expect(orderFiguresNewestFirst(figs, 'https://x.com').map((f) => f.id)).toEqual(['emp', 'new-reuters', 'old-reuters', 'old-wiki', 'undated']);
  });

  it('is stable for equal candidates', () => {
    expect(rankNewestCredible(['a', 'b', 'c'], () => c('2026-01-01', 2))).toEqual(['a', 'b', 'c']);
  });
});

describe('rehuntDue', () => {
  it('re-hunts stale, aging and undated figures', () => {
    for (const state of ['stale', 'aging', 'undated']) expect(rehuntDue('employees', { state, ageDays: 10 })).toBe(true);
  });
  it('re-hunts a current valuation once it is more than 180 days old', () => {
    expect(rehuntDue('valuation', { state: 'current', ageDays: 181 })).toBe(true);
    expect(rehuntDue('valuation', { state: 'current', ageDays: 120 })).toBe(false);
  });
  it('leaves a current slow-moving figure alone', () => {
    expect(rehuntDue('employees', { state: 'current', ageDays: 300 })).toBe(false);
    expect(rehuntDue('valuation', null)).toBe(false);
  });
});
