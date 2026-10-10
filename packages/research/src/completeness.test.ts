/**
 * computeCompanyCompleteness — the readiness gate behind "what's missing?"
 * before a report is served. Pure classification must stay honest (filled /
 * unknown / absent, never a proposed value); the repository pass must kick the
 * existing fill ladder for gapped companies and report what it could not fill.
 */
import { describe, expect, it, vi } from 'vitest';
import { companyCompletenessSchema, computeCompanyCompleteness, summarizeDeckCompleteness } from './completeness';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';
import type { CompanyMetric, Confidence, MetricType } from '@mi/contracts';

const now = new Date().toISOString();

function metric(companyId: string, metricType: MetricType, value: number | null, confidence: Confidence): CompanyMetric {
  return {
    id: `met_${companyId}_${metricType}_${value ?? 'null'}`, companyId, metricType, value, confidence,
    source: null, citations: [], methodNote: null, capturedAt: now,
  };
}

/** Human ground truth: the only confidence tier the facts projection keeps
 * without retained passage proof, so repository fixtures stay "filled". */
function humanFact(companyId: string, metricType: MetricType, value: number): CompanyMetric {
  return {
    id: `met_${companyId}_${metricType}`, companyId, metricType, value, confidence: 'user_verified',
    source: 'Analyst confirmed', citations: [], methodNote: null, capturedAt: now,
  };
}

describe('computeCompanyCompleteness', () => {
  it('classifies each core slot as filled, unknown or absent', () => {
    const report = computeCompanyCompleteness({
      companyId: 'cmp_1',
      name: 'OpenAI',
      metrics: [
        metric('cmp_1', 'employees', 3500, 'verified'), // filled → no gap
        metric('cmp_1', 'arr', null, 'unknown'), // row exists, no value → unknown
        // users: no row at all → absent
        metric('cmp_1', 'market_cap', null, 'unknown'), // rowed value slot → unknown
      ],
    });
    expect(report.profile).toBe('operating_company');
    expect(report.gaps).toEqual([
      { metricType: 'arr', label: 'ARR', state: 'unknown' },
      { metricType: 'users', label: 'Users', state: 'absent' },
      { metricType: 'market_cap', label: 'Market Cap', state: 'unknown' },
    ]);
    expect(report.ready).toBe(false);
    expect(companyCompletenessSchema.parse(report)).toEqual(report);
  });

  it('an operating company missing market_cap and users lists exactly those gaps', () => {
    const report = computeCompanyCompleteness({
      companyId: 'cmp_1',
      name: 'OpenAI',
      metrics: [
        metric('cmp_1', 'employees', 3500, 'verified'),
        metric('cmp_1', 'arr', 13_000_000_000, 'verified'),
      ],
    });
    expect(report.gaps).toEqual([
      { metricType: 'users', label: 'Users', state: 'absent' },
      { metricType: 'market_cap', label: 'Market Cap', state: 'absent' },
    ]);
    expect(report.ready).toBe(false);
  });

  it('keeps a financial firm honest: aum+employees filled still owes its company-value and ARR slots', () => {
    // PROFILE_CORE_SLOTS.financial_firm has four slots; two filled figures leave
    // the company-value and ARR slots as honest gaps, not a ready report.
    const report = computeCompanyCompleteness({
      companyId: 'cmp_2',
      name: 'Andreessen Horowitz',
      profile: 'financial_firm',
      metrics: [
        metric('cmp_2', 'aum', 42_000_000_000, 'verified'),
        metric('cmp_2', 'employees', 738, 'verified'),
      ],
    });
    expect(report.gaps).toEqual([
      { metricType: 'market_cap', label: 'Market Cap', state: 'absent' },
      { metricType: 'arr', label: 'ARR', state: 'absent' },
    ]);
    expect(report.ready).toBe(false);
  });

  it('a VC-profile company whose aum, employees, value and arr slots are filled is ready', () => {
    const report = computeCompanyCompleteness({
      companyId: 'cmp_2',
      name: 'Andreessen Horowitz',
      profile: 'financial_firm',
      metrics: [
        metric('cmp_2', 'aum', 42_000_000_000, 'verified'),
        metric('cmp_2', 'employees', 738, 'verified'),
        // Either member fills the company-value slot; estimated still counts.
        metric('cmp_2', 'valuation', 40_000_000_000, 'estimated'),
        metric('cmp_2', 'arr', 300_000_000, 'verified'),
      ],
    });
    expect(report.gaps).toEqual([]);
    expect(report.ready).toBe(true);
  });
});

