/** A receipt's publishedAt is an upper bound only: validated, and kept through retention and reuse. */
import { describe, expect, it } from 'vitest';
import { coalesceOriginalSources, isOriginalSourceAttempt, retainOriginalAttempt, type OriginalSourceAttempt, type OriginalSourceReceipt } from './original-source';

const receipt = (publishedAt?: string): OriginalSourceReceipt => ({
  requestedUrl: 'https://a.com/p', finalUrl: 'https://a.com/p', status: 'retrieved', httpStatus: 200, text: 'x',
  contentHash: 'a'.repeat(64), retrievedAt: '2026-10-03T10:00:00.000Z', ...(publishedAt ? { publishedAt } : {}),
});
const attempt = (r: OriginalSourceReceipt): OriginalSourceAttempt => ({ id: 'i', companyId: 'c', metricType: 'arr', capturedAt: '2026-10-03T10:00:00.000Z', receipts: [r] });

describe('receipt publishedAt', () => {
  it('accepts a valid date up to the retrieval date and legacy receipts without one', () => {
    expect(isOriginalSourceAttempt(attempt(receipt('2026-10-03')))).toBe(true);
    expect(isOriginalSourceAttempt(attempt(receipt('2020-01-31')))).toBe(true);
    expect(isOriginalSourceAttempt(attempt(receipt()))).toBe(true);
  });
  it('rejects malformed or later-than-retrieval dates', () => {
    for (const bad of ['2026-10-04', '2026-13-01', 'yesterday', '2026-10-03T00:00:00Z']) expect(isOriginalSourceAttempt(attempt(receipt(bad)))).toBe(false);
    expect(isOriginalSourceAttempt(attempt({ ...receipt(), publishedAt: 5 as unknown as string }))).toBe(false);
  });
  it('is kept by retention and by coalescing', async () => {
    const kept = retainOriginalAttempt([], attempt(receipt('2025-05-05')), () => false);
    expect(kept[0]!.receipts[0]!.publishedAt).toBe('2025-05-05');
    const read = coalesceOriginalSources(async () => receipt('2025-05-05'));
    expect((await read('https://a.com/p')).publishedAt).toBe('2025-05-05');
    expect((await read('https://a.com/p')).publishedAt).toBe('2025-05-05');
  });
});
