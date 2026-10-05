import { describe, expect, it } from 'vitest';
import { acceptedMetricPassage } from './metric-support';
import type { MetricPassageSupport } from './metric-support';
import type { OriginalSourceReceipt } from './original-source';

const quote = 'Acme Inc. reports ARR of USD 40 million as of 2026-10-01.';
const source: OriginalSourceReceipt = { requestedUrl: 'https://sec.gov/acme', finalUrl: 'https://sec.gov/acme', status: 'retrieved', httpStatus: 200, text: quote, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-03T00:00:00.000Z' };
const support: MetricPassageSupport = { sourceUrl: source.finalUrl!, quote, asOf: '2026-10-01', basis: 'arr', unit: 'USD' };
const input = { companyName: 'Acme Inc.', metricType: 'arr' as const, value: 40_000_000, support, originals: [source] };
describe('original metric passage gate', () => {
  it.each([
    'Acme Inc. partners with Beta. Beta reports ARR of USD 40 million as of 2026-10-01.',
    'Acme Inc. partners with Beta; Beta reports ARR of USD 40 million as of 2026-10-01.',
    "Acme Inc. reports Beta's ARR of USD 40 million as of 2026-10-01.",
    'Acme Inc. reports that Beta has ARR of USD 40 million as of 2026-10-01.',
    'Acme Inc. reports ARR of USD 40 million. This article was published as of 2026-10-01.',
    'Acme Inc. reports ARR of USD 40 million in an article published on 2026-10-01.',
    'Acme Inc. reports ARR of USD 40 million and valuation of USD 40 million as of 2026-10-01.',
    'Acme Inc. reports ARR of USD 40 million as of 2026-10-010.',
  ])('rejects a borrowed subject, publication date or ambiguous metric: %s', (text) => {
    expect(acceptedMetricPassage({ ...input, support: { ...support, quote: text }, originals: [{ ...source, text }] })).toEqual([]);
  });
  it('accepts a directly attributed dated figure with an abbreviated company name', () => {
    const text = 'Acme Inc. reported ARR of USD 40 million on October 1, 2026.';
    expect(acceptedMetricPassage({ ...input, support: { ...support, quote: text }, originals: [{ ...source, text }] })).toHaveLength(1);
  });
  it('accepts a literal matching reported figure from the retrieved final source', () => {
    expect(acceptedMetricPassage(input)[0]!.url).toBe(source.finalUrl);
  });
  it.each([
    { quote: quote.replace('Acme Inc.', 'Other Company') },
    { quote: quote.replace('Acme Inc.', 'NotAcme Inc.') },
    { quote: quote.replace('40 million', '400 million') },
    { quote: quote.replace('ARR', 'annual revenue') },
    { quote: quote.replace('reports', 'projects') },
    { quote: quote.replace('reports', 'does not report') },
    { quote: quote.replace('USD', 'EUR') },
    { asOf: '2026-11-01' },
    { basis: 'valuation' as const },
    { sourceUrl: 'https://sec.gov/unrelated' },
    { quote: `${quote} Previously it was USD 20 million.` },
  ])('rejects mismatched or ambiguous support: %j', (patch) => {
    const candidate = { ...support, ...patch };
    expect(acceptedMetricPassage({ ...input, support: candidate, originals: [{ ...source, text: candidate.quote }] })).toEqual([]);
  });
  it.each(['unavailable', 'blocked'] as const)('never accepts %s content or provider prose as originals', (status) => {
    expect(acceptedMetricPassage({ ...input, originals: [{ ...source, status }] })).toEqual([]);
  });
  it('rejects an invented quote not present in the saved extract', () => {
    expect(acceptedMetricPassage({ ...input, originals: [{ ...source, text: 'Just a publisher homepage.' }] })).toEqual([]);
  });
  it('does not renew current support from a years-old reported figure', () => {
    const text = quote.replace('2026-10-01', '2024-10-01');
    expect(acceptedMetricPassage({ ...input, support: { ...support, quote: text, asOf: '2024-10-01' }, originals: [{ ...source, text }] })).toEqual([]);
  });
  it('rejects claimed authority and missing support', () => {
    expect(acceptedMetricPassage({ ...input, support: null })).toEqual([]);
    const url = 'https://random.example/acme';
    expect(acceptedMetricPassage({ ...input, support: { ...support, sourceUrl: url }, originals: [{ ...source, requestedUrl: url, finalUrl: url }] })).toEqual([]);
  });
  it.each(['October 1, 2026', 'Oct 1, 2026', '1 October 2026'])('accepts a literal calendar date without rewriting the quote: %s', (date) => {
    const text = quote.replace('2026-10-01', date);
    expect(acceptedMetricPassage({ ...input, support: { ...support, quote: text }, originals: [{ ...source, text }] })).toHaveLength(1);
  });
  it.each([
    { metricType: 'employees' as const, value: 120, unit: 'count' as const, figure: 'headcount of 120 employees' },
    { metricType: 'market_share' as const, value: 12.5, unit: 'percent' as const, figure: 'market share of 12.5 percent' },
    { metricType: 'market_cap' as const, value: 2_000_000_000, unit: 'USD' as const, figure: 'market capitalization of USD 2 billion' },
    { metricType: 'arr' as const, value: 0, unit: 'USD' as const, figure: 'ARR of USD 0' },
  ])('accepts the correct units and basis for $metricType', ({ metricType, value, unit, figure }) => {
    const text = `Acme Inc. reports ${figure} as of 2026-10-01.`;
    expect(acceptedMetricPassage({ ...input, metricType, value, support: { ...support, quote: text, basis: metricType, unit }, originals: [{ ...source, text }] })).toHaveLength(1);
  });
});
