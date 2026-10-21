/**
 * Undated estimates: a reported figure takes its date from its own source text
 * (a literal business date, else the END of the one period the text states),
 * never from the capture date. With neither, it stays undated and says so. A
 * financial firm's fee revenue is never stored as ARR.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { extractProviderGrounding } from './grounding-support';
import { reportedCompanyMetrics, reportedEmployeeBandRow, statedPeriodDate, statedPeriods, storedSupportDate } from './reported-metrics';
import { enrichmentOutSchema } from './schemas';
import { revalidateStoredMetrics } from './revalidate-stored';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient, ProviderGrounding } from './types';

const CAPTURED = '2026-10-01T00:00:00.000Z';
const SOURCE = 'https://www.example-news.com/story';

function grounding(segments: string[]) {
  const text = segments.join('\n\n');
  return { text, grounding: extractProviderGrounding(text, {
    groundingChunks: [{ web: { uri: SOURCE, title: 'example-news.com' } }],
    groundingSupports: segments.map((passage) => {
      const start = text.indexOf(passage);
      return { segment: { text: passage, startIndex: start, endIndex: start + passage.length }, groundingChunkIndices: [0] };
    }),
  }) };
}

function recovered(companyName: string, segments: string[], profile?: 'financial_firm' | 'operating_company') {
  const { text, grounding: g } = grounding(segments);
  return reportedCompanyMetrics({ companyId: 'co', companyName, website: null, enrichment: enrichmentOutSchema.parse({ metrics: {} }),
    text, grounding: g, capturedAt: CAPTURED, identity: { answerText: text, otherCompanies: [] }, profile });
}

describe('statedPeriods / statedPeriodDate', () => {
  it('dates a month/year or calendar-year period by its last day', () => {
    expect(statedPeriodDate('OLIPOP was valued at $1.85 billion in February 2025.')).toEqual({ asOf: '2025-02-28', stated: 'February 2025' });
    expect(statedPeriodDate('In 2024, Recess raised money at a $120 million valuation.')).toEqual({ asOf: '2024-12-31', stated: '2024' });
    expect(statedPeriodDate('Ares Management had $5.6 billion of revenue for 2024.')?.asOf).toBe('2024-12-31');
  });

  it('never dates from a founding year, a fiscal year, two periods or an unfinished period', () => {
    expect(statedPeriods('AG1 was founded in 2010 and is valued at $1.2 billion.')).toEqual([]);
    expect(statedPeriodDate('Revenue was $5 billion in fiscal 2024.')).toBeNull();
    expect(statedPeriodDate('Valued at $1 billion in 2023 and $2 billion in March 2025.')).toBeNull();
    expect(statedPeriodDate('Valued at $1 billion in 2026.', CAPTURED)).toBeNull();
  });

  it('defers to a literal business date when one is stated', () => {
    expect(statedPeriodDate('In 2025, AUM reached $60 billion as of September 30, 2025.')).toBeNull();
    expect(storedSupportDate('In 2025, AUM reached $60 billion as of September 30, 2025.', CAPTURED)).toBe('2025-09-30');
  });
});

describe('reportedCompanyMetrics — dating at write time', () => {
  it('dates a figure by the period its own support states', () => {
    const rows = recovered('OLIPOP', ['OLIPOP was valued at $1.85 billion in February 2025.']);
    const valuation = rows.find((row) => row.metricType === 'valuation');
    expect(valuation).toMatchObject({ value: 1.85e9, confidence: 'estimated' });
    expect(valuation?.reportedSupport?.asOf).toBe('2025-02-28');
    expect(valuation?.methodNote).toContain('the end of the period the source states (February 2025)');
  });

  it('keeps a figure with no stated date, explicitly undated (never the capture date)', () => {
    const rows = recovered('Athletic Greens', ['Athletic Greens is valued at $1.2 billion.']);
    const valuation = rows.find((row) => row.metricType === 'valuation');
    expect(valuation).toMatchObject({ value: 1.2e9, confidence: 'estimated' });
    expect(valuation?.reportedSupport?.asOf).toBeNull();
    expect(valuation?.methodNote).toContain('undated; reporting date not published');
  });

  it('dates an employee band by the period its sentence states', () => {
    const { text, grounding: g } = grounding(['Recess had 51-200 employees in 2024.']);
    const row = reportedEmployeeBandRow({ companyId: 'co', companyName: 'Recess', website: null, text, grounding: g, capturedAt: CAPTURED });
    expect(row?.reportedBand?.asOf).toBe('2024-12-31');
    expect(row?.methodNote).toContain('as of 2024-12-31, the end of the period the source states (2024)');
  });
});

describe('financial firms — revenue is not ARR', () => {
  it('stores an asset manager\'s annual revenue under its true definition', () => {
    const rows = recovered('Ares Management', ['Ares Management reported annual revenue of $5.6 billion for 2024.'], 'financial_firm');
    const arr = rows.find((row) => row.metricType === 'arr');
    expect(arr).toMatchObject({ value: 5.6e9, confidence: 'estimated' });
    expect(arr?.reportedSupport?.definition).toBe('annual_revenue');
  });

  it('refuses an "ARR" label on a financial firm\'s figure', () => {
    const segment = 'Ares Management ARR: $5.6 billion in 2024.';
    expect(recovered('Ares Management', [segment]).find((row) => row.metricType === 'arr')?.value).toBe(5.6e9);
    expect(recovered('Ares Management', [segment], 'financial_firm').find((row) => row.metricType === 'arr')?.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stored data: the same rules applied once to rows written before them.
// ---------------------------------------------------------------------------

const olipop = { id: 'co_olipop', name: 'OLIPOP', oneLiner: 'OLIPOP makes prebiotic soda.', websiteUrl: null };
const ag1 = { id: 'co_ag1', name: 'AG1', oneLiner: 'AG1 makes a daily nutrition drink.', websiteUrl: null };
const ares = { id: 'co_ares', name: 'Ares Management', oneLiner: 'Ares Management is a global alternative asset manager.', websiteUrl: null };

function stored(company: { id: string; name: string }, type: CompanyMetric['metricType'], value: number, text: string,
  definition: string | undefined, extra: Partial<CompanyMetric> = {}): CompanyMetric {
  return {
    id: `met_${company.id}_${type}`, companyId: company.id, metricType: type, value, confidence: 'estimated',
    source: SOURCE, citations: [{ title: 'example-news.com', url: SOURCE }],
    methodNote: `Source reported ${type}; provider-grounded, not verified against an original.`,
    capturedAt: CAPTURED, lastVerifiedAt: null, passageSupport: null,
    reportedSupport: { provider: 'google-search', companyName: company.name, basis: type, value, unit: 'USD', asOf: null,
      definition: definition as never,
      support: { supportIndex: 0, text, sources: [{ chunkIndex: 0, url: SOURCE, title: 'example-news.com' }] } },
    ...extra,
  } as CompanyMetric;
}

describe('revalidateStoredMetrics — v2 dating and relabelling', () => {
  const run = (metrics: CompanyMetric[]) => {
    const snapshot = { metricGateVersion: 1, companies: [olipop, ag1, ares], metrics, dashboards: {} };
    return { snapshot, outcome: revalidateStoredMetrics(snapshot) };
  };

  it('re-dates an undated stored estimate from its own support, and states the date in its note', () => {
    const { snapshot, outcome } = run([stored(olipop, 'valuation', 1.85e9, 'OLIPOP was valued at $1.85 billion in February 2025.', 'valuation')]);
    expect(snapshot.metrics[0]!.value).toBe(1.85e9);
    expect(snapshot.metrics[0]!.reportedSupport?.asOf).toBe('2025-02-28');
    expect(snapshot.metrics[0]!.methodNote).toContain('February 2025');
    expect(outcome.relabelled).toEqual([expect.objectContaining({ change: 'redated', asOf: '2025-02-28' })]);
  });

  it('keeps an undatable estimate but makes the missing date explicit', () => {
    const { snapshot, outcome } = run([stored(ag1, 'valuation', 1.2e9, 'AG1 is valued at $1.2 billion.', 'valuation')]);
    expect(snapshot.metrics[0]!).toMatchObject({ value: 1.2e9, confidence: 'estimated' });
    expect(snapshot.metrics[0]!.reportedSupport?.asOf).toBeNull();
    expect(snapshot.metrics[0]!.methodNote).toContain('undated; reporting date not published');
    expect(outcome.relabelled).toEqual([expect.objectContaining({ change: 'undated', asOf: null })]);
  });

  it('relabels a financial firm\'s stored ARR as annual revenue when its support says revenue', () => {
    const { snapshot, outcome } = run([stored(ares, 'arr', 5.6e9, 'Ares Management reported annual revenue of $5.6 billion for 2024.', 'arr')]);
    expect(snapshot.metrics[0]!.value).toBe(5.6e9);
    expect(snapshot.metrics[0]!.reportedSupport).toMatchObject({ definition: 'annual_revenue', asOf: '2024-12-31' });
    expect(outcome.relabelled[0]!.change).toBe('annual_revenue');
  });

  it('withdraws a financial firm\'s stored ARR when its support only says ARR', () => {
    const { snapshot, outcome } = run([stored(ares, 'arr', 5.6e9, 'Ares Management ARR: $5.6 billion in 2024.', undefined)]);
    expect(snapshot.metrics[0]!).toMatchObject({ value: null, confidence: 'unknown', reportedSupport: null });
    expect(outcome.reset).toEqual([expect.objectContaining({ gate: 'non_subscription_arr', previousValue: 5.6e9 })]);
  });

  it('never touches a human-verified figure', () => {
    const human = stored(ares, 'arr', 5.6e9, 'Ares Management ARR: $5.6 billion in 2024.', undefined, { confidence: 'user_verified' });
    const { snapshot, outcome } = run([human]);
    expect(snapshot.metrics[0]).toBe(human);
    expect(outcome.reset).toEqual([]);
    expect(outcome.relabelled).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Market batch: the model's missing date is filled from the support, and a
// financial firm's revenue slot is asked for, and stored, as annual revenue.
// ---------------------------------------------------------------------------

function batchSnapshot(): RepoSnapshot {
  const company = (id: string, name: string, oneLiner: string) =>
    ({ id, name, oneLiner, websiteUrl: null, logoUrl: null, hqLocation: null, brandTheme: null });
  return {
    schemaVersion: 2, markets: [], decks: [{ id: 'deck_1', marketId: 'mkt_1' }],
    companies: [company('co_olipop', 'OLIPOP', 'OLIPOP makes prebiotic soda.'),
      company('co_ares', 'Ares Management', 'Ares Management is a global alternative asset manager.')],
    metrics: [], cards: [
      { id: 'card_o', deckId: 'deck_1', cardType: 'company', companyId: 'co_olipop' },
      { id: 'card_a', deckId: 'deck_1', cardType: 'company', companyId: 'co_ares' },
    ],
    viceClaims: [], dashboards: {}, companyMarket: { co_olipop: 'M', co_ares: 'M' },
    opportunity: {}, reports: [], savedCards: [], researchJobs: [], threads: [], capturedAt: CAPTURED,
  } as unknown as RepoSnapshot;
}

describe('fillMissingMarketEstimates — dates and definitions', () => {
  it('dates a figure the model left undated from its support, and stores firm revenue as annual revenue', async () => {
    const olipopText = 'OLIPOP was valued at $1.85 billion in February 2025.';
    const aresText = 'Ares Management reported annual revenue of $5.6 billion for 2024.';
    const answer = `${olipopText}\n\n${aresText}`;
    const g: ProviderGrounding = { provider: 'google-search', answerText: answer, supports: [olipopText, aresText].map((text, i) =>
      ({ supportIndex: i, text, sources: [{ chunkIndex: 0, url: SOURCE, title: 'example-news.com' }] })) };
    const ground = vi.fn().mockResolvedValue({ text: answer, citations: [], queries: [], grounding: g });
    const structure = vi.fn().mockResolvedValue({ estimates: [
      { companyName: 'OLIPOP', metricType: 'valuation', value: 1.85e9, unit: 'USD', asOf: null, methodNote: 'Reported by example-news.' },
      { companyName: 'Ares Management', metricType: 'arr', value: 5.6e9, unit: 'USD', asOf: null, methodNote: 'Reported by example-news.' },
    ] });
    let data: RepoSnapshot | null = batchSnapshot();
    const store: ResearchStore = { read: () => data, write: (s: RepoSnapshot) => { data = s; } };
    const repo = new GeminiRepository({ apiKey: 'k', store, client: { ground, structure } as unknown as LlmClient });
    await repo.fillMissingMarketEstimates('deck_1');
    expect(String(ground.mock.calls[0]![0])).toMatch(/- Ares Management: [^\n]*Annual revenue/);
    expect(String(ground.mock.calls[0]![0])).not.toMatch(/- Ares Management: [^\n]*ARR/);
    const valuation = (await repo.getCompanyMetrics('co_olipop')).find((m) => m.metricType === 'valuation');
    expect(valuation?.reportedSupport?.asOf).toBe('2025-02-28');
    const revenue = (await repo.getCompanyMetrics('co_ares')).find((m) => m.metricType === 'arr');
    expect(revenue?.value).toBe(5.6e9);
    expect(revenue?.reportedSupport).toMatchObject({ definition: 'annual_revenue', asOf: '2024-12-31' });
  });
});
