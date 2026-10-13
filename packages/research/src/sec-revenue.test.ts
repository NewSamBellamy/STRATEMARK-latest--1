import { describe, expect, it, vi } from 'vitest';
import { hydrateCompanyCard, verifyCompanyCardOriginals } from './company-agent';
import { projectCompanyFactsFromOriginals } from './company-facts';
import type { LlmClient, MarketPlan } from './types';
import { retainedSecConcept, secConceptIsStale, secFilingHeadcountObservation, secQuarterlyRevenueSeries, secRevenueFallbackUrl, secRevenueObservation, secRevenueSeries, secRevenueVerification, secRevenueSourceUrl } from './sec-revenue';
import { acceptedMetricPassage } from './metric-support';
import { selectOriginalSourceCitations, type OriginalSourceReceipt } from './original-source';

const url = 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000789019/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax.json';
// Public SEC records inspected 2026-10-05. Subset fixture, not a complete response.
const latest = { start: '2025-07-01', end: '2026-06-30', val: 331839000000,
  accn: '0001193125-26-323660', fy: 2026, fp: 'FY', form: '10-K', filed: '2026-07-29', frame: 'CY2026' };
const repeated = { ...latest, start: '2024-07-01', end: '2025-06-30', val: 281724000000, frame: 'CY2025' };
const payload = { cik: 789019, entityName: 'MICROSOFT CORPORATION', taxonomy: 'us-gaap',
  tag: 'RevenueFromContractWithCustomerExcludingAssessedTax', units: { USD: [latest, repeated] } };
const source: OriginalSourceReceipt = { requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200,
  contentHash: 'a'.repeat(64), text: JSON.stringify(payload), retrievedAt: '2026-10-06T00:00:00.000Z', format: 'sec-companyconcept' };
const now = Date.parse('2026-10-06T00:00:00.000Z');

vi.mock('./logos', () => ({ faviconUrl: () => null, resolveLogo: async () => ({ url: null }) }));

