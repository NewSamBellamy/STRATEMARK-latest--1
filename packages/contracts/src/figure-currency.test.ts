import { describe, expect, it } from 'vitest';
import { figureAsOf, notAfterFromUrl, readCurrency, tabCurrency } from './figure-currency';

const NOW = new Date('2026-10-20T12:00:00Z');
const read = (over: Partial<Parameters<typeof readCurrency>[0]>) =>
  readCurrency({ metricType: 'employees', asOf: null, asOfSource: 'none', now: NOW, ...over });

describe('figureAsOf', () => {
  it('takes the figure own date in plan order and ignores capture times', () => {
    const passage = { asOf: '2026-03-31', format: 'sec-filing' } as never;
    expect(figureAsOf({ passageSupport: passage, quotedSupport: { asOf: '2025-01-01' } as never })).toEqual({ asOf: '2026-03-31', source: 'filing' });
    expect(figureAsOf({ quotedSupport: { asOf: '2025-01-01' } as never, reportedSupport: { asOf: '2024-01-01' } as never })).toEqual({ asOf: '2025-01-01', source: 'figure' });
    expect(figureAsOf({ reportedSupport: { asOf: null } as never })).toEqual({ asOf: null, source: 'none' });
    expect(figureAsOf({ reportedBand: { asOf: '2026-01-02' } as never })).toEqual({ asOf: '2026-01-02', source: 'figure' });
  });
  it('treats the 1970 placeholder and malformed dates as no date', () => {
    expect(figureAsOf({ passageSupport: { asOf: '1970-01-01' } as never }).asOf).toBeNull();
    expect(figureAsOf({ passageSupport: { asOf: '2026-02-30' } as never }).asOf).toBeNull();
  });
});

describe('readCurrency', () => {
  it('is current, aging or stale by the metric horizon (employees 12 / 18 months)', () => {
    expect(read({ asOf: '2026-01-01', asOfSource: 'figure' }).state).toBe('current');
    expect(read({ asOf: '2025-06-01', asOfSource: 'figure' }).state).toBe('aging');
    expect(read({ asOf: '2024-03-01', asOfSource: 'figure' }).state).toBe('stale');
  });
  it('keeps an undated figure undated, never fresh', () => {
    expect(read({}).state).toBe('undated');
    expect(read({}).ageDays).toBeNull();
  });
  it('lets a page date only make a figure older, never newer', () => {
    const older = read({ asOf: '2026-09-01', asOfSource: 'figure', notAfter: '2024-01-01', notAfterSource: 'page' });
    expect(older.asOf).toBe('2024-01-01');
    expect(older.state).toBe('stale');
    expect(older.issues).toContain('figure_date_after_page_date');
    // a fresh page date does not freshen an old figure
    expect(read({ asOf: '2024-03-01', asOfSource: 'figure', notAfter: '2026-10-01', notAfterSource: 'page' }).state).toBe('stale');
    // an undated figure on a fresh page stays undated
    expect(read({ notAfter: '2026-10-01', notAfterSource: 'page' }).state).toBe('undated');
    // an undated figure on a years-old page is at least that old
    const old = read({ notAfter: '2023-01-01', notAfterSource: 'url' });
    expect(old.state).toBe('stale');
    expect(old.asOf).toBeNull();
  });
  it('does not accept a future-dated figure as a date', () => {
    const future = read({ asOf: '2027-01-01', asOfSource: 'figure' });
    expect(future.state).toBe('undated');
    expect(future.issues).toContain('date_in_future');
  });
  it('is deterministic for a fixed now and handles the day boundary', () => {
    const a = read({ metricType: 'market_cap', asOf: '2026-10-13', asOfSource: 'figure' });
    expect(a).toEqual(read({ metricType: 'market_cap', asOf: '2026-10-13', asOfSource: 'figure' }));
    expect(a.ageDays).toBe(7);
    expect(a.state).toBe('current');
    expect(read({ metricType: 'market_cap', asOf: '2026-10-12', asOfSource: 'figure' }).state).toBe('aging');
  });
});

describe('notAfterFromUrl', () => {
  it('reads /YYYY/MM/DD/ and /YYYY/MM/ (last day of the month)', () => {
    expect(notAfterFromUrl('https://x.com/2026/03/05/story')).toBe('2026-03-05');
    expect(notAfterFromUrl('https://x.com/2026/02/story')).toBe('2026-02-28');
    expect(notAfterFromUrl('https://x.com/2026/13/story')).toBeNull();
    expect(notAfterFromUrl('https://x.com/story')).toBeNull();
  });
});

describe('tabCurrency', () => {
  it('uses the tab horizon from the research date', () => {
    expect(tabCurrency('overview', '2026-10-01T00:00:00Z', NOW).state).toBe('current');
    expect(tabCurrency('overview', '2026-06-01T00:00:00Z', NOW).state).toBe('stale');
    expect(tabCurrency('history', '2025-10-01T00:00:00Z', NOW).state).toBe('current');
    expect(tabCurrency('team_org', null, NOW).state).toBe('undated');
  });
});
