/**
 * The existing dashboard refresh also re-hunts fast-moving figures (valuation, round,
 * total raised, ARR) whose assessment is stale, undated or aging. Bounded: one hunt per
 * company, a fixed number of companies, most out of date first, once per refresh,
 * sequential, and never the same figure again within 30 days; a failed look never blocks
 * the refresh.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';

const NOW = new Date().toISOString();
const FRESH = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

function deckOf(companies: Array<{ id: string; fresh: boolean; asOf?: string }>): RepoSnapshot {
  return {
    schemaVersion: 2,
    markets: [{ id: 'mkt_1', name: 'Frontier AI', scopeDefinition: { vertical: 'AI', geography: null, notes: null }, refreshCadence: 'weekly', createdAt: NOW }],
    decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: NOW, lastRefreshedAt: null }],
    companies: companies.map((c) => ({ id: c.id, name: `Co ${c.id}`, oneLiner: 'A company.', websiteUrl: `https://${c.id}.example`, logoUrl: null, hqLocation: null, brandTheme: null })),
    cards: companies.map((c) => ({ id: `card_${c.id}`, deckId: 'deck_1', companyId: c.id, cardType: 'company', title: null, summary: null,
      tier: 7, tierReason: null, citations: [], keyPoints: [], createdAt: NOW })),
    metrics: companies.map((c) => ({ id: `met_${c.id}`, companyId: c.id, metricType: 'valuation', value: 3_000_000_000, confidence: 'verified',
      source: 'https://reuters.com/x', citations: [{ title: 'Reuters', url: 'https://reuters.com/x' }], methodNote: null, capturedAt: NOW,
      lastVerifiedAt: NOW, staleAfterSeconds: 86_400,
      // Undated evidence is stale for our purposes; a recent stated period is not.
      ...(c.fresh || c.asOf ? { quotedSupport: { sourceUrl: 'https://reuters.com/x', quote: 'q', asOf: c.asOf ?? FRESH, value: 3_000_000_000, unit: 'USD' } } : {}) })),
    viceClaims: [], dashboards: {}, companyMarket: Object.fromEntries(companies.map((c) => [c.id, 'mkt_1'])),
    opportunity: {}, reports: [], savedCards: [], researchJobs: [], threads: [],
  } as unknown as RepoSnapshot;
}

function repoFor(snap: RepoSnapshot, huntStaleFigures = true, callThrough = false) {
  const client = { ground: vi.fn().mockRejectedValue(new Error('offline')), structure: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as LlmClient;
  const repo = new GeminiRepository({ apiKey: 'k', store: { read: () => snap, write: () => undefined }, client, huntStaleFigures });
  const hunt = vi.spyOn(repo, 'huntCompanyMetrics');
  if (!callThrough) hunt.mockResolvedValue({ filledTypes: [], metrics: [], retieredCardIds: [] });
  return { repo, hunt, client };
}
const refreshedIds = (hunt: ReturnType<typeof repoFor>['hunt']) =>
  hunt.mock.calls.filter(([, options]) => options?.refreshStale).map(([id]) => id);

describe('refreshDeck with HUNT_STALE_FIGURES switched off', () => {
  it('adds no hunt at all', async () => {
    const { repo, hunt } = repoFor(deckOf([{ id: 'stale', fresh: false }]), false);
    await repo.refreshDeck('mkt_1');
    expect(hunt.mock.calls.filter(([, options]) => options?.refreshStale)).toEqual([]);
  });
});

describe('refreshDeck re-hunts stale or undated figures (HUNT_STALE_FIGURES on)', () => {
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

  it('looks at the most out-of-date companies first: undated, then oldest', async () => {
    const { repo, hunt } = repoFor(deckOf([{ id: 'mid', fresh: false, asOf: daysAgo(200) }, { id: 'old', fresh: false, asOf: daysAgo(900) },
      { id: 'undated', fresh: false }, { id: 'fresh', fresh: true }]));
    await repo.refreshDeck('mkt_1');
    expect(refreshedIds(hunt)).toEqual(['undated', 'old', 'mid']);
  });

  it('never pays twice within 30 days for the same figure, so the next refresh reaches company 9 and later', async () => {
    const { repo, hunt, client } = repoFor(deckOf(Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, fresh: false }))), true, true);
    await repo.refreshDeck('mkt_1');
    const first = refreshedIds(hunt);
    expect(first).toHaveLength(8);
    hunt.mockClear();
    await repo.refreshDeck('mkt_1');
    const second = refreshedIds(hunt);
    expect(second.sort()).toEqual(Array.from({ length: 12 }, (_, i) => `c${i}`).filter((id) => !first.includes(id)).sort());
    hunt.mockClear();
    vi.mocked(client.ground).mockClear();
    // A third refresh (manual or the cadence auto-refresh) re-hunts nothing: every figure is in its cooldown.
    await repo.refreshDeck('mkt_1');
    expect(refreshedIds(hunt)).toEqual([]);
  });

  it('never re-hunts a slow-moving figure such as headcount', async () => {
    const snap = deckOf([{ id: 'stale', fresh: false }]);
    for (const m of snap.metrics) Object.assign(m, { metricType: 'employees', value: 3000 });
    const { repo, hunt } = repoFor(snap);
    await repo.refreshDeck('mkt_1');
    expect(refreshedIds(hunt)).toEqual([]);
  });

  it('a failed look never blocks the refresh', async () => {
    const { repo, hunt } = repoFor(deckOf([{ id: 'stale', fresh: false }]));
    hunt.mockRejectedValue(new Error('provider down'));
    const deck = await repo.refreshDeck('mkt_1');
    expect(deck.lastRefreshedAt).toBeTruthy();
  });
});
