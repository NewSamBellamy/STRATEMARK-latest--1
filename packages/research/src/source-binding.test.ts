/** Source binding: a reported figure links to the page that states it, or is not shown. */
import { describe, expect, it } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { applySourceChecks, brandTokens, checkFromReceipt, figureOnPage, sourceCheckKey, uncheckedSources, UNREAD_RETRY_MS } from './source-binding';
import type { OriginalSourceReceipt } from './original-source';

const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc';
const reported = (value: number, extra: Partial<CompanyMetric> = {}): CompanyMetric => ({
  id: 'm', companyId: 'c', metricType: 'valuation', value, confidence: 'estimated', source: REDIRECT,
  citations: [{ url: REDIRECT, title: 'techcrunch.com' }], methodNote: 'Source reported valuation', capturedAt: '2026-10-01T00:00:00.000Z',
  reportedSupport: { provider: 'google-search', companyName: 'Anthropic', basis: 'valuation', value, unit: 'USD', definition: 'valuation',
    asOf: '2026-05-28', support: { supportIndex: 0, text: `Anthropic is valued at $${value / 1e9} billion.`, sources: [{ chunkIndex: 0, url: REDIRECT, title: 'techcrunch.com' }] } },
  ...extra,
} as CompanyMetric);
const receipt = (text: string, finalUrl = 'https://techcrunch.com/2026/05/28/anthropic'): OriginalSourceReceipt => ({
  requestedUrl: REDIRECT, finalUrl, status: 'retrieved', httpStatus: 200, text, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-12T00:00:00.000Z',
});

describe('figureOnPage', () => {
  it('needs the company and the figure, allowing for display rounding', () => {
    expect(figureOnPage('Anthropic', [965e9], 'Anthropic raised funds at a $965 billion valuation.')).toBe(true);
    expect(figureOnPage('Anthropic', [4.62e9], 'Anthropic run-rate revenue hit $4.6 billion.')).toBe(true);
    expect(figureOnPage('Anthropic', [965e9], 'OpenAI is valued at $965 billion.')).toBe(false);
    expect(figureOnPage('Anthropic', [965e9], 'Anthropic is valued at $61.5 billion.')).toBe(false);
    expect(figureOnPage('Acme', [51, 100], 'Acme has 51-100 employees.')).toBe(true);
    expect(figureOnPage('Acme', [51, 100], 'Acme has 51 employees.')).toBe(false);
    expect(figureOnPage('Acme', [2025], 'Acme was founded in 2025.')).toBe(false);
    expect(figureOnPage('Acme', [2025], 'Acme has 2,025 employees.')).toBe(true);
    expect(figureOnPage('Safe Superintelligence (SSI)', [32e9], 'A classic $32 billion deal.')).toBe(false);
  });

  it('recognises the names pages use for a company', () => {
    expect(brandTokens('Moonshot AI')).toContain('moonshot');
    expect(brandTokens('Safe Superintelligence (SSI)')).toEqual(expect.arrayContaining(['safe superintelligence', 'ssi']));
    expect(brandTokens('Safe Superintelligence (SSI)')).not.toContain('safe');
    expect(brandTokens("Lyre's Spirit Co.")).toContain("lyre's");
  });
});

describe('applySourceChecks', () => {
  const key = sourceCheckKey('c', 'valuation', [965e9], REDIRECT);

  it('links a figure stated on its page to the real publisher URL', () => {
    const checks = { [key]: checkFromReceipt('Anthropic', [965e9], receipt('Anthropic is valued at $965 billion.')) };
    const [row] = applySourceChecks('c', [reported(965e9)], checks);
    expect(row).toMatchObject({ value: 965e9, confidence: 'estimated', source: 'https://techcrunch.com/2026/05/28/anthropic' });
    expect(row!.citations).toEqual([{ url: 'https://techcrunch.com/2026/05/28/anthropic', title: 'techcrunch.com' }]);
  });

  it('hides a figure whose cited page was read and does not state it', () => {
    const checks = { [key]: checkFromReceipt('Anthropic', [965e9], receipt('Anthropic released a new model.')) };
    const [row] = applySourceChecks('c', [reported(965e9)], checks);
    expect(row).toMatchObject({ value: null, confidence: 'unknown', citations: [] });
  });

  it('keeps a figure as it was when its page could not be read or was never checked', () => {
    const blocked = { [key]: checkFromReceipt('Anthropic', [965e9], { requestedUrl: REDIRECT, status: 'blocked', retrievedAt: '2026-10-12T00:00:00.000Z' }) };
    expect(applySourceChecks('c', [reported(965e9)], blocked)[0]).toMatchObject({ value: 965e9, source: REDIRECT });
    expect(applySourceChecks('c', [reported(965e9)], {})[0]).toMatchObject({ value: 965e9, source: REDIRECT });
  });

  it('never touches verified, human or unsourced rows', () => {
    const verified = { ...reported(1), confidence: 'verified' as const };
    const human = { ...reported(2), confidence: 'user_verified' as const };
    expect(applySourceChecks('c', [verified, human], { [key]: { finalUrl: null, found: false, read: true, checkedAt: '' } })).toEqual([verified, human]);
  });

  it('lists each unchecked source once and retries an unreadable page only after a while', () => {
    const now = Date.parse('2026-10-12T12:00:00Z');
    expect(uncheckedSources('c', [reported(965e9), reported(965e9)], {}, 6, now)).toHaveLength(1);
    const recent = { [key]: { finalUrl: null, found: false, read: false, checkedAt: new Date(now - 60_000).toISOString() } };
    expect(uncheckedSources('c', [reported(965e9)], recent, 6, now)).toEqual([]);
    const stale = { [key]: { ...recent[key]!, checkedAt: new Date(now - UNREAD_RETRY_MS - 1).toISOString() } };
    expect(uncheckedSources('c', [reported(965e9)], stale, 6, now)).toHaveLength(1);
  });
});