describe('summarizeDeckCompleteness', () => {
  it('rolls up ready/blocked counts and the honest gap total', () => {
    const ready = computeCompanyCompleteness({
      companyId: 'cmp_2', name: 'Andreessen Horowitz', profile: 'financial_firm',
      metrics: [
        metric('cmp_2', 'aum', 42_000_000_000, 'verified'),
        metric('cmp_2', 'employees', 738, 'verified'),
        metric('cmp_2', 'valuation', 40_000_000_000, 'estimated'),
        metric('cmp_2', 'arr', 300_000_000, 'verified'),
      ],
    });
    const twoGaps = computeCompanyCompleteness({
      companyId: 'cmp_2', name: 'Andreessen Horowitz', profile: 'financial_firm',
      metrics: [metric('cmp_2', 'aum', 42_000_000_000, 'verified'), metric('cmp_2', 'employees', 738, 'verified')],
    });
    const threeGaps = computeCompanyCompleteness({
      companyId: 'cmp_1', name: 'OpenAI',
      metrics: [
        metric('cmp_1', 'employees', 3500, 'verified'),
        metric('cmp_1', 'arr', null, 'unknown'),
        metric('cmp_1', 'market_cap', null, 'unknown'),
      ],
    });
    expect(summarizeDeckCompleteness([ready, twoGaps, threeGaps])).toEqual({
      readyCompanies: 1,
      blockedCompanies: 2,
      totalGaps: 5,
    });
    expect(summarizeDeckCompleteness([])).toEqual({ readyCompanies: 0, blockedCompanies: 0, totalGaps: 0 });
  });
});

// ---------------------------------------------------------------------------
// ensureReportReadiness — the repository-level pass. Fixtures keep filled rows
// at user_verified: the facts projection only preserves machine-verified rows
// against retained original passages, which these harnesses need not carry.
// ---------------------------------------------------------------------------

function snapshot(metrics: CompanyMetric[]): RepoSnapshot {
  return {
    schemaVersion: 2,
    markets: [],
    decks: [],
    companies: [
      {
        id: 'cmp_1',
        name: 'OpenAI',
        oneLiner: 'Frontier AI research and deployment company.',
        websiteUrl: 'https://openai.com',
        logoUrl: null,
        hqLocation: 'San Francisco, CA',
        brandTheme: null,
      },
      {
        id: 'cmp_2',
        name: 'Microsoft Corporation',
        oneLiner: 'Cloud and productivity software.',
        websiteUrl: 'https://microsoft.com',
        logoUrl: null,
        hqLocation: 'Redmond, WA',
        brandTheme: null,
      },
    ],
    metrics,
    cards: [],
    viceClaims: [],
    dashboards: {},
    companyMarket: { cmp_1: 'Frontier AI', cmp_2: 'Cloud software' },
    opportunity: {},
    reports: [],
    savedCards: [],
    researchJobs: [],
    threads: [],
  } as unknown as RepoSnapshot;
}

function memoryStore(initial: RepoSnapshot): ResearchStore {
  let data: RepoSnapshot | null = initial;
  return {
    read: () => data,
    write: (snap: RepoSnapshot) => {
      data = snap;
    },
  };
}

