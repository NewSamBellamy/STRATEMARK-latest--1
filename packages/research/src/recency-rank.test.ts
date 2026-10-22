/**
 * Newest credible report first (owner audit 2026-10-22). Ordering only: no value is created.
 */
import { describe, expect, it } from 'vitest';
import {
  RECENCY_OVERRIDE_DAYS, beats, orderFiguresNewestFirst, rankNewestCredible, rehuntDue, sourceCandidate, usableDate,
  type RecencyCandidate,
} from './recency-rank';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const c = (asOf: string | null, credibility: number, primary = false, fastMoving = true, newsroom = true): RecencyCandidate =>
  ({ asOf, credibility, primary, fastMoving, newsroom });
const wins = (a: RecencyCandidate, b: RecencyCandidate) => beats(a, b, NOW);

describe('beats', () => {
  it('a newer dated figure beats an older dated one at equal credibility', () => {
    expect(wins(c('2026-09-30', 2), c('2025-10-01', 2))).toBe(true);
    expect(wins(c('2025-10-01', 2), c('2026-09-30', 2))).toBe(false);
  });

  it('an undated figure loses to a dated one of at least equal credibility', () => {
    expect(wins(c(null, 2, true), c('2024-01-01', 2))).toBe(false);
    expect(wins(c('2024-01-01', 2), c(null, 2, true))).toBe(true);
    expect(wins(c('not a date', 2), c('2024-01-01', 2))).toBe(false);
  });

  it('a dated weak page (Wikipedia) does not beat an undated primary source', () => {
    const wikipedia = sourceCandidate('valuation', 'https://en.wikipedia.org/wiki/OpenAI', '2026-09-01', 'https://openai.com');
    const companyPage = sourceCandidate('valuation', 'https://openai.com/news', null, 'https://openai.com');
    expect(wins(wikipedia, companyPage)).toBe(false);
    expect(wins(companyPage, wikipedia)).toBe(true);
  });

  it(`a newsroom report beats an older primary one only past ${RECENCY_OVERRIDE_DAYS} days`, () => {
    const companyPage = c('2026-06-01', 2, true);
    expect(wins(c('2026-07-15', 2), companyPage)).toBe(false); // 44 days: the company's own figure stands
    expect(wins(c('2026-08-30', 2), companyPage)).toBe(false); // exactly 90 days: still inside the window
    expect(wins(c('2026-08-31', 2), companyPage)).toBe(true); // 91 days: the newer report wins
  });

  it('for a fast-moving figure, a newsroom report beats a stronger older one only past the window', () => {
    const regulator = c('2026-01-01', 3, true);
    expect(wins(c('2026-03-01', 2), regulator)).toBe(false);
    expect(wins(c('2026-09-01', 2), regulator)).toBe(true);
  });

  it('an aggregator never overrides on date: Crunchbase does not beat an SEC Form D on total raised', () => {
    const formD = sourceCandidate('funding_total', 'https://www.sec.gov/Archives/edgar/data/1/formd.xml', '2025-01-15', 'https://acme.com');
    const crunchbase = sourceCandidate('funding_total', 'https://www.crunchbase.com/organization/acme', '2026-09-01', 'https://acme.com');
    const reuters = sourceCandidate('funding_total', 'https://www.reuters.com/acme-raises', '2026-09-01', 'https://acme.com');
    expect(wins(crunchbase, formD)).toBe(false);
    expect(wins(formD, crunchbase)).toBe(true);
    expect(wins(reuters, formD)).toBe(true);
    // Nor past an older company page on equal footing.
    const companyPage = sourceCandidate('funding_total', 'https://acme.com/news', '2025-01-15', 'https://acme.com');
    expect(wins(crunchbase, companyPage)).toBe(false);
  });

  it('for other figures (a filed revenue) the stronger older source stays', () => {
    expect(wins(c('2026-09-01', 2, false, false), c('2024-01-01', 3, true, false))).toBe(false);
  });

  it('a weak site never wins on date alone', () => {
    expect(wins(c('2026-10-01', 1), c('2025-01-01', 2))).toBe(false);
  });

  it('same date: the more credible, then the primary one', () => {
    expect(wins(c('2026-05-01', 3), c('2026-05-01', 2))).toBe(true);
    expect(wins(c('2026-05-01', 2, true), c('2026-05-01', 2))).toBe(true);
  });

  it('a date after today is read as undated, with one day of tolerance', () => {
    expect(usableDate('2027-03-01', NOW)).toBeNull();
    expect(usableDate('2026-10-21', NOW)).toBe('2026-10-21');
    expect(usableDate('2026-10-23', NOW)).toBeNull();
    expect(wins(c('2027-03-01', 2), c('2025-01-01', 2))).toBe(false);
    expect(wins(c('2025-01-01', 2), c('2027-03-01', 2))).toBe(true);
  });
});

describe('sourceCandidate', () => {
  it('reads credibility, primacy and newsroom from the publisher registry', () => {
    expect(sourceCandidate('valuation', 'https://www.reuters.com/x', '2026-09-01', 'https://openai.com')).toMatchObject({ credibility: 2, primary: false, newsroom: true });
    expect(sourceCandidate('valuation', 'https://openai.com/news', '2026-09-01', 'https://openai.com')).toMatchObject({ credibility: 2, primary: true, newsroom: false });
    expect(sourceCandidate('valuation', 'https://tracxn.com/x', '2026-09-01')).toMatchObject({ credibility: 1, newsroom: false });
    expect(sourceCandidate('funding_total', 'https://www.crunchbase.com/x', '2026-09-01')).toMatchObject({ credibility: 2, newsroom: false });
    expect(sourceCandidate('valuation', 'https://en.wikipedia.org/wiki/OpenAI', '2026-09-01')).toMatchObject({ credibility: 1, newsroom: false });
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
      { metricType: 'valuation' as const, id: 'future', passageSupport: { sourceUrl: 'https://www.reuters.com/f', asOf: '2027-06-30' } },
    ];
    expect(orderFiguresNewestFirst(figs, 'https://x.com', NOW).map((f) => f.id))
      .toEqual(['emp', 'new-reuters', 'old-reuters', 'undated', 'future', 'old-wiki']);
  });

  it('is stable for equal candidates', () => {
    expect(rankNewestCredible(['a', 'b', 'c'], () => c('2026-01-01', 2), NOW)).toEqual(['a', 'b', 'c']);
  });
});

describe('rehuntDue', () => {
  it('re-hunts stale, aging and undated fast-moving figures', () => {
    for (const state of ['stale', 'aging', 'undated']) expect(rehuntDue('valuation', { state, ageDays: 10 })).toBe(true);
  });
  it('re-hunts a current valuation once it is more than 180 days old', () => {
    expect(rehuntDue('valuation', { state: 'current', ageDays: 181 })).toBe(true);
    expect(rehuntDue('valuation', { state: 'current', ageDays: 120 })).toBe(false);
  });
  it('never re-hunts a slow-moving figure, however stale or undated', () => {
    for (const state of ['stale', 'aging', 'undated', 'current']) expect(rehuntDue('employees', { state, ageDays: 900 })).toBe(false);
    expect(rehuntDue('revenue', { state: 'stale', ageDays: 900 })).toBe(false);
    expect(rehuntDue('valuation', null)).toBe(false);
  });
});
