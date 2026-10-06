import { describe, expect, it } from 'vitest';
import { secRevenueObservation, secRevenueVerification } from './sec-revenue';
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
describe('regulator-reported annual revenue', () => {
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
    expect(chosen.map(c => c.url)).toEqual([url, 'https://microsoft.com/results']);
  });
});