describe('ensureReportReadiness', () => {
  it('kicks one un-escalated hunt for a gapped company, skips ready ones, and reports honest still-missing counts', async () => {
    const snap = snapshot([
      humanFact('cmp_1', 'arr', 13_000_000_000),
      humanFact('cmp_1', 'employees', 3500),
      ...(['employees', 'arr', 'users', 'valuation', 'market_cap'] as const)
        .map((metricType) => humanFact('cmp_2', metricType, 40)),
    ]);
    const ground = vi.fn(async (_prompt: string) => ({
      text: 'Research notes with no usable figures.',
      citations: [{ title: 'Reuters', url: 'https://reuters.com/openai' }],
      queries: [],
    }));
    const structure = vi.fn(async (_prompt: string, schema: { parse: (input: unknown) => unknown }) =>
      schema.parse({ figures: [] }));
    const repo = new GeminiRepository({ apiKey: 'k', store: memoryStore(snap), client: { ground, structure } as unknown as LlmClient });

    const result = await repo.ensureReportReadiness(['cmp_1', 'cmp_2']);

    // One hunt for the gapped company; the ready company spends nothing.
    expect(ground).toHaveBeenCalledTimes(1);
    expect(ground.mock.calls[0]![0]).not.toContain('ESCALATION PASS');
    expect(structure).toHaveBeenCalledTimes(1);
    expect(result.researched).toEqual(['cmp_1']);
    expect(result.reports[0]).toMatchObject({
      companyId: 'cmp_1',
      profile: 'operating_company',
      ready: false,
      gaps: [
        { metricType: 'users', label: 'Users', state: 'absent' },
        { metricType: 'market_cap', label: 'Market Cap', state: 'absent' },
      ],
    });
    expect(result.reports[1]).toMatchObject({ companyId: 'cmp_2', ready: true, gaps: [] });
    // Sources yielded nothing: the gaps stay honest instead of becoming figures.
    expect(result.stillMissing).toBe(2);
  });

  it('a successful hunt closes the gap it filled and readiness recomputes after research', async () => {
    const url = 'https://reuters.com/report';
    const quote = 'OpenAI reported 3500 employees as of 2026-10-01.';
    const ground = vi.fn(async () => ({
      text: 'Provider notes contain multiple proposed metrics.',
      citations: [{ title: 'Reuters', url }],
      queries: [],
    }));
    const structure = vi.fn(async (_prompt: string, schema: { parse: (input: unknown) => unknown }) =>
      schema.parse({
        figures: [{
          metricType: 'employees', value: 3500,
          passageSupport: { sourceUrl: url, quote, asOf: '2026-10-01', basis: 'employees', unit: 'count' },
        }],
      })) as unknown as LlmClient['structure'];
    const reader = vi.fn(async (requestedUrl: string) => ({
      requestedUrl, finalUrl: url, status: 'retrieved' as const, httpStatus: 200,
      contentHash: 'a'.repeat(64), text: quote, retrievedAt: '2026-10-05T00:00:00.000Z',
    }));
    const repo = new GeminiRepository({
      apiKey: 'k',
      store: memoryStore(snapshot([humanFact('cmp_1', 'arr', 13_000_000_000)])),
      client: { ground, structure } as unknown as LlmClient,
      originalSourceReader: reader,
    });

    const result = await repo.ensureReportReadiness(['cmp_1']);

    expect(result.researched).toEqual(['cmp_1']);
    // employees was absent → filled by the hunt; users and the company-value
    // slot remain honestly open (either valuation or market_cap would close it).
    expect(result.reports[0]).toMatchObject({
      companyId: 'cmp_1',
      ready: false,
      gaps: [
        { metricType: 'users', label: 'Users', state: 'absent' },
        { metricType: 'market_cap', label: 'Market Cap', state: 'absent' },
      ],
    });
    expect(result.stillMissing).toBe(2);
    expect((await repo.getCompanyFacts('cmp_1')).find((m) => m.metricType === 'employees'))
      .toMatchObject({ value: 3500, confidence: 'verified' });
  });

  it('skips unknown company ids instead of inventing a report', async () => {
    const ground = vi.fn();
    const repo = new GeminiRepository({
      apiKey: 'k',
      store: memoryStore(snapshot([])),
      client: { ground } as unknown as LlmClient,
    });
    const result = await repo.ensureReportReadiness(['cmp_missing']);
    expect(result).toEqual({ reports: [], researched: [], stillMissing: 0 });
    expect(ground).not.toHaveBeenCalled();
  });
});
