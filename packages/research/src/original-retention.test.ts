/** Retained originals: re-reads refresh, never pile up; cited pages always stay. */
import { describe, expect, it } from 'vitest';
import { ORIGINAL_ATTEMPTS_PER_SCOPE, retainOriginalAttempt, type OriginalSourceAttempt } from './original-source';

const attempt = (id: string, day: number, url = 'https://sec.gov/a', hash = 'a', metricType = 'arr'): OriginalSourceAttempt => ({
  id, companyId: 'c', metricType, capturedAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`,
  receipts: [{ requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200, text: 'x', contentHash: hash.repeat(64),
    retrievedAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z` }],
});
const never = () => false;

describe('retainOriginalAttempt', () => {
  it('replaces an identical re-read instead of storing it twice', () => {
    const kept = retainOriginalAttempt([attempt('old', 1)], attempt('new', 2), never);
    expect(kept.map((a) => a.id)).toEqual(['new']);
  });

  it('keeps reads whose content changed, of other pages, or of other scopes', () => {
    const prior = [attempt('p1', 1), attempt('p2', 1, 'https://sec.gov/b'), attempt('p3', 1, 'https://sec.gov/a', 'a', 'employees')];
    expect(retainOriginalAttempt(prior, attempt('new', 2, 'https://sec.gov/a', 'b'), never)).toHaveLength(4);
  });

  it('caps a scope at the newest attempts, but never drops a cited page', () => {
    const prior = Array.from({ length: ORIGINAL_ATTEMPTS_PER_SCOPE + 3 }, (_, i) => attempt(`p${i}`, i + 1, `https://site/${i}`));
    const kept = retainOriginalAttempt(prior, attempt('new', 28, 'https://site/new'), (a) => a.id === 'p0');
    expect(kept.filter((a) => a.metricType === 'arr')).toHaveLength(ORIGINAL_ATTEMPTS_PER_SCOPE);
    expect(kept.map((a) => a.id)).toContain('p0');
    expect(kept.map((a) => a.id)).not.toContain('p1');
    expect(kept.at(-1)!.id).toBe('new');
  });
});