describe('explicit original financial verification after fast hydration', () => {
  it.each([false, true])('manual verification needs a direct filing locator; opaque redirects remain unknown (redirect-only metadata: %s)', async (redirectOnly) => {
    // Deterministic source fixture; this does not claim a new live API run.
    const home = 'https://microsoft.com';
    const originals: OriginalSourceReceipt[] = [];
    const client: LlmClient = {
      ground: async () => ({ text: 'Original source: https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft.htm', queries: [], citations: [
        { title: 'Homepage', url: home },
        { title: 'Product news', url: 'https://news.microsoft.com/product-launch' },
        { title: 'sec.gov', url: redirectOnly ? 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/token' : 'https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft.htm' },
      ] }),
      structure: async (_prompt, schema) => schema.parse({
        website: home, metrics: {}, oneLiner: 'A model summary is not evidence.',
      }),
    };
    const plan: MarketPlan = { marketName: 'Enterprise software', vertical: 'Software', geography: null, notes: null, searchThemes: [] };
    const retrieve = vi.fn(async (requestedUrl: string): Promise<OriginalSourceReceipt> => {
      const receipt = requestedUrl === url ? { ...source } : {
        requestedUrl, finalUrl: requestedUrl, status: 'retrieved', httpStatus: 200,
        contentHash: 'b'.repeat(64), retrievedAt: source.retrievedAt,
        text: 'Microsoft Corporation develops software and provides cloud services for businesses.',
      } as OriginalSourceReceipt;
      originals.push(receipt);
      return receipt;
    });
    const originalSources = { retrieve, save: vi.fn(async () => {}), list: vi.fn(async () => []) };
    const initial = await hydrateCompanyCard({
      candidate: { name: 'Microsoft Corporation', domain: 'microsoft.com', descriptor: 'Enterprise software', cardTypes: ['infrastructure'] },
      client, plan, originalSources,
    });
    expect(retrieve).not.toHaveBeenCalled();
    expect(initial.metrics.every(metric => metric.value === null)).toBe(true);
    const result = await verifyCompanyCardOriginals(initial, client, { originalSources });
    expect(retrieve).toHaveBeenCalledTimes(redirectOnly ? 2 : 3);
    if (!redirectOnly) expect(retrieve.mock.calls.map(call => call[0])).toContain(url);
    // An issuer profile must not be sacrificed to the complementary SEC pair.
    expect(result.company.oneLiner).toBe('Microsoft Corporation develops software and provides cloud services for businesses.');
    const reopened = projectCompanyFactsFromOriginals(result.company, result.metrics, structuredClone(originals));
    if (redirectOnly) {
      // The explicit checker has no retained direct filing locator. Neither an
      // opaque Google redirect nor the older search prose proves financial data.
      expect(retrieve.mock.calls.map(call => call[0])).not.toContain(url);
      expect(reopened.find(metric => metric.metricType === 'arr')).toMatchObject({ value: null, confidence: 'unknown' });
      expect(reopened.find(metric => metric.metricType === 'employees')?.value).toBeNull();
      return;
    }
    expect(reopened.find(metric => metric.metricType === 'arr')).toMatchObject({
      value: latest.val, confidence: 'verified', passageSupport: { definition: 'annual_revenue', periodStart: latest.start, asOf: latest.end },
    });
    expect(reopened.find(metric => metric.metricType === 'employees')?.value).toBeNull();
  });
});
describe('regulator-reported annual revenue', () => {
  it('reads the filed company-wide workforce, not regional breakdowns, in current full-time-basis wording', () => {
    const filing = 'https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft-20260630.htm';
    const receipt: OriginalSourceReceipt = { requestedUrl: filing, finalUrl: filing, status: 'retrieved', httpStatus: 200,
      contentHash: 'c'.repeat(64), issuerName: 'MICROSOFT CORPORATION', format: 'sec-filing', truncated: false,
      text: 'As of June 30, 2026, we employed approximately 223,000 people on a full-time basis, 121,000 in the U.S. and 102,000 internationally.',
      retrievedAt: '2026-10-06T00:00:00.000Z' };
    const observed = secFilingHeadcountObservation('Microsoft Corporation', [receipt], now)!;
    expect(observed?.value).toBe(223000);
    expect(receipt.text).toContain(observed.passageSupport.quote);
    expect(acceptedMetricPassage({ companyName: 'Microsoft Corporation', metricType: 'employees', value: 223000,
      support: observed.passageSupport, originals: [receipt], nowMs: now })).toEqual(observed.citations);
    expect(secFilingHeadcountObservation('Other Corporation', [receipt], now)).toBeNull();
  });
  it('routes a discovered issuer browse page by its explicit CIK rather than treating its navigation as financial proof', () => {
    expect(secRevenueSourceUrl('https://www.sec.gov/edgar/browse/?CIK=0000789019')).toBe(url);
    expect(secRevenueSourceUrl('https://www.sec.gov/edgar/browse/?CIK=789019&owner=exclude')).toBe(url);
    for (const bad of ['https://www.sec.gov/edgar/browse/?CIK=MSFT',
      'https://sec.gov.attacker.test/edgar/browse/?CIK=789019',
      'https://www.sec.gov/edgar/browse/?CIK=789019&CIK=320193']) expect(secRevenueSourceUrl(bad)).toBeNull();
  });
  it('routes a discovered SEC edgar/data filing lead without treating it as issuer proof', () => {
    expect(secRevenueSourceUrl('https://www.sec.gov/edgar/data/789019/000078901925000028/msft-20250630.htm')).toBe(url);
    expect(secRevenueSourceUrl('https://sec.gov.attacker.test/edgar/data/789019/report.htm')).toBeNull();
    expect(secRevenueSourceUrl('https://www.sec.gov/edgar/data/not-an-id/report.htm')).toBeNull();
  });
  it('derives a current reported headcount only from an issuer-matched SEC filing', () => {
    const filing = 'https://www.sec.gov/edgar/data/789019/000119312526323660/msft.htm';
    const headcount: OriginalSourceReceipt = { requestedUrl: filing, finalUrl: filing, status: 'retrieved', httpStatus: 200,
      contentHash: 'c'.repeat(64), issuerName: 'MICROSOFT CORPORATION', format: 'sec-filing', truncated: false,
      text: 'Microsoft Corporation Form 10-K. As of June 30, 2026, we had approximately 228,000 full-time employees.',
      retrievedAt: '2026-10-06T00:00:00.000Z' };
    const observed = secFilingHeadcountObservation('Microsoft Corporation', [headcount], now)!;
    expect(observed).toMatchObject({ value: 228000, passageSupport: { sourceUrl: filing, asOf: '2026-06-30',
      basis: 'employees', definition: 'employees', format: 'sec-filing' } });
    expect(acceptedMetricPassage({ companyName: 'Microsoft Corporation', metricType: 'employees', value: 228000,
      support: observed.passageSupport, originals: [headcount], nowMs: now })).toEqual(observed.citations);
    expect(secFilingHeadcountObservation('Other Corporation', [headcount], now)).toBeNull();
  });
  it('rechecks the same annual measurement without model interpretation, but never contradicts a known ARR with annual revenue', () => {
    const common = { metricType: 'arr' as const, value: latest.val };
    expect(secRevenueVerification('Microsoft Corporation', { ...common, passageSupport: {
      sourceUrl: url, quote: '{}', basis: 'arr', unit: 'USD', definition: 'annual_revenue', asOf: latest.end, periodStart: latest.start,
    } }, [source], now)).toMatchObject({ verdict: 'supported', currentValue: latest.val });
    expect(secRevenueVerification('Microsoft Corporation', { ...common, passageSupport: null }, [source], now)).toBeNull();
  });
  it('selects the actual latest annual interval, not a comparative repeated in a newer filing, and passes the public facts gate', () => {
    const observed = secRevenueObservation('Microsoft Corporation', [source], now)!;
    expect(observed.value).toBe(latest.val);
    expect(observed.passageSupport).toMatchObject({ definition: 'annual_revenue', basis: 'arr', unit: 'USD',
      asOf: latest.end, periodStart: latest.start, format: 'sec-companyconcept' });
    expect(source.text).toContain(observed.passageSupport.quote);
    expect(acceptedMetricPassage({ companyName: 'Microsoft Corporation', metricType: 'arr', value: observed.value,
      support: observed.passageSupport, originals: [source], nowMs: now })).toEqual(observed.citations);
    expect(acceptedMetricPassage({ companyName: 'Microsoft Corporation', metricType: 'arr', value: observed.value,
      support: { ...observed.passageSupport, definition: 'arr' }, originals: [source], nowMs: now })).toEqual([]);
  });
  it.each(['Microsoft Gaming', 'Micro', 'Other Corporation'])('does not assign a parent/other issuer to %s', company => {
    expect(secRevenueObservation(company, [source], now)).toBeNull();
  });
  it.each(['cik', 'tag', 'currency', 'quarter', 'future', 'conflict', 'unreadable', 'truncated', 'host', 'missing-hash'] as const)('rejects incompatible %s evidence', fault => {
    const doc = structuredClone(payload);
    const receipt = { ...source };
    if (fault === 'cik') doc.cik = 320193;
    if (fault === 'tag') doc.tag = 'Assets';
    if (fault === 'currency') doc.units = { EUR: [latest] } as unknown as typeof doc.units;
    if (fault === 'quarter') doc.units.USD = [{ ...latest, start: '2026-04-01', form: '10-Q', fp: 'Q4' }];
    if (fault === 'future') doc.units.USD = [{ ...latest, filed: '2026-12-01' }];
    if (fault === 'conflict') doc.units.USD = [latest, { ...latest, val: 99 }];
    receipt.text = JSON.stringify(doc);
    if (fault === 'unreadable') receipt.status = 'blocked';
    if (fault === 'truncated') receipt.truncated = true;
    if (fault === 'host') receipt.finalUrl = url.replace('data.sec.gov', 'data.sec.gov.attacker.example');
    if (fault === 'missing-hash') receipt.contentHash = undefined;
    expect(secRevenueObservation('Microsoft Corporation', [receipt], now)).toBeNull();
  });
  it('ignores an older reported interval re-fetched after it has aged out', () => {
    expect(secRevenueObservation('Microsoft Corporation', [{ ...source, retrievedAt: '2028-01-01T00:00:00.000Z' }], Date.parse('2028-01-01T00:00:00.000Z'))).toBeNull();
  });
  it('routes a cited SEC filing to its company concept inside the existing two-read budget', () => {
    const chosen = selectOriginalSourceCitations([
      { title: 'Microsoft filing', url: 'https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft.htm' },
      { title: 'Issuer', url: 'https://microsoft.com/results' },
      { title: 'Discussion', url: 'https://reddit.com/r/msft' },
    ], 'https://microsoft.com', true);
    expect(chosen.map(c => c.url)).toEqual([url, 'https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft.htm']);
  });
});


describe('secRevenueSeries - multi-year history from the same retained receipts', () => {
  const older = { ...latest, start: '2023-07-01', end: '2024-06-30', val: 245122000000, accn: '0001193125-25-189064', filed: '2025-07-30', frame: 'CY2024' };
  const payloadThree = { cik: 789019, entityName: 'MICROSOFT CORPORATION', taxonomy: 'us-gaap',
    tag: 'RevenueFromContractWithCustomerExcludingAssessedTax', units: { USD: [latest, repeated, older] } };
  const threeYearSource: OriginalSourceReceipt = { ...source, text: JSON.stringify(payloadThree) };

  it('derives an ascending multi-point series with per-year values', () => {
    const series = secRevenueSeries('Microsoft Corporation', [threeYearSource], now);
    expect(series).not.toBeNull();
    expect(series!.map((point) => [point.period, point.value])).toEqual([
      ['2024-06-30', 245122000000], ['2025-06-30', 281724000000], ['2026-06-30', 331839000000],
    ]);
  });

  it('returns null below two points and for a mismatched entity name', () => {
    const single = { cik: 789019, entityName: 'MICROSOFT CORPORATION', taxonomy: 'us-gaap',
      tag: 'RevenueFromContractWithCustomerExcludingAssessedTax', units: { USD: [latest] } };
    expect(secRevenueSeries('Microsoft Corporation', [{ ...source, text: JSON.stringify(single) }], now)).toBeNull();
    expect(secRevenueSeries('Wrong Company Inc', [threeYearSource], now)).toBeNull();
  });
});

describe('Revenues fallback and bounded retention', () => {
  const fallback = url.replace('RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues');

  it('falls back from the ASC 606 concept to Revenues for the same issuer, and never further', () => {
    expect(secRevenueFallbackUrl(url)).toBe(fallback);
    expect(secRevenueFallbackUrl(fallback)).toBeNull();
    expect(secRevenueFallbackUrl('https://data.sec.gov/api/xbrl/companyconcept/CIK0000789019/us-gaap/NetIncomeLoss.json')).toBeNull();
  });

  it('calls a concept stale when nothing ends in the last ~15 months', () => {
    expect(secConceptIsStale(JSON.stringify(payload), now)).toBe(false);
    expect(secConceptIsStale(JSON.stringify({ ...payload, units: { USD: [{ ...latest, end: '2022-01-30' }] } }), now)).toBe(true);
    expect(secConceptIsStale('not json', now)).toBe(true);
  });

  it('keeps a document whole when it fits, else only the last 11 years, with each kept record still quotable', () => {
    expect(retainedSecConcept(JSON.stringify(payload), now)).toBe(JSON.stringify(payload));
    const ancient = Array.from({ length: 400 }, (_, i) => ({ ...latest, start: '2001-01-01', end: '2001-12-31', val: i }));
    const big = JSON.stringify({ ...payload, tag: 'Revenues', units: { USD: [...ancient, latest, repeated] } });
    const kept = retainedSecConcept(big, now)!;
    expect(kept.length).toBeLessThan(big.length);
    const receipt = { ...source, finalUrl: fallback, text: kept };
    expect(secRevenueSeries('Microsoft Corporation', [receipt], now)!.map((point) => point.value)).toEqual([281724000000, 331839000000]);
    expect(retainedSecConcept(JSON.stringify({ ...payload, description: 'x'.repeat(40000) }), now)).toBeNull();
  });
});

describe('secQuarterlyRevenueSeries - three-month periods exactly as filed', () => {
  const quarter = (start: string, end: string, val: number, filed: string, fp = 'Q1') =>
    ({ start, end, val, accn: '0000950170-26-000001', fy: 2026, fp, form: '10-Q', filed });
  const q1 = quarter('2025-07-01', '2025-09-30', 77673000000, '2025-10-29');
  const q2 = quarter('2025-10-01', '2025-12-31', 81273000000, '2026-01-28', 'Q2');
  const sixMonths = quarter('2025-07-01', '2025-12-31', 158946000000, '2026-01-28', 'Q2');
  const q2Restated = { ...q2, val: 81300000000, filed: '2026-04-29', fp: 'Q3' };
  const textOf = (units: unknown[]) => JSON.stringify({ cik: 789019, entityName: 'MICROSOFT CORPORATION', taxonomy: 'us-gaap',
    tag: 'RevenueFromContractWithCustomerExcludingAssessedTax', units: { USD: units } });

  it('keeps only three-month periods, takes each period\'s latest filing, and ignores annual and year-to-date totals', () => {
    const series = secQuarterlyRevenueSeries('Microsoft Corporation', [{ ...source, text: textOf([latest, q1, q2, sixMonths, q2Restated]) }], now);
    expect(series!.map((point) => [point.period, point.value])).toEqual([['2025-09-30', 77673000000], ['2025-12-31', 81300000000]]);
  });

  it('never derives a missing quarter and needs two reported quarters for a series', () => {
    expect(secQuarterlyRevenueSeries('Microsoft Corporation', [{ ...source, text: textOf([latest, repeated, q1, sixMonths]) }], now)).toBeNull();
    expect(secQuarterlyRevenueSeries('Wrong Company Inc', [{ ...source, text: textOf([q1, q2]) }], now)).toBeNull();
  });

  it('leaves the annual series untouched by quarterly records', () => {
    expect(secRevenueSeries('Microsoft Corporation', [{ ...source, text: textOf([latest, repeated, q1, q2]) }], now)!
      .map((point) => point.period)).toEqual(['2025-06-30', '2026-06-30']);
  });
});
