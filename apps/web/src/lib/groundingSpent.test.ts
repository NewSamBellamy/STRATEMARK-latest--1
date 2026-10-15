import { beforeEach, describe, expect, it } from 'vitest';
import { getGroundingSpent, markGroundingSpent, nextPacificMidnight } from './usage';

const iso = (ms: number) => new Date(ms).toISOString();

describe('nextPacificMidnight', () => {
  it('is 07:00 UTC in summer (PDT, UTC-7) and 08:00 UTC in winter (PST, UTC-8)', () => {
    expect(iso(nextPacificMidnight(Date.parse('2026-10-15T04:46:00Z')))).toBe('2026-10-15T07:00:00.000Z'); // PDT
    expect(iso(nextPacificMidnight(Date.parse('2026-12-15T12:00:00Z')))).toBe('2026-12-16T08:00:00.000Z'); // PST
  });
  it('is always strictly after the moment asked about, even exactly at midnight Pacific', () => {
    expect(iso(nextPacificMidnight(Date.parse('2026-10-15T07:00:00Z')))).toBe('2026-10-16T07:00:00.000Z');
    expect(iso(nextPacificMidnight(Date.parse('2026-10-15T06:59:59Z')))).toBe('2026-10-15T07:00:00.000Z');
  });
  it('crosses the daylight-saving change without losing the hour', () => {
    // PDT ends 2026-11-01 02:00 local: the midnight after Oct 31 evening is 07:00 UTC; the next is 08:00 UTC.
    expect(iso(nextPacificMidnight(Date.parse('2026-11-01T12:00:00Z')))).toBe('2026-11-02T08:00:00.000Z');
    expect(iso(nextPacificMidnight(Date.parse('2026-10-31T20:00:00Z')))).toBe('2026-11-01T07:00:00.000Z');
  });
});

describe('grounding spent state', () => {
  beforeEach(() => localStorage.clear());
  const at = Date.parse('2026-10-15T04:46:00Z');

  it('is clear until research reports the quota spent', () => {
    expect(getGroundingSpent(at)).toBeNull();
  });
  it('stands until the next midnight Pacific, then clears by itself', () => {
    markGroundingSpent(at);
    expect(getGroundingSpent(at + 3_600_000)).toEqual({ at, resetsAt: Date.parse('2026-10-15T07:00:00Z') });
    expect(getGroundingSpent(Date.parse('2026-10-15T07:00:00Z'))).toBeNull();
  });
  it('writes at most once a minute however many fallbacks fire', () => {
    markGroundingSpent(at);
    markGroundingSpent(at + 30_000);
    expect(getGroundingSpent(at + 30_000)?.at).toBe(at);
    markGroundingSpent(at + 61_000);
    expect(getGroundingSpent(at + 61_000)?.at).toBe(at + 61_000);
  });
  it('ignores a damaged stored value', () => {
    localStorage.setItem('mi.groundingSpent.v1', '{"at":"soon"}');
    expect(getGroundingSpent(at)).toBeNull();
    localStorage.setItem('mi.groundingSpent.v1', 'not json');
    expect(getGroundingSpent(at)).toBeNull();
  });
});
