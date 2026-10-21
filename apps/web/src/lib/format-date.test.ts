import { describe, expect, it } from 'vitest';
import { formatDate, formatDateLong, formatDue, formatMonthYear, formatRelative } from './format';

describe('shared date formatter', () => {
  it('uses one absolute format, fixed regardless of locale', () => {
    expect(formatDate('2026-07-30T10:00:00Z')).toBe('30 Jul 2026');
    expect(formatDate('2026-09-05')).toBe('5 Sep 2026');
    expect(formatMonthYear(Date.UTC(2026, 2, 1))).toBe('Mar 2026');
    expect(formatDateLong('2026-07-30T10:00:00Z', { weekday: true })).toBe('Thursday 30 July 2026');
    expect(formatDateLong('2026-07-30T10:00:00Z')).toBe('30 July 2026');
  });
  it('never invents a date for missing or invalid input', () => {
    expect(formatDate(null)).toBe('unknown');
    expect(formatDate('not a date')).toBe('unknown');
    expect(formatDate(undefined, '')).toBe('');
  });
  it('relative ages fall back to the same absolute format', () => {
    const now = Date.parse('2026-10-21T00:00:00Z');
    expect(formatRelative('2026-07-30T10:00:00Z', now)).toBe('30 Jul 2026');
    expect(formatRelative('2026-10-20T00:00:00Z', now)).toBe('1d ago');
  });
  it('a refresh time that has passed reads Due now, not a past date', () => {
    const now = Date.parse('2026-10-21T00:00:00Z');
    expect(formatDue(Date.parse('2026-08-06T00:00:00Z'), now)).toBe('Due now');
    expect(formatDue(Date.parse('2026-10-22T00:00:00Z'), now)).toMatch(/^22 Oct 2026, \d{2}:\d{2}$/);
  });
});
