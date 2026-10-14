/**
 * Headcount vs. reach: payroll/EWA/HR companies state reach as "<N> employees"
 * ("6 million employees use DailyPay"); that is never the company's own staff.
 * Live deck "Earned Wage Access Providers" stored DailyPay 6,000,000, Stream
 * 4,000,000, Dayforce 7,600,000 and Tapcheck 112,000 as employees.
 */
import { describe, expect, it } from 'vitest';
import { companyMetricSchema, type CompanyMetric } from '@mi/contracts';
import { headcountFramedAsReach, MAX_PLAUSIBLE_HEADCOUNT, unverifiedHeadcountProblem } from './headcount-reach';
import { reportedMetricCitations, reportedSupportCitations } from './reported-metrics';
import { quoteHolds } from './quoted-estimate';
import { implausibleScaleFigures } from './scale-plausibility';
import { migrateSnapshot, type RepoSnapshot } from './repository';
import { METRIC_GATE_VERSION } from './revalidate-stored';

const CAPTURED = '2026-10-01T00:00:00.000Z';
const SOURCE = 'https://example.org/profile';

function employees(company: { id: string; name: string }, value: number, text: string,
  extra: Partial<CompanyMetric> = {}): CompanyMetric {
  return {
    id: `met_${company.id}_employees`, companyId: company.id, metricType: 'employees', value,
    confidence: 'estimated', source: SOURCE, citations: [{ title: 'example.org', url: SOURCE }],
    methodNote: 'Source reported employees (undated); provider-grounded, not verified against an original.',
    capturedAt: CAPTURED, lastVerifiedAt: null, passageSupport: null,
    reportedSupport: {
      provider: 'google-search', companyName: company.name, basis: 'employees', value, unit: 'count', asOf: null,
      definition: 'employees', support: { supportIndex: 0, text, sources: [{ chunkIndex: 0, url: SOURCE, title: 'example.org' }] },
    },
    ...extra,
  } as CompanyMetric;
}

const dailypay = { id: 'co_dailypay', name: 'DailyPay' };
const stream = { id: 'co_stream', name: 'Stream' };
const dayforce = { id: 'co_dayforce', name: 'Dayforce' };
const tapcheck = { id: 'co_tapcheck', name: 'Tapcheck' };
const workday = { id: 'co_workday', name: 'Workday' };
const walmart = { id: 'co_walmart', name: 'Walmart' };

const cite = (company: { name: string }, row: CompanyMetric) => reportedMetricCitations(company.name, null, row);

describe('headcountFramedAsReach', () => {
  it.each([
    ['6 million employees use DailyPay.', 6e6],
    ['Tapcheck is serving 112,000 employees at 12,000 employers.', 112_000],
    ['Stream is available to 4M employees across the UK.', 4e6],
    ['Dayforce pays 7.6 million employees.', 7.6e6],
    ['Over 1 million employees at more than 500 companies have access to Payactiv.', 1e6],
  ])('reads %s as reach', (text, value) => {
    expect(headcountFramedAsReach(text, value)).toBe(true);
  });

  it.each([
    ['DailyPay has 600 employees.', 600],
    ['Workday employs 21,000 people as of January 31, 2025.', 21_000],
    ['Paychex had approximately 17,600 employees as of May 31, 2025.', 17_600],
    ['ADP has 67,000 employees worldwide.', 67_000],
    ['Gong has a team of 2,028 employees.', 2_028],
    ['Acme, which supports small businesses, has 600 employees.', 600],
  ])('reads %s as headcount', (text, value) => {
    expect(headcountFramedAsReach(text, value)).toBe(false);
  });

  it('judges only the clause carrying the stored number', () => {
    const text = 'DailyPay has 600 employees; 6 million employees use DailyPay.';
    expect(headcountFramedAsReach(text, 600)).toBe(false);
    expect(headcountFramedAsReach(text, 6e6)).toBe(true);
  });
});

describe('write gates: reach is never stored as employees', () => {
  it('rejects "6 million employees use DailyPay" as DailyPay employees', () => {
    const row = employees(dailypay, 6e6, 'DailyPay says 6 million employees use DailyPay.');
    expect(cite(dailypay, row)).toEqual([]);
    expect(reportedSupportCitations(dailypay.name, null, row)).toEqual([]);
  });

  it('accepts "DailyPay has 600 employees"', () => {
    const row = employees(dailypay, 600, 'DailyPay has 600 employees.');
    expect(cite(dailypay, row).length).toBeGreaterThan(0);
    expect(reportedSupportCitations(dailypay.name, null, row).length).toBeGreaterThan(0);
  });

  it('rejects Tapcheck "serving 112,000 employees at 12,000 employers"', () => {
    const row = employees(tapcheck, 112_000, 'Tapcheck is serving 112,000 employees at 12,000 employers.');
    expect(cite(tapcheck, row)).toEqual([]);
    expect(reportedSupportCitations(tapcheck.name, null, row)).toEqual([]);
  });

  it('rejects the same reach phrase in the quoted-original lane, keeps a real headcount', () => {
    const nowMs = Date.parse(CAPTURED);
    const quote = (text: string, value: number) => quoteHolds({ companyName: 'Tapcheck', metricType: 'employees', value,
      quote: text, asOf: '2026-09-01', unit: 'count', nowMs });
    expect(quote('Tapcheck is serving 112,000 employees at 12,000 employers as of September 1, 2026.', 112_000)).toBe(false);
    expect(quote('Tapcheck has 150 employees as of September 1, 2026.', 150)).toBe(true);
  });

  it('rejects an unverified headcount above any real employer', () => {
    const row = employees(dayforce, 7.6e6, 'Dayforce has 7.6 million employees.');
    expect(cite(dayforce, row)).toEqual([]);
  });
});

