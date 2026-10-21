import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot } from './repository';
import { extractProviderGrounding } from './grounding-support';
import type { LlmClient } from './types';
import type { OriginalSourceReceipt, OriginalSourceServices } from './original-source';

vi.mock('./logos', () => ({ faviconUrl: () => null, resolveLogo: async () => ({ url: null }) }));

const WIKI = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/wiki';
const NEWS = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/news';
const WIKI_REAL = 'https://en.wikipedia.org/wiki/OpenAI';
const NEWS_REAL = 'https://explodingtopics.com/blog/openai-valuation';
const REUTERS = 'https://www.reuters.com/technology/openai-valuation';
const FT = 'https://www.ft.com/content/openai-valuation';
const quote = 'OpenAI is valued at $852 billion as of 2026-03-31.';

function setup(newsText: string) {
  const answer = `${quote} Other coverage exists.`;
  const client: LlmClient = {
    ground: vi.fn(async (prompt: string) => prompt.includes('re-check')
      // Verification search: reputable coverage that backs the figure.
      ? { text: 'OpenAI is valued at $852 billion, per Reuters.', queries: [], citations: [{ title: 'reuters.com', url: REUTERS }, { title: 'ft.com', url: FT }] }
      : ({ text: answer, queries: [],
      citations: [{ title: 'wikipedia.org', url: WIKI }, { title: 'explodingtopics.com', url: NEWS }],
      // Search grounding hangs the sentence on the Wikipedia chunk, not the article that states it.
      grounding: extractProviderGrounding(answer, {
        groundingChunks: [{ web: { uri: WIKI, title: 'wikipedia.org' } }, { web: { uri: NEWS, title: 'explodingtopics.com' } }],
        groundingSupports: [{ segment: { text: quote, startIndex: 0, endIndex: quote.length }, groundingChunkIndices: [0] }],
      }) })),
    structure: vi.fn(async (prompt, schema) => schema.parse(prompt.includes('"companies"')
      ? { companies: [{ name: 'OpenAI', domain: 'openai.com', descriptor: 'AI lab', cardTypes: ['company'] }] }
      : prompt.includes('BASE TIER') ? { nudge: 0, reason: 'Deterministic' }
        : prompt.includes('verification notes')
          // Search notes back the stored figure, but no original passage is quoted.
          ? { metrics: [{ metricType: 'valuation', verdict: 'supported', currentValue: 852e9, rationale: 'Reported widely.', methodNote: 'Press reports', passageSupport: null }] }
        : { metrics: { valuation: { value: 852e9, confidence: 'verified', sourceIndex: 0,
          reportedClaim: { sourceUrl: WIKI, quote, asOf: '2026-03-31', basis: 'valuation', unit: 'USD', definition: 'valuation' } } },
        facts: {} })) as LlmClient['structure'],
  };
  const pages: Record<string, OriginalSourceReceipt> = {
    [WIKI]: page(WIKI, WIKI_REAL, 'OpenAI was founded in 2015 in San Francisco by a group of researchers.'),
    [NEWS]: page(NEWS, NEWS_REAL, newsText),
    // Pages the verification search returns: readable, and they report the figure.
    [REUTERS]: page(REUTERS, REUTERS, 'OpenAI was valued at $852 billion in its latest round, Reuters reported.'),
    [FT]: page(FT, FT, 'OpenAI is now valued at $852 billion, the Financial Times reported.'),
  };
  const retrieve = vi.fn(async (url: string) => pages[url] ?? { requestedUrl: url, status: 'unavailable' as const, retrievedAt: '2026-10-13T00:00:00.000Z' });
  const originals: OriginalSourceServices = { retrieve, save: vi.fn(async () => {}), list: vi.fn(async () => []) };
  let saved = migrateSnapshot(null).snapshot;
  const options = { apiKey: 'test-placeholder', client, originalSources: originals,
    store: { read: () => structuredClone(saved), write: async (next: RepoSnapshot) => { saved = structuredClone(next); } } };
  return { retrieve, repo: new GeminiRepository(options) };
}

function page(requestedUrl: string, finalUrl: string, text: string): OriginalSourceReceipt {
  return { requestedUrl, finalUrl, status: 'retrieved', httpStatus: 200, text, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-13T00:00:00.000Z' };
}

async function researched(newsText: string) {
  const { repo, retrieve } = setup(newsText);
  const market = await repo.createMarket({ name: 'Frontier AI', scopeDefinition: { vertical: 'AI', geography: null, notes: null }, refreshCadence: 'weekly' });
  await repo.expandDeck(market.id, { cardType: 'company' });
  const deck = (await repo.getDeckByMarket(market.id))!;
  const company = (await repo.listCards(deck.id)).find((row) => row.company)!.company!;
  // One pass reads the cited page; the next looks at the rest of the same research.
  await repo.bindReportedSources(company.id);
  await repo.bindReportedSources(company.id);
  const valuation = (await repo.getCompanyFacts(company.id)).find((row) => row.metricType === 'valuation')!;
  return { valuation, retrieve };
}

describe('a figure the search attributed to the wrong page', () => {
  it('is shown, linked to the article that states it, once another page of the same research does', async () => {
    const { valuation, retrieve } = await researched('In March 2026 OpenAI closed a round at a post-money valuation of $852 billion.');
    expect(valuation).toMatchObject({ value: 852e9, confidence: 'estimated', source: NEWS_REAL });
    expect(valuation.citations).toEqual([{ url: NEWS_REAL, title: 'explodingtopics.com' }]);
    // Reads ask for the passage that carries the figure.
    expect(retrieve).toHaveBeenCalledWith(NEWS, expect.objectContaining({ metricType: 'valuation', values: [852e9] }));
  });

  it('stays hidden when no page of the research states it', async () => {
    const { valuation } = await researched('OpenAI released a new model this week and hired more researchers.');
    expect(valuation).toMatchObject({ value: null, confidence: 'unknown' });
  });
});

describe('batch verification without an original passage', () => {
  it('leaves a shown estimate as it was instead of promoting it to a "verified" row the card cannot show', async () => {
    const { repo } = setup('In March 2026 OpenAI closed a round at a post-money valuation of $852 billion.');
    const market = await repo.createMarket({ name: 'Frontier AI', scopeDefinition: { vertical: 'AI', geography: null, notes: null }, refreshCadence: 'weekly' });
    await repo.expandDeck(market.id, { cardType: 'company' });
    const deck = (await repo.getDeckByMarket(market.id))!;
    const company = (await repo.listCards(deck.id)).find((row) => row.company)!.company!;
    const before = (await repo.getCompanyFacts(company.id)).find((row) => row.metricType === 'valuation')!;
    expect(before).toMatchObject({ value: 852e9, confidence: 'estimated' });

    const result = await repo.verifyCompanyMetrics(company.id);
    expect(result.examined).toContain('valuation');

    const stored = (await repo.getCompanyMetrics(company.id)).find((row) => row.metricType === 'valuation')!;
    expect(stored).toMatchObject({ value: 852e9, confidence: 'estimated' });
    const after = (await repo.getCompanyFacts(company.id)).find((row) => row.metricType === 'valuation')!;
    expect(after).toMatchObject({ value: 852e9, confidence: 'estimated' });
  });
});
