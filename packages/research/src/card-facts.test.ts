import { describe, expect, it } from 'vitest';
import type { MetricType, ReportedMetricSupport } from '@mi/contracts';
import { acceptedMetricPassage } from './metric-support';
import type { MetricPassageSupport } from './metric-support';
import type { OriginalSourceReceipt } from './original-source';
import { reportedMetricCitations } from './reported-metrics';

// Card-fact types (revenue, funding_total, last_round, distribution) and the
// "employs" basis word: each needs the SAME conditions as the existing types —
// company named, one number, basis words, a literal date — in one direct sentence.

const SOURCE = 'https://www.reuters.com/business/acme-2026';
const receipt = (text: string): OriginalSourceReceipt => ({ requestedUrl: SOURCE, finalUrl: SOURCE, status: 'retrieved',
  httpStatus: 200, text, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-03T00:00:00.000Z' });

type Case = { type: MetricType; value: number; unit: 'USD' | 'count'; asOf: string; periodStart?: string; ok: string; undated: string };
const cases: Case[] = [
  { type: 'employees', value: 900, unit: 'count', asOf: '2026-10-01',
    ok: 'Acme Inc. employs 900 people as of 2026-10-01.', undated: 'Acme Inc. employs 900 people.' },
  { type: 'revenue', value: 40_000_000, unit: 'USD', asOf: '2026-09-30', periodStart: '2025-10-01',
    ok: 'Acme Inc. reported revenue of USD 40 million for the fiscal year ended September 30, 2026.',
    undated: 'Acme Inc. reported revenue of USD 40 million.' },
  { type: 'funding_total', value: 53_000_000, unit: 'USD', asOf: '2026-10-01',
    ok: 'Acme Inc. has raised a total of USD 53 million as of 2026-10-01.', undated: 'Acme Inc. has raised a total of USD 53 million.' },
  { type: 'last_round', value: 5_000_000, unit: 'USD', asOf: '2026-10-01',
    ok: 'Acme Inc. raised USD 5 million in a Series A round on 2026-10-01.', undated: 'Acme Inc. raised USD 5 million in a Series A round.' },
  { type: 'distribution', value: 60, unit: 'count', asOf: '2026-10-01',
    ok: 'Acme Inc. is sold in 60 countries as of 2026-10-01.', undated: 'Acme Inc. is sold in 60 countries.' },
];

describe.each(cases)('original-passage gate: $type', (c) => {
  const input = (quote: string, over: Partial<MetricPassageSupport> = {}, value = c.value) => ({
    companyName: 'Acme Inc.', metricType: c.type, value, originals: [receipt(quote)],
    support: { sourceUrl: SOURCE, quote, asOf: c.asOf, basis: c.type, unit: c.unit, definition: c.type,
      ...(c.periodStart ? { periodStart: c.periodStart } : {}), ...over } as MetricPassageSupport,
  });
  it('accepts a supported, dated, company-named sentence', () => {
    expect(acceptedMetricPassage(input(c.ok))).toHaveLength(1);
  });
  it('rejects a foreign company', () => {
    expect(acceptedMetricPassage(input(c.ok.replace('Acme Inc.', 'Zenith Inc.')))).toEqual([]);
  });
  it('rejects an undated sentence', () => {
    expect(acceptedMetricPassage(input(c.undated))).toEqual([]);
  });
  it('rejects a mismatched number', () => {
    expect(acceptedMetricPassage(input(c.ok, {}, c.value * 2))).toEqual([]);
  });
  it('rejects an estimate', () => {
    expect(acceptedMetricPassage(input(c.ok.replace('Acme Inc. ', 'Acme Inc. approximately ')))).toEqual([]);
  });
  it('rejects a different basis', () => {
    expect(acceptedMetricPassage(input(c.ok, { basis: 'market_cap' as const }))).toEqual([]);
  });
});

describe('original-passage gate: strictness unchanged', () => {
  const gate = (metricType: MetricType, value: number, quote: string, asOf: string, unit: 'USD' | 'count', extra: Partial<MetricPassageSupport> = {}) =>
    acceptedMetricPassage({ companyName: 'Acme Inc.', metricType, value, originals: [receipt(quote)],
      support: { sourceUrl: SOURCE, quote, asOf, basis: metricType, unit, definition: metricType, ...extra } as MetricPassageSupport });
  it('annual revenue wording belongs to arr, not revenue', () => {
    const annual = 'Acme Inc. reported annual revenue of USD 40 million for the fiscal year ended September 30, 2026.';
    expect(gate('revenue', 40_000_000, annual, '2026-09-30', 'USD', { periodStart: '2025-10-01' })).toEqual([]);
  });
  it('requires a currency name for money and an annual interval for revenue', () => {
    expect(gate('funding_total', 53_000_000, 'Acme Inc. has raised a total of $53 million as of 2026-10-01.', '2026-10-01', 'USD')).toEqual([]);
    expect(gate('revenue', 40_000_000, 'Acme Inc. reported revenue of USD 40 million as of 2026-10-01.', '2026-10-01', 'USD')).toEqual([]);
  });
  it('does not let a round or a total pose as each other', () => {
    expect(gate('funding_total', 5_000_000, 'Acme Inc. raised USD 5 million in a Series A round on 2026-10-01.', '2026-10-01', 'USD')).toEqual([]);
    expect(gate('last_round', 53_000_000, 'Acme Inc. has raised a total of USD 53 million as of 2026-10-01.', '2026-10-01', 'USD')).toEqual([]);
  });
});

// Provider-reported (grounded) lane -------------------------------------------------
const reported = (type: MetricType, value: number, unit: 'USD' | 'count', text: string, asOf: string | null, extra: Partial<ReportedMetricSupport> = {}) => ({
  metricType: type, value,
  reportedSupport: { provider: 'google-search' as const, companyName: 'Acme', basis: type, value, unit, asOf, definition: type,
    support: { supportIndex: 0, text, sources: [{ chunkIndex: 0, url: SOURCE, title: 'reuters.com' }] }, ...extra } as ReportedMetricSupport,
});
const reportedCases: Array<{ type: MetricType; value: number; unit: 'USD' | 'count'; asOf: string; ok: string; undated: string }> = [
  { type: 'employees', value: 900, unit: 'count', asOf: '2026-10-01', ok: 'Acme employs 900 people as of October 1, 2026.', undated: 'Acme employs 900 people.' },
  { type: 'revenue', value: 40_000_000, unit: 'USD', asOf: '2026-09-30', ok: 'Acme reported revenue of $40 million for the fiscal year ended September 30, 2026.', undated: 'Acme reported revenue of $40 million.' },
  { type: 'funding_total', value: 53_000_000, unit: 'USD', asOf: '2026-10-01', ok: 'Acme has raised $53 million as of October 1, 2026.', undated: 'Acme has raised $53 million.' },
  { type: 'last_round', value: 5_000_000, unit: 'USD', asOf: '2026-10-01', ok: 'Acme raised $5 million in a Series A round on October 1, 2026.', undated: 'Acme raised $5 million in a Series A round.' },
  { type: 'distribution', value: 60, unit: 'count', asOf: '2026-10-01', ok: 'Acme is sold in 60+ countries as of October 1, 2026.', undated: 'Acme is sold in 60+ countries.' },
  { type: 'distribution', value: 1000, unit: 'count', asOf: '2026-10-01', ok: 'Acme is stocked in 1,000+ retail stockists as of October 1, 2026.', undated: 'Acme is stocked in 1,000+ retail stockists.' },
];
describe.each(reportedCases)('provider-reported gate: $type ($value)', (c) => {
  it('accepts a supported sentence naming the company with a date', () => {
    expect(reportedMetricCitations('Acme', null, reported(c.type, c.value, c.unit, c.ok, c.asOf))).not.toEqual([]);
  });
  it('rejects a foreign company', () => {
    expect(reportedMetricCitations('Acme', null, reported(c.type, c.value, c.unit, c.ok.replace('Acme', 'Zenith'), c.asOf))).toEqual([]);
  });
  it('rejects an undated sentence, even if the row claims a date', () => {
    // employees keeps its pre-existing lane rule (undated rows allowed); distribution may be undated
    // when the sentence names the company (see face-fill.test.ts); the other card facts require a date.
    if (c.type !== 'employees' && c.type !== 'distribution') expect(reportedMetricCitations('Acme', null, reported(c.type, c.value, c.unit, c.undated, null))).toEqual([]);
    expect(reportedMetricCitations('Acme', null, reported(c.type, c.value, c.unit, c.undated, c.asOf))).toEqual([]);
  });
  it('rejects a different number and an estimate', () => {
    expect(reportedMetricCitations('Acme', null, reported(c.type, c.value + 1, c.unit, c.ok, c.asOf))).toEqual([]);
    if (c.type !== 'employees') expect(reportedMetricCitations('Acme', null, reported(c.type, c.value, c.unit, c.ok.replace(/^Acme /, 'Acme is estimated to have '), c.asOf))).toEqual([]);
  });
  it('rejects a definition that is not the metric', () => {
    expect(reportedMetricCitations('Acme', null, reported(c.type, c.value, c.unit, c.ok, c.asOf, { definition: 'market_cap' }))).toEqual([]);
  });
});
describe('provider-reported gate: revenue needs an annual period', () => {
  it('rejects a revenue sentence with only an as-of date', () => {
    expect(reportedMetricCitations('Acme', null, reported('revenue', 40_000_000, 'USD',
      'Acme reported revenue of $40 million as of October 1, 2026.', '2026-10-01'))).toEqual([]);
  });
});
