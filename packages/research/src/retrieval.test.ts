/**
 * Corpus retrieval — relevance ranking, scoping, snippet quality, and the
 * askResearch wiring that makes accumulated research answerable.
 */
import { describe, expect, it, vi } from 'vitest';
import { searchEvidenceCorpus, type ScoredPassage } from './retrieval';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';
import type { ResearchEvidence } from './research-evidence';

function evidence(overrides: Partial<ResearchEvidence> & { id: string }): ResearchEvidence {
  return {
    companyId: 'cmp_1', companyName: 'Equinix, Inc.', topic: 'company_profile',
    capturedAt: '2026-10-01T00:00:00.000Z', text: 'Generic profile notes.', citations: [], queries: [],
    ...overrides,
  };
}

const CORPUS: ResearchEvidence[] = [
  evidence({ id: 'ev_1', text: 'Equinix reported annual revenues of $9.2 billion for fiscal 2025.' }),
  evidence({ id: 'ev_2', topic: 'metrics_hunt', capturedAt: '2026-10-05T00:00:00.000Z',
    text: 'The landscape of colocation providers across California, with pricing pressure from hyperscale competition.' }),
  evidence({ id: 'ev_3', companyId: 'cmp_2', companyName: 'Colovore, LLC',
    text: 'Colovore operates high-density liquid-cooled colocation facilities in Santa Clara.' }),
  evidence({ id: 'ev_4', topic: 'verify:employees', capturedAt: '2026-10-07T00:00:00.000Z',
    text: 'Verification attempt for employee headcount found no readable original.' }),
  evidence({ id: 'ev_5', companyId: 'cmp_2', companyName: 'Colovore, LLC', topic: 'metrics_hunt',
    text: 'Hunt for water usage in cooling: no public figure disclosed; operators report power usage effectiveness instead.',
    citations: [{ title: 'Utility report', url: 'https://example.com/water' }], queries: ['colovore water usage cooling'] }),
];

describe('searchEvidenceCorpus', () => {
  it('ranks the most on-topic record first across the whole corpus', () => {
    const hits = searchEvidenceCorpus(CORPUS, { query: 'water usage in cooling' });
    expect(hits[0]!.evidenceId).toBe('ev_5');
  });

  it('respects company scoping and topic filters', () => {
    const scoped = searchEvidenceCorpus(CORPUS, { query: 'colocation', companyIds: ['cmp_2'] });
    expect(scoped.every(hit => hit.companyId === 'cmp_2')).toBe(true);
    const topics = searchEvidenceCorpus(CORPUS, { query: 'headcount', topics: ['verify:employees'] });
    expect(topics.map(hit => hit.evidenceId)).toEqual(['ev_4']);
  });

  it('returns sentence-aligned snippets that contain the matching content', () => {
    const hits = searchEvidenceCorpus(CORPUS, { query: 'liquid-cooled facilities' });
    expect(hits[0]!.snippet).toContain('Colovore operates high-density liquid-cooled');
    expect(hits[0]!.snippet.length).toBeLessThanOrEqual(700);
  });

  it('carries the record citations through to the passage', () => {
    const hits = searchEvidenceCorpus(CORPUS, { query: 'water usage' });
    expect(hits[0]!.citations).toEqual([{ title: 'Utility report', url: 'https://example.com/water' }]);
  });

  it('ranks by recency when the query is empty (what do we have?)', () => {
    const hits = searchEvidenceCorpus(CORPUS, { query: '' });
    // Stable sort: ev_1/ev_3/ev_5 share a capturedAt, corpus order preserved.
    expect(hits.map(hit => hit.evidenceId)).toEqual(['ev_4', 'ev_2', 'ev_1', 'ev_3', 'ev_5']);
  });

  it('stays fast at multi-day corpus scale', () => {
    const big: ResearchEvidence[] = Array.from({ length: 2000 }, (_, i) => evidence({
      id: `ev_scale_${i}`, companyId: `cmp_${i % 40}`,
      text: `Scale record ${i}: colocation capacity, pricing, power, and headcount notes for company ${i % 40}.`,
    }));
    const start = performance.now();
    const hits: ScoredPassage[] = searchEvidenceCorpus(big, { query: 'pricing pressure headcount', limit: 8 });
    const ms = performance.now() - start;
    expect(hits.length).toBe(8);
    expect(ms).toBeLessThan(250);
  });
});

describe('askResearch — the archive answers before the web does', () => {
  it('retrieves corpus passages into the grounded prompt with their sources', async () => {
    const now = new Date().toISOString();
    const snap: RepoSnapshot = {
      schemaVersion: 2,
      markets: [], decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: now, lastRefreshedAt: now }],
      companies: [], metrics: [], cards: [], viceClaims: [], dashboards: {}, companyMarket: {}, opportunity: {},
      reports: [], briefings: [], savedCards: [], researchJobs: [], threads: [],
      researchEvidence: [evidence({ id: 'ev_archive', text: 'Water usage in cooling is undisclosed; operators report power usage effectiveness instead.',
        citations: [{ title: 'Utility report', url: 'https://example.com/water' }] })],
    } as unknown as RepoSnapshot;
    let store: RepoSnapshot | null = snap;
    const memory: ResearchStore = { read: () => store, write: (next) => { store = next; } };
    const ground = vi.fn().mockResolvedValue({ text: 'The archive says water usage is undisclosed.', citations: [], queries: [] });
    const repo = new GeminiRepository({
      apiKey: 'k', store: memory,
      client: { ground, structure: vi.fn() } as unknown as LlmClient,
    });

    await repo.askResearch({ scope: { kind: 'deck', deckId: 'deck_1' }, question: 'What is known about water usage in cooling?' });

    const prompt = ground.mock.calls[0]?.[0] as string;
    expect(prompt).toContain('LOCAL RESEARCH ARCHIVE');
    expect(prompt).toContain('Water usage in cooling is undisclosed');
    expect(prompt).toContain('https://example.com/water');
    expect(prompt).toContain('prefer them when they answer the question');
  });

  it('exposes the corpus search on the repository (contract capability)', async () => {
    const now = new Date().toISOString();
    const snap: RepoSnapshot = {
      schemaVersion: 2,
      markets: [], decks: [], companies: [], metrics: [], cards: [], viceClaims: [], dashboards: {},
      companyMarket: {}, opportunity: {}, reports: [], briefings: [], savedCards: [], researchJobs: [], threads: [],
      researchEvidence: CORPUS,
    } as unknown as RepoSnapshot;
    const repo = new GeminiRepository({
      apiKey: 'k', store: { read: () => snap, write: () => {} },
      client: { ground: vi.fn(), structure: vi.fn() } as unknown as LlmClient,
    });
    const passages = await repo.searchResearchCorpus({ query: 'liquid-cooled', companyIds: ['cmp_2'] });
    expect(passages.length).toBe(1);
    expect(passages[0]!.companyName).toBe('Colovore, LLC');
  });
});
