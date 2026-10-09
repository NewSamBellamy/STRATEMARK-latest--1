import { describe, expect, it } from 'vitest';
import { acceptedMetricPassage, currencyConversionNote, inspectMetricPassage, normalizeMetricToUsd } from './metric-support';
import type { MetricPassageSupport } from './metric-support';
import type { OriginalSourceReceipt } from './original-source';

const quote = 'Acme Inc. reports ARR of USD 40 million as of 2026-10-01.';
const source: OriginalSourceReceipt = { requestedUrl: 'https://sec.gov/acme', finalUrl: 'https://sec.gov/acme', status: 'retrieved', httpStatus: 200, text: quote, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-03T00:00:00.000Z' };
const support: MetricPassageSupport = { sourceUrl: source.finalUrl!, quote, asOf: '2026-10-01', basis: 'arr', unit: 'USD' };
const input = { companyName: 'Acme Inc.', metricType: 'arr' as const, value: 40_000_000, support, originals: [source] };
describe('original metric passage gate', () => {
  it('accepts a normal fiscal-year disclosure without requiring invented ISO prose', () => {
    const text = 'Acme Inc. reported annual revenue of USD 40 million for the fiscal year ended September 30, 2026.';
    const candidate = { ...input, support: { ...support, quote: text, asOf: '2026-09-30',
      definition: 'annual_revenue' as const, periodStart: '2025-10-01' }, originals: [{ ...source, text }] };
    expect(acceptedMetricPassage(candidate)).toHaveLength(1);
    expect(acceptedMetricPassage({ ...candidate, support: { ...candidate.support, periodStart: '2025-09-01' } })).toEqual([]);
    expect(acceptedMetricPassage({ ...candidate, support: { ...candidate.support, asOf: '2026-09-29' } })).toEqual([]);
    expect(acceptedMetricPassage({ ...candidate, support: { ...candidate.support, definition: 'arr' } })).toEqual([]);
  });
  it('accepts the explicit brand subject on its own issuer website, not an inferred alias on third-party pages', () => {
    const text = 'Acme reported 120 customers as of October 1, 2026.';
    const url = 'https://acme.com/reports/customers';
    const candidate = { ...input, officialWebsite: 'https://acme.com', metricType: 'users' as const, value: 120,
      support: { ...support, sourceUrl: url, quote: text, basis: 'users' as const, unit: 'count' as const, definition: 'customers' as const },
      originals: [{ ...source, requestedUrl: url, finalUrl: url, text }] };
    expect(acceptedMetricPassage(candidate)).toHaveLength(1);
    expect(acceptedMetricPassage({ ...candidate, officialWebsite: 'https://other.com' })).toEqual([]);
    expect(acceptedMetricPassage({ ...candidate, companyName: 'Acme Holdings Inc.' })).toEqual([]);
  });
  it('accepts an explicit legal suffix abbreviation without borrowing a trade name or another entity', () => {
    const text = 'Acme Corp. reported 45 employees as of 2026-10-01.';
    const candidate = { ...input, companyName: 'Acme Corporation', metricType: 'employees' as const, value: 45,
      support: { ...support, basis: 'employees' as const, unit: 'count' as const, quote: text }, originals: [{ ...source, text }] };
    expect(acceptedMetricPassage(candidate)).toHaveLength(1);
    for (const name of ['Acme Holdings Corporation', 'Acme Incorporated', 'Acme']) {
      expect(acceptedMetricPassage({ ...candidate, companyName: name })).toEqual([]);
    }
  });
  it.each([
    ['monthly_active_users', 'monthly active users'],
    ['daily_active_users', 'daily active users'],
    ['customers', 'customers'],
    ['paying_customers', 'paying customers'],
  ] as const)('accepts an explicitly defined %s population but not a relabelled one', (definition, population) => {
    const text = `Acme Inc. reports 120 ${population} as of 2026-10-01.`;
    const candidate = { ...input, metricType: 'users' as const, value: 120,
      support: { ...support, basis: 'users' as const, unit: 'count' as const, quote: text, definition }, originals: [{ ...source, text }] };
    expect(acceptedMetricPassage(candidate)).toHaveLength(1);
    expect(acceptedMetricPassage({ ...candidate, support: { ...candidate.support, definition: 'users' } })).toEqual([]);
    const { definition: _definition, ...untyped } = candidate.support;
    expect(acceptedMetricPassage({ ...candidate, support: untyped })).toEqual([]);
  });
  it('accepts annual revenue only with an explicit matching reporting interval, never as ARR', () => {
    const text = 'Acme Inc. reports annual revenue of USD 40 million for the period 2025-10-01 to 2026-09-30.';
    const candidate = { ...input, support: { ...support, quote: text, asOf: '2026-09-30',
      definition: 'annual_revenue' as const, periodStart: '2025-10-01' }, originals: [{ ...source, text }] };
    expect(acceptedMetricPassage(candidate)).toHaveLength(1);
    expect(acceptedMetricPassage({ ...candidate, support: { ...candidate.support, definition: 'arr' } })).toEqual([]);
    expect(acceptedMetricPassage({ ...candidate, support: { ...candidate.support, periodStart: '2025-09-01' } })).toEqual([]);
    expect(acceptedMetricPassage({ ...candidate, support: { ...candidate.support, periodStart: undefined } })).toEqual([]);
    expect(acceptedMetricPassage({ ...candidate, support: { ...candidate.support, asOf: '2026-02-30' } })).toEqual([]);
  });
  it('does not accept an annualized monthly figure, ambiguous populations or a division as a whole-company observation', () => {
    for (const text of [
      'Acme Inc. reports 120 monthly and daily active users as of 2026-10-01.',
      'Acme Inc. reports 120 monthly active users for its research division as of 2026-10-01.',
      'Acme Inc. reports 120 monthly active users and customers as of 2026-10-01.',
    ]) expect(acceptedMetricPassage({ ...input, metricType: 'users', value: 120, support: { ...support,
      basis: 'users', unit: 'count', quote: text, definition: 'monthly_active_users' }, originals: [{ ...source, text }] })).toEqual([]);
  });
  it.each(['monthly users', 'daily users', 'paying users', 'new users', 'registered users', 'users and downloads'])('does not disguise %s as generic users', population => {
    const text = `Acme Inc. reports 120 ${population} as of 2026-10-01.`;
    expect(acceptedMetricPassage({ ...input, metricType: 'users', value: 120, support: { ...support,
      basis: 'users', unit: 'count', quote: text, definition: 'users' }, originals: [{ ...source, text }] })).toEqual([]);
  });
  it('keeps diagnostic acceptance identical to the existing gate', () => {
    const candidates = [input, { ...input, support: null }, { ...input, originals: [] },
      { ...input, originals: [{ ...source, text: 'Different passage' }] },
      { ...input, support: { ...support, unit: 'count' as const } },
      { ...input, support: { ...support, quote: quote.replace('40 million', '80 million') } },
      { ...input, support: { ...support, quote: quote.replace('reports', 'projects') } },
      { ...input, support: { ...support, asOf: '2026-02-30' } },
      { ...input, originals: [{ ...source, contentHash: 'invalid' }] }];
    for (const candidate of candidates) {
      const fixed = { ...candidate, nowMs: Date.parse('2026-10-05T00:00:00.000Z') };
      const result = inspectMetricPassage(fixed);
      expect(result.citations).toEqual(acceptedMetricPassage(fixed));
      expect(result.reason === null).toBe(result.citations.length > 0);
    }
  });
  it('does not disclose raw source errors or present an unavailable page as a public-data absence', () => {
    const result = inspectMetricPassage({ ...input, nowMs: Date.parse('2026-10-05T00:00:00.000Z'), originals: [
      { requestedUrl: source.requestedUrl, status: 'blocked', retrievedAt: source.retrievedAt, reason: 'private-network-detail' },
    ] });
    expect(result.reason).toContain('Original source could not be read');
    expect(result.reason).not.toContain('private-network-detail');
    expect(result.citations).toEqual([]);
  });
  it.each(['2026-09-30T00:00:00.000Z', '2028-01-01T00:00:00.000Z'])('does not treat future or aged reporting periods as current: %s', now => {
    expect(acceptedMetricPassage({ ...input, nowMs: Date.parse(now) })).toEqual([]);
  });
  it('accepts scoped issuer reporting only with a matching original passage', () => {
    const url = 'https://acme.com/report';
    const issuerInput = { ...input, officialWebsite: 'https://acme.com', support: { ...support, sourceUrl: url },
      originals: [{ ...source, requestedUrl: url, finalUrl: url }] };
    expect(acceptedMetricPassage(issuerInput)).toHaveLength(1);
    expect(acceptedMetricPassage(issuerInput)[0]!.title).toContain('not independently corroborated');
    expect(acceptedMetricPassage({ ...issuerInput, officialWebsite: 'https://other.com' })).toEqual([]);
    expect(acceptedMetricPassage({ ...issuerInput, originals: [{ ...issuerInput.originals[0]!, text: 'Unrelated narrative' }] })).toEqual([]);
  });
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
  it('accepts the common press reporting verbs as direct company statements', () => {
    for (const [text, metricType] of [
      ['Acme Inc. posted ARR of USD 40 million as of 2026-10-01.', 'arr'],
      ['Acme Inc. reached a valuation of USD 40 million as of 2026-10-01.', 'valuation'],
      ['Acme Inc. generated ARR of USD 40 million as of 2026-10-01.', 'arr'],
    ] as const) {
      const text2 = text as string;
      expect(acceptedMetricPassage({ ...input, metricType, value: 40_000_000,
        support: { ...support, quote: text2, basis: metricType }, originals: [{ ...source, text: text2 }] })).toHaveLength(1);
    }
    // 'said its' is the company speaking about itself — direct attribution.
    const said = 'Acme Inc. said its ARR was USD 40 million as of 2026-10-01.';
    expect(acceptedMetricPassage({ ...input, support: { ...support, quote: said }, originals: [{ ...source, text: said }] })).toHaveLength(1);
    // A possessive another entity still smuggles a borrowed figure in.
    const borrowed = 'Acme Inc. posted a valuation of USD 40 million for its partner Beta’s business as of 2026-10-01.';
    expect(acceptedMetricPassage({ ...input, support: { ...support, quote: borrowed }, originals: [{ ...source, text: borrowed }] })).toEqual([]);
  });
  it.each([
    'Acme Inc. reports 45 employees as at 2026-10-01.',
    'Acme Inc. reported 45 employees for the quarter ended June 30, 2026.',
    'Acme Inc. reported 45 employees for the period ending September 30, 2026.',
  ])('accepts quarter-end and as-at date phrasings: %s', (text) => {
    const asOf = text.includes('June 30, 2026') ? '2026-06-30' : text.includes('September 30, 2026') ? '2026-09-30' : '2026-10-01';
    expect(acceptedMetricPassage({ ...input, metricType: 'employees', value: 45,
      support: { ...support, quote: text, asOf, basis: 'employees' as const, unit: 'count' as const },
      originals: [{ ...source, text }] })).toHaveLength(1);
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
  it('accepts a natively quoted CNY figure when the quote names the currency', () => {
    const text = 'Acme Inc. reports ARR of CNY 40 million as of 2026-10-01.';
    const yuanText = 'Acme Inc. reports ARR of 40 million yuan as of 2026-10-01.';
    const candidate = { ...input, value: 40_000_000,
      support: { ...support, quote: text, unit: 'CNY' as const }, originals: [{ ...source, text }] };
    expect(acceptedMetricPassage(candidate)).toHaveLength(1);
    expect(acceptedMetricPassage({ ...candidate, support: { ...candidate.support, quote: yuanText },
      originals: [{ ...source, text: yuanText }] })).toHaveLength(1);
  });
  it.each([
    { unit: 'JPY' as const, figure: '¥6 billion', value: 6_000_000_000 },
    { unit: 'EUR' as const, figure: '€12.5 billion', value: 12_500_000_000 },
    { unit: 'GBP' as const, figure: '£3.4 billion', value: 3_400_000_000 },
  ])('accepts a natively quoted $unit figure', ({ unit, figure, value }) => {
    const text = `Acme Inc. reports a valuation of ${figure} as of 2026-10-01.`;
    expect(acceptedMetricPassage({ ...input, metricType: 'valuation', value,
      support: { ...support, quote: text, basis: 'valuation' as const, unit }, originals: [{ ...source, text }] })).toHaveLength(1);
  });
  it('rejects a native unit the quote does not name, and a currency outside the reference table', () => {
    const text = 'Acme Inc. reports ARR of 40 million as of 2026-10-01.';
    expect(acceptedMetricPassage({ ...input, value: 40_000_000,
      support: { ...support, quote: text, unit: 'CNY' as const }, originals: [{ ...source, text }] })).toEqual([]);
    expect(acceptedMetricPassage({ ...input,
      support: { ...support, quote: quote.replace('USD', 'EUR'), unit: 'USD' as const }, originals: [{ ...source, text: quote.replace('USD', 'EUR') }] })).toEqual([]);
    expect(acceptedMetricPassage({ ...input, value: 40_000_000,
      support: { ...support, quote: 'Acme Inc. reports ARR of RUB 40 million as of 2026-10-01.', unit: 'RUB' as unknown as MetricPassageSupport['unit'] },
      originals: [{ ...source, text: 'Acme Inc. reports ARR of RUB 40 million as of 2026-10-01.' }] })).toEqual([]);
  });
  it('stores a natively quoted figure converted to USD with an honest note', () => {
    expect(normalizeMetricToUsd('arr', 40_000_000, 'CNY')).toBeCloseTo(40_000_000 * 0.148915, 6);
    expect(normalizeMetricToUsd('arr', 40_000_000, 'USD')).toBe(40_000_000);
    expect(normalizeMetricToUsd('employees', 120, 'count')).toBe(120);
    expect(normalizeMetricToUsd('market_share', 12.5, 'percent')).toBe(12.5);
    expect(normalizeMetricToUsd('arr', null, 'CNY')).toBeNull();
    expect(normalizeMetricToUsd('arr', 40_000_000, null)).toBe(40_000_000);
    expect(normalizeMetricToUsd('arr', 40_000_000, 'RUB')).toBe(40_000_000);
    const note = currencyConversionNote(40_000_000, 'CNY');
    expect(note).toContain('CNY');
    expect(note).toContain('approximate');
    expect(currencyConversionNote(40_000_000, 'USD')).toBe('');
    expect(currencyConversionNote(null, 'CNY')).toBe('');
  });
});