describe('unverified headcount gate (scale pass)', () => {
  const companies = [dailypay, stream, dayforce, tapcheck, workday, walmart];

  it('withholds reach-framed and >2.5M unverified headcounts, keeps real ones and verified rows', () => {
    const metrics = [
      employees(dailypay, 6e6, 'DailyPay says 6 million employees use DailyPay.'),
      employees(stream, 4e6, 'Stream is available to 4M employees.'),
      // Support phrasing lost: the size alone is impossible for an unverified row.
      employees(dayforce, 7.6e6, 'Dayforce has 7.6 million employees.'),
      employees(tapcheck, 112_000, 'Tapcheck is serving 112,000 employees at 12,000 employers.'),
      employees(workday, 21_000, 'Workday employs 21,000 people as of January 31, 2025.'),
      employees(walmart, 2.1e6, 'Walmart employs approximately 2.1 million associates.', { confidence: 'verified' }),
    ];
    const found = implausibleScaleFigures({ companies, metrics }).map((f) => [f.companyId, f.gate]).sort();
    expect(found).toEqual([
      [dailypay.id, 'headcount_is_reach'],
      [dayforce.id, 'headcount_too_large'],
      [stream.id, 'headcount_is_reach'],
      [tapcheck.id, 'headcount_is_reach'],
    ].sort());
    // Stream's 4M is both reach and too large; reach names what it counts.
    expect(unverifiedHeadcountProblem(metrics[1]!)).toBe('headcount_is_reach');
    expect(MAX_PLAUSIBLE_HEADCOUNT).toBe(2_500_000);
  });

  it('never judges a verified or human-verified headcount, even above 2.5M', () => {
    const verified = employees(walmart, 3e6, '3 million employees use Walmart Pay.', { confidence: 'verified' });
    const human = { ...verified, id: 'met_human', confidence: 'user_verified' as const };
    expect(unverifiedHeadcountProblem(verified)).toBeNull();
    expect(unverifiedHeadcountProblem(human)).toBeNull();
    expect(implausibleScaleFigures({ companies, metrics: [verified, human] })).toEqual([]);
  });

  it('a reach headcount no longer serves as the per-head denominator', () => {
    // 6M "employees" would carry $30B revenue; 600 real staff cannot.
    const revenue: CompanyMetric = { ...employees(dailypay, 30e9, 'x'), id: 'met_rev', metricType: 'arr', value: 30e9,
      reportedSupport: null };
    const reach = employees(dailypay, 6e6, '6 million employees use DailyPay.');
    const found = implausibleScaleFigures({ companies, metrics: [reach, revenue] });
    expect(found.map((f) => f.metricId)).toEqual([reach.id]);
  });
});

describe('v9 revalidation of a stored snapshot', () => {
  function snapshot(): RepoSnapshot {
    return {
      schemaVersion: 2, markets: [], decks: [], cards: [], viceClaims: [], companyMarket: {}, reports: [], briefings: [],
      savedCards: [], opportunity: {}, researchJobs: [], threads: [],
      companies: [dailypay, tapcheck, workday, walmart].map((c) => ({ ...c, websiteUrl: null })) as unknown as RepoSnapshot['companies'],
      metrics: [
        employees(dailypay, 6e6, 'DailyPay says 6 million employees use DailyPay.'),
        employees(tapcheck, 112_000, 'Tapcheck is serving 112,000 employees at 12,000 employers.'),
        employees(workday, 21_000, 'Workday employs 21,000 people as of January 31, 2025.'),
        employees(walmart, 2.1e6, 'Walmart employs approximately 2.1 million associates.', { confidence: 'verified' }),
      ],
      dashboards: { co_dailypay: { overview: { content: 'DailyPay has 6 million employees.', lastRefreshedAt: CAPTURED } } },
      metricGateVersion: 8,
    } as unknown as RepoSnapshot;
  }

  it('withholds reach headcounts stored at v8 and leaves real/verified ones alone', () => {
    expect(METRIC_GATE_VERSION).toBeGreaterThanOrEqual(9);
    const { snapshot: snap, revalidation } = migrateSnapshot(snapshot());
    expect(revalidation?.ran).toBe(true);
    expect(revalidation?.fromVersion).toBe(8);
    expect(revalidation?.reset.map((r) => [r.companyId, r.gate, r.previousValue]).sort()).toEqual([
      [dailypay.id, 'headcount_is_reach', 6e6],
      [tapcheck.id, 'headcount_is_reach', 112_000],
    ].sort());
    for (const id of [dailypay.id, tapcheck.id]) {
      const m = snap.metrics.find((row) => row.companyId === id)!;
      expect(m).toMatchObject({ value: null, confidence: 'unknown', source: null, citations: [], reportedSupport: null });
      expect(m.methodNote).toMatch(/^Withheld:/);
      expect(companyMetricSchema.safeParse(m).success).toBe(true);
    }
    expect(snap.metrics.find((row) => row.companyId === workday.id)!.value).toBe(21_000);
    expect(snap.metrics.find((row) => row.companyId === walmart.id)).toMatchObject({ value: 2.1e6, confidence: 'verified' });
    // The dashboard restating the withdrawn figure is invalidated.
    expect(snap.dashboards[dailypay.id]).toEqual({});
    expect(snap.metricGateVersion).toBe(METRIC_GATE_VERSION);
  });
});
