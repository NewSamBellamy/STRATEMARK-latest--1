/**
 * Date digits are never figures. Live janitorial-services deck: Ecolab Inc.
 * stored employees = 29 (estimated) from "… within a broader global workforce,
 * as reported on September 29, 2026" — the binder took the day of the month
 * beside the basis word "workforce" as the headcount.
 */
import { describe, expect, it } from 'vitest';
import { companyMetricSchema, type CompanyMetric } from '@mi/contracts';
import { dateSpans, storedValueIsDateDigit, valueOnlyInDates } from './date-digits';
import { reportedCompanyMetrics, reportedMetricCitations, reportedStoredCitations } from './reported-metrics';
import { extractProviderGrounding } from './grounding-support';
import { enrichmentOutSchema } from './schemas';
import { quoteHolds } from './quoted-estimate';
import { implausibleScaleFigures } from './scale-plausibility';
import { migrateSnapshot, type RepoSnapshot } from './repository';
import { METRIC_GATE_VERSION } from './revalidate-stored';

const ECOLAB_SENTENCE = 'Ecolab Inc. has approximately 26,000 sales-and-service associates who drive to customer locations, within a broader global workforce, as reported on September 29, 2026';
const ecolab = { id: 'co_ecolab', name: 'Ecolab Inc.' };
const SOURCE = 'https://example.org/ecolab';
const CAPTURED = '2026-10-10T00:00:00.000Z';

function employees(value: number, text: string, asOf: string | null = null, extra: Partial<CompanyMetric> = {}): CompanyMetric {
  return {
    id: `met_${ecolab.id}_employees`, companyId: ecolab.id, metricType: 'employees', value,
    confidence: 'estimated', source: SOURCE, citations: [{ title: 'example.org', url: SOURCE }],
    methodNote: 'Source reported employees; provider-grounded, not verified against an original.',
    capturedAt: CAPTURED, lastVerifiedAt: null, passageSupport: null,
    reportedSupport: {
      provider: 'google-search', companyName: ecolab.name, basis: 'employees', value, unit: 'count', asOf,
      definition: 'employees', support: { supportIndex: 0, text, sources: [{ chunkIndex: 0, url: SOURCE, title: 'example.org' }] },
    },
    ...extra,
  } as CompanyMetric;
}

function run(segments: string[], metrics: Record<string, unknown> = {}) {
  const text = segments.join('\n\n');
  let cursor = 0;
  const grounding = extractProviderGrounding(text, {
    groundingChunks: [{ web: { uri: SOURCE, title: 'example.org' } }],
    groundingSupports: segments.map((passage) => {
      const start = text.indexOf(passage, cursor);
      cursor = start + passage.length;
      return { segment: { text: passage, startIndex: start, endIndex: start + passage.length }, groundingChunkIndices: [0] };
    }),
  });
  const rows = reportedCompanyMetrics({ companyId: ecolab.id, companyName: ecolab.name, website: null, text, grounding,
    identity: { otherCompanies: ['ABM Industries', 'Cintas'] }, capturedAt: CAPTURED, enrichment: enrichmentOutSchema.parse({ metrics }) });
  return rows.find((row) => row.metricType === 'employees')!;
}

describe('dateSpans / valueOnlyInDates', () => {
  it.each([
    ['as reported on September 29, 2026', 29],
    ['as reported on September 29, 2026', 2026],
    ['on Sept. 29 the company said', 29],
    ['on Sep 29th, 2026', 29],
    ['on 29 September 2026', 29],
    ['on the 29th of September', 29],
    ['in September 2026', 2026],
    ['dated 2026-09-29', 29],
    ['dated 2026-09-29', 2026],
    ['dated 9/29/2026', 29],
    ['dated 29.09.2026', 29],
    ['in Q3 2026', 2026],
    ['in H1 2025', 2025],
  ])('%s: %d is a date digit', (text, value) => {
    expect(valueOnlyInDates(text, value)).toBe(true);
  });

  it.each([
    ['Ecolab has 48,000 employees as of September 29, 2026', 48_000],
    ['Acme employs 1,200 people', 1_200],
    ['Acme has 2,000 employees', 2_000],
    ['Acme has 2026 employees', 2026],
    ['Acme has 29 employees as of September 29, 2026', 29],
    ['50 may leave the company', 50],
    ['revenue of $10.5-12 billion', 12],
  ])('%s: %d is a figure', (text, value) => {
    expect(valueOnlyInDates(text, value)).toBe(false);
  });

  it('finds no date in plain figures', () => {
    expect(dateSpans('Acme employs 1,200 people across 12 countries')).toEqual([]);
  });
});

