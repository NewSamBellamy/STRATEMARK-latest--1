/**
 * Latest wins: a figure found by a hunt only replaces the stored one when the
 * evidence says it should. The old figure is kept in history with its date;
 * an older or less authoritative one never displaces a better stored figure;
 * two current figures that disagree keep the better and record the conflict.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import { resolveAgainstPrior } from './metric-assessment';
import type { LlmClient } from './types';

const URL_NEW = 'https://reuters.com/openai-headcount';

function seed(stored: Partial<CompanyMetric>): RepoSnapshot {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2, markets: [], decks: [],
    companies: [{ id: 'cmp_1', name: 'OpenAI', oneLiner: 'Frontier AI research and deployment company.',
      websiteUrl: 'https://openai.com', logoUrl: null, hqLocation: null, brandTheme: null }],
    metrics: [{ id: 'met_emp', companyId: 'cmp_1', metricType: 'employees', value: 3000, confidence: 'estimated',
      source: 'https://www.bloomberg.com/old', citations: [{ title: 'Bloomberg', url: 'https://www.bloomberg.com/old' }],
      methodNote: 'Reported by Bloomberg.', capturedAt: now, ...stored }],
    cards: [], viceClaims: [], dashboards: {}, companyMarket: { cmp_1: 'Frontier AI' }, opportunity: {},
    reports: [], savedCards: [], researchJobs: [], threads: [],
  } as unknown as RepoSnapshot;
}

const memoryStore = (initial: RepoSnapshot): ResearchStore => {
  let data: RepoSnapshot | null = initial;
  return { read: () => data, write: (snap: RepoSnapshot) => { data = snap; } };
};

/** A hunt whose single original page states `value` employees as of `asOf`. */
async function hunt(stored: Partial<CompanyMetric>, value: number, asOf: string, options?: { refreshStale?: boolean }) {
  const quote = `OpenAI reported ${value} employees as of ${asOf}.`;
  const ground = vi.fn(async () => ({ text: 'Research', citations: [{ title: 'Reuters', url: URL_NEW }], queries: [] }));
  const structure = vi.fn(async (_prompt: string, schema: { parse: (v: unknown) => unknown }) => schema.parse({ figures: [{
    metricType: 'employees', value, passageSupport: { sourceUrl: URL_NEW, quote, asOf, basis: 'employees', unit: 'count' },
  }] })) as LlmClient['structure'];
  const repo = new GeminiRepository({ apiKey: 'k', store: memoryStore(seed(stored)), client: { ground, structure },
    originalSourceReader: async (requestedUrl) => ({ requestedUrl, finalUrl: URL_NEW, status: 'retrieved', httpStatus: 200,
      text: quote, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-06T00:00:00.000Z' }) });
  const result = await repo.huntCompanyMetrics('cmp_1', options);
  return { result, row: result.metrics.find((m) => m.metricType === 'employees')! };
}

const quoted = (asOf: string) => ({ quotedSupport: { sourceUrl: 'https://www.bloomberg.com/old', quote: 'q', asOf, value: 3000, unit: 'count' } }) as Partial<CompanyMetric>;

describe('latest wins in a hunt', () => {
  it('a newer figure supersedes a dated old one, and the old one is kept in history with its date', async () => {
    const { result, row } = await hunt(quoted('2024-01-15'), 3500, '2026-10-01');
    expect(result.filledTypes).toEqual(['employees']);
    expect(row.value).toBe(3500);
    expect(row.confidence).toBe('verified');
    expect(row.priorFigures).toHaveLength(1);
    expect(row.priorFigures![0]).toMatchObject({ value: 3000, confidence: 'estimated', asOf: '2024-01-15', source: 'https://www.bloomberg.com/old' });
    expect(row.priorFigures![0]!.reason).toMatch(/current|newer/i);
  });

  it('an older figure never displaces a newer stored one; the row is put back untouched', async () => {
    const { result, row } = await hunt(quoted('2026-10-01'), 3500, '2025-12-01');
    expect(result.filledTypes).toEqual([]);
    expect(row.value).toBe(3000);
    expect(row.confidence).toBe('estimated');
    expect(row.priorFigures).toBeUndefined();
  });

  it('two current figures that disagree keep the better one and record the conflict as a note', async () => {
    const { row } = await hunt(quoted('2026-10-01'), 3500, '2025-12-01');
    expect(row.methodNote).toMatch(/Two current sources disagree \(3000 vs 3500\)/);
  });

  it('a newer figure that disagrees with a current one records the conflict and keeps both values traceable', async () => {
    const { row } = await hunt(quoted('2025-12-01'), 3500, '2026-10-01');
    expect(row.value).toBe(3500);
    expect(row.methodNote).toMatch(/Two current sources disagree/);
    expect(row.priorFigures![0]).toMatchObject({ value: 3000, asOf: '2025-12-01' });
  });
});

describe('refreshing a stale figure', () => {
  it('re-hunts a verified figure whose evidence is undated, and a newer figure replaces it with history kept', async () => {
    const { result, row } = await hunt({ confidence: 'verified', lastVerifiedAt: new Date().toISOString(), staleAfterSeconds: 86_400 }, 3500, '2026-10-01', { refreshStale: true });
    expect(result.filledTypes).toEqual(['employees']);
    expect(row).toMatchObject({ value: 3500, confidence: 'verified' });
    expect(row.priorFigures).toHaveLength(1);
    expect(row.priorFigures![0]).toMatchObject({ value: 3000, confidence: 'verified' });
  });

  it('records the old figure date in history when a stale figure is superseded', async () => {
    const stored = quoted('2024-01-15');
    const { result, row } = await hunt({ ...stored, confidence: 'verified' }, 3500, '2025-12-01', { refreshStale: true });
    expect(result.filledTypes).toEqual(['employees']);
    expect(row.priorFigures![0]!.asOf).toBe('2024-01-15');
  });
});

describe('resolveAgainstPrior', () => {
  const NOW = new Date('2026-10-21T12:00:00.000Z');
  const row = (over: Partial<CompanyMetric>): CompanyMetric => ({ id: 'm', companyId: 'c', metricType: 'valuation', value: 1,
    confidence: 'estimated', source: 'https://www.reuters.com/a', citations: [{ title: 'Reuters', url: 'https://www.reuters.com/a' }],
    methodNote: null, capturedAt: '2026-01-01T00:00:00.000Z', ...over }) as CompanyMetric;

  it('has nothing to compare for an empty slot', () => {
    const fresh = row({ value: 5, assessment: { currency: { status: 'current', ageMonths: 1, horizonMonths: 12, basis: 'asOf', date: '2026-09' },
      authority: { tier: 'strong', reason: 'x' }, purpose: 'independent_reporting', independentSources: 1, companyReportedOnly: false, grade: 'strong', plainEnglish: [] } });
    expect(resolveAgainstPrior(fresh, null, NOW)).toBe(true);
    expect(resolveAgainstPrior(fresh, row({ value: null, confidence: 'unknown' }), NOW)).toBe(true);
    expect(fresh.priorFigures).toBeUndefined();
  });

  it('keeps at most eight superseded figures, newest last', () => {
    const history = Array.from({ length: 8 }, (_, i) => ({ value: i, confidence: 'estimated' as const, source: null, asOf: null,
      capturedAt: '2026-01-01T00:00:00.000Z', supersededAt: '2026-02-01T00:00:00.000Z', reason: 'r' }));
    const fresh = row({ value: 9, assessment: { currency: { status: 'current', ageMonths: 1, horizonMonths: 12, basis: 'asOf', date: '2026-09' },
      authority: { tier: 'strong', reason: 'x' }, purpose: 'independent_reporting', independentSources: 1, companyReportedOnly: false, grade: 'strong', plainEnglish: [] } });
    expect(resolveAgainstPrior(fresh, row({ value: 7, priorFigures: history }), NOW)).toBe(true);
    expect(fresh.priorFigures).toHaveLength(8);
    expect(fresh.priorFigures![7]!.value).toBe(7);
    expect(fresh.priorFigures![0]!.value).toBe(1);
  });
});
