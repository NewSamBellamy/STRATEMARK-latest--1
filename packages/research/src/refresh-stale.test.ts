/**
 * The existing dashboard refresh also re-hunts figures whose assessment is stale
 * or undated. Bounded: one hunt per company, a fixed number of companies, once
 * per refresh, sequential; a failed look never blocks the refresh.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';

const NOW = new Date().toISOString();
const FRESH = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);

function deckOf(companies: Array<{ id: string; fresh: boolean }>): RepoSnapshot {
  return {
    schemaVersion: 2,
    markets: [{ id: 'mkt_1', name: 'Frontier AI', scopeDefinition: { vertical: 'AI', geography: null, notes: null }, refreshCadence: 'weekly', createdAt: NOW }],
    decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: NOW, lastRefreshedAt: null }],
    companies: companies.map((c) => ({ id: c.id, name: `Co ${c.id}`, oneLiner: 'A company.', websiteUrl: `https://${c.id}.example`, logoUrl: null, hqLocation: null, brandTheme: null })),
    cards: companies.map((c) => ({ id: `card_${c.id}`, deckId: 'deck_1', companyId: c.id, cardType: 'company', title: null, summary: null,
      tier: 7, tierReason: null, citations: [], keyPoints: [], createdAt: NOW })),
    metrics: companies.map((c) => ({ id: `met_${c.id}`, companyId: c.id, metricType: 'employees', value: 3000, confidence: 'verified',
      source: 'https://reuters.com/x', citations: [{ title: 'Reuters', url: 'https://reuters.com/x' }], methodNote: null, capturedAt: NOW,
      lastVerifiedAt: NOW, staleAfterSeconds: 86_400,
      // Undated evidence is stale for our purposes; a recent stated period is not.
      ...(c.fresh ? { quotedSupport: { sourceUrl: 'https://reuters.com/x', quote: 'q', asOf: FRESH, value: 3000, unit: 'count' } } : {}) })),
    viceClaims: [], dashboards: {}, companyMarket: Object.fromEntries(companies.map((c) => [c.id, 'mkt_1'])),
    opportunity: {}, reports: [], savedCards: [], researchJobs: [], threads: [],
  } as unknown as RepoSnapshot;
}

function repoFor(snap: RepoSnapshot) {
  const client = { ground: vi.fn().mockRejectedValue(new Error('offline')), structure: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as LlmClient;
  const repo = new GeminiRepository({ apiKey: 'k', store: { read: () => snap, write: () => undefined }, client });
  const hunt = vi.spyOn(repo, 'huntCompanyMetrics').mockResolvedValue({ filledTypes: [], metrics: [], retieredCardIds: [] });
  return { repo, hunt };
}

describe('refreshDeck re-hunts stale or undated figures', () => {
  it('asks for a fresh look at a company whose figure is undated, and skips one whose figure is current', async () => {
    const { repo, hunt } = repoFor(deckOf([{ id: 'stale', fresh: false }, { id: 'fresh', fresh: true }]));
    await repo.refreshDeck('mkt_1');
    const refreshed = hunt.mock.calls.filter(([, options]) => options?.refreshStale).map(([id]) => id);
    expect(refreshed).toEqual(['stale']);
  });

  it('is bounded: at most eight companies, one hunt each, once per refresh', async () => {
    const { repo, hunt } = repoFor(deckOf(Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, fresh: false }))));
    await repo.refreshDeck('mkt_1');
    const refreshed = hunt.mock.calls.filter(([, options]) => options?.refreshStale).map(([id]) => id);
    expect(refreshed).toHaveLength(8);
    expect(new Set(refreshed).size).toBe(8);
  });

  it('a failed look never blocks the refresh', async () => {
    const { repo, hunt } = repoFor(deckOf([{ id: 'stale', fresh: false }]));
    hunt.mockRejectedValue(new Error('provider down'));
    const deck = await repo.refreshDeck('mkt_1');
    expect(deck.lastRefreshedAt).toBeTruthy();
  });
});