describe('reported lane binder', () => {
  it('never binds the day of the month in the Ecolab sentence as a headcount', () => {
    for (const asOf of ['2026-09-29', null]) {
      expect(reportedMetricCitations(ecolab.name, null, employees(29, ECOLAB_SENTENCE, asOf))).toEqual([]);
      expect(reportedStoredCitations(ecolab.name, null, employees(29, ECOLAB_SENTENCE, asOf))).toEqual([]);
    }
    expect(reportedMetricCitations(ecolab.name, null, employees(2026, ECOLAB_SENTENCE))).toEqual([]);
  });

  it('a subset of staff (26,000 sales-and-service associates) is not total headcount', () => {
    expect(reportedMetricCitations(ecolab.name, null, employees(26_000, ECOLAB_SENTENCE, '2026-09-29'))).toEqual([]);
  });

  it('omission recovery finds no employees figure in the Ecolab sentence', () => {
    expect(run(['Ecolab Inc. provides water, hygiene and infection-prevention services.', ECOLAB_SENTENCE]))
      .toMatchObject({ value: null, confidence: 'unknown' });
  });

  it('a model selector proposing the date digit is refused', () => {
    const row = run(['Ecolab Inc. provides water, hygiene and infection-prevention services.', ECOLAB_SENTENCE], {
      employees: { value: 29, confidence: 'estimated', reportedClaim: { sourceUrl: SOURCE, quote: ECOLAB_SENTENCE,
        asOf: '2026-09-29', basis: 'employees', definition: 'employees', unit: 'count' } },
    });
    expect(row).toMatchObject({ value: null, confidence: 'unknown' });
  });

  it('still binds a real headcount stated beside a date', () => {
    const sentence = 'Ecolab has 48,000 employees as of September 29, 2026';
    expect(reportedMetricCitations(ecolab.name, null, employees(48_000, sentence, '2026-09-29')).length).toBeGreaterThan(0);
    expect(reportedMetricCitations(ecolab.name, null, employees(29, sentence, '2026-09-29'))).toEqual([]);
    expect(run(['Ecolab Inc. provides water, hygiene and infection-prevention services.', sentence]))
      .toMatchObject({ value: 48_000, confidence: 'estimated', reportedSupport: { asOf: '2026-09-29' } });
  });

  it('still binds an undated "employs 1,200 people"', () => {
    expect(reportedMetricCitations(ecolab.name, null, employees(1_200, 'Ecolab employs 1,200 people')).length).toBeGreaterThan(0);
  });
});

describe('quoted-original lane', () => {
  it('never attaches a date digit as the quoted amount', () => {
    const quote = 'Ecolab Inc. counted its employees on September 29, 2026.';
    expect(quoteHolds({ companyName: ecolab.name, metricType: 'employees', value: 29, quote, asOf: '2026-10-01', unit: 'count',
      nowMs: Date.parse(CAPTURED) })).toBe(false);
  });
});

describe('stored date-digit figures (v11 revalidation)', () => {
  it('withholds the stored Ecolab 29 and keeps a real headcount', () => {
    const bad = employees(29, ECOLAB_SENTENCE, '2026-09-29');
    const good = { ...employees(48_000, 'Ecolab has 48,000 employees as of September 29, 2026', '2026-09-29'), id: 'met_good', companyId: 'co_other' };
    expect(storedValueIsDateDigit(bad)).toBe(true);
    expect(storedValueIsDateDigit(good)).toBe(false);
    expect(storedValueIsDateDigit({ ...bad, confidence: 'verified' })).toBe(false);
    expect(implausibleScaleFigures({ companies: [ecolab, { id: 'co_other', name: 'Other' }], metrics: [bad, good] })
      .map((f) => [f.metricId, f.gate])).toEqual([[bad.id, 'date_digit_figure']]);
  });

  it('a v10 snapshot is migrated: the date digit is withheld as unknown with a Withheld note', () => {
    expect(METRIC_GATE_VERSION).toBeGreaterThanOrEqual(11);
    const snap = {
      schemaVersion: 2, markets: [], decks: [], cards: [], viceClaims: [], companyMarket: {}, reports: [], briefings: [],
      savedCards: [], opportunity: {}, researchJobs: [], threads: [],
      companies: [{ ...ecolab, websiteUrl: null }],
      metrics: [employees(29, ECOLAB_SENTENCE, '2026-09-29')],
      dashboards: {}, metricGateVersion: 10,
    } as unknown as RepoSnapshot;
    const { snapshot: out, revalidation } = migrateSnapshot(snap);
    expect(revalidation?.ran).toBe(true);
    expect(revalidation?.reset.map((r) => [r.companyId, r.gate, r.previousValue])).toEqual([[ecolab.id, 'date_digit_figure', 29]]);
    const row = out.metrics[0]!;
    expect(row).toMatchObject({ value: null, confidence: 'unknown', source: null, citations: [], reportedSupport: null });
    expect(row.methodNote).toMatch(/^Withheld:/);
    expect(companyMetricSchema.safeParse(row).success).toBe(true);
    expect(out.metricGateVersion).toBe(METRIC_GATE_VERSION);
  });
});
