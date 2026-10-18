/**
 * Search-first face pass (huntFacesFromSearch): a search engine's own snippets,
 * checked by the same reported-claim gate as a grounded answer, with no model
 * call and no paid search.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';
import type { WebSearchFn, WebSearchResult } from './web-search';

const VALUATION = 'Zenith raised $80 million in a Series B round led by Sequoia at a $600 million valuation, the company said on May 9, 2024.';
const EMPLOYEES = 'Zenith has approximately 450 employees, according to the company.';

const result = (url: string, title: string, snippet: string): WebSearchResult => ({ url, title, snippet });

function snapshot(metrics: unknown[] = []): RepoSnapshot {
  const now = new Date().toISOString();
  const company = (id: string, name: string, site: string) => ({ id, name, oneLiner: `${name} makes things.`, websiteUrl: site, logoUrl: null, hqLocation: 'Leeds', brandTheme: null });
  return { schemaVersion: 2, markets: [], decks: [{ id: 'deck_1', marketId: 'mkt_1' }],
    companies: [company('cmp_z', 'Zenith', 'https://zenith.example'), company('cmp_r', 'Rivalco', 'https://rivalco.example')],
    metrics, cards: [{ id: 'card_z', deckId: 'deck_1', cardType: 'company', companyId: 'cmp_z' }], viceClaims: [], dashboards: {},
    companyMarket: { cmp_z: 'Beauty', cmp_r: 'Beauty' }, opportunity: {}, reports: [], savedCards: [], researchJobs: [], threads: [], capturedAt: now } as unknown as RepoSnapshot;
}

function setup(opts: { engine?: WebSearchFn | null; news?: WebSearchFn | null; metrics?: unknown[] }) {
  let data: RepoSnapshot | null = snapshot(opts.metrics);
  const store: ResearchStore = { read: () => data, write: (s) => { data = s; } };
  const ground = vi.fn();
  const structure = vi.fn();
  const repo = new GeminiRepository({ apiKey: 'k', store, client: { ground, structure } as unknown as LlmClient,
    originalSourceReader: async (url: string) => ({ requestedUrl: url, status: 'unavailable' as const, retrievedAt: new Date().toISOString(), reason: 'n/a' }),
    ...(opts.engine !== undefined ? { webSearch: () => opts.engine ?? null } : {}),
    ...(opts.news !== undefined ? { newsSearch: () => opts.news ?? null } : {}) });
  return { repo, ground, structure };
}

const sources = [
  result('https://www.reuters.com/z1', 'Zenith raises funding', VALUATION),
  result('https://sifted.eu/z2', 'Zenith grows', EMPLOYEES),
];

describe('huntFacesFromSearch', () => {
  it('fills money and headcount slots from result snippets with no model call', async () => {
    const engine = vi.fn<WebSearchFn>(async () => sources);
    const { repo, ground, structure } = setup({ engine });
    const out = await repo.huntFacesFromSearch!(['cmp_z']);
    expect(out.cmp_z!.filledTypes).toEqual(expect.arrayContaining(['valuation', 'employees']));
    expect(ground).not.toHaveBeenCalled();
    expect(structure).not.toHaveBeenCalled();
    // The engine was asked for the past year only.
    expect(engine.mock.calls.every(([, options]) => options?.sinceDays === 366)).toBe(true);
    const rows = await repo.getCompanyMetrics('cmp_z');
    const valuation = rows.find((m) => m.metricType === 'valuation')!;
    expect(valuation).toMatchObject({ value: 600_000_000, confidence: 'estimated' });
    expect(valuation.reportedSupport).toMatchObject({ provider: 'page-quote' });
    expect(valuation.citations[0]!.url).toBe('https://www.reuters.com/z1');
    expect(rows.find((m) => m.metricType === 'employees')).toMatchObject({ value: 450, confidence: 'estimated' });
  });

  it('never fills Users or Distribution: a third-party snippet is not "the company\'s own site"', async () => {
    const reach = [result('https://www.reuters.com/z3', 'Zenith reach', 'Zenith serves more than 40,000 customers in 60 countries, the company said.')];
    const { repo } = setup({ engine: async () => reach });
    const out = await repo.huntFacesFromSearch!(['cmp_z']);
    expect(out.cmp_z!.filledTypes).not.toContain('users');
    expect(out.cmp_z!.filledTypes).not.toContain('distribution');
    const rows = await repo.getCompanyMetrics('cmp_z');
    for (const type of ['users', 'distribution'] as const) expect(rows.find((m) => m.metricType === type)?.value ?? null).toBeNull();
  });

  it('does nothing without the user\'s search key, even with the free news lane', async () => {
    const news = vi.fn<WebSearchFn>(async () => sources);
    const { repo, ground } = setup({ engine: null, news });
    expect(await repo.huntFacesFromSearch!(['cmp_z'])).toEqual({});
    expect(news).not.toHaveBeenCalled();
    expect(ground).not.toHaveBeenCalled();
    const bare = setup({});
    expect(await bare.repo.huntFacesFromSearch!(['cmp_z'])).toEqual({});
  });

  it('rejects a sentence that names a rival, and ignores results about another company', async () => {
    const joint = [result('https://www.reuters.com/j', 'Zenith and Rivalco', 'Zenith and Rivalco have a combined 900 employees, according to the companies.')];
    const a = setup({ engine: async () => joint });
    expect((await a.repo.huntFacesFromSearch!(['cmp_z'])).cmp_z!.filledTypes).not.toContain('employees');

    const other = [result('https://www.reuters.com/r', 'Rivalco raises funding',
      'Rivalco raised $50 million in a Series B round led by Sequoia at a $300 million valuation, the company said on May 9, 2024.')];
    const b = setup({ engine: async () => other });
    expect((await b.repo.huntFacesFromSearch!(['cmp_z'])).cmp_z!.filledTypes).toEqual([]);
    expect((await b.repo.getCompanyMetrics('cmp_z')).find((m) => m.metricType === 'valuation')?.value ?? null).toBeNull();
  });

  it('never overwrites a figure that already has a value', async () => {
    const existing = { id: 'met_v', companyId: 'cmp_z', metricType: 'valuation', value: 500_000_000, confidence: 'estimated',
      source: 'https://old.example/v', citations: [{ title: 'old', url: 'https://old.example/v' }], methodNote: 'earlier', capturedAt: new Date().toISOString() };
    const { repo } = setup({ engine: async () => sources, metrics: [existing] });
    await repo.huntFacesFromSearch!(['cmp_z']);
    expect((await repo.getCompanyMetrics('cmp_z')).find((m) => m.metricType === 'valuation')).toMatchObject({ value: 500_000_000, source: 'https://old.example/v' });
  });

  it('a failing search lane is skipped, never thrown', async () => {
    const engine = vi.fn(async () => { throw new Error('boom'); });
    const { repo, ground } = setup({ engine, news: async () => sources });
    const out = await repo.huntFacesFromSearch!(['cmp_z']);
    // The news lane still answered; the failing engine did not stop it.
    expect(out.cmp_z!.filledTypes).toEqual(expect.arrayContaining(['valuation']));
    expect(ground).not.toHaveBeenCalled();
  });
});
