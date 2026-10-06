/**
 * Warm decks — the latency fix for "click a tab, wait 30 seconds".
 *
 * The load-bearing correctness piece is the in-flight dedupe: a user click,
 * the living runtime's prefetch, and the creation-time warm worker can all
 * race on the SAME company tab. Before this, each racer fired its own full
 * grounded research pass — double/triple spend and a slower answer for the
 * user. Now the second caller awaits the first caller's promise.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';
const unavailableOriginal = async (url: string) => ({ requestedUrl: url, status: 'unavailable' as const, retrievedAt: new Date().toISOString() });

function snapshotWithCompany(): RepoSnapshot {
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
    ],
    metrics: [],
    cards: [],
    viceClaims: [],
    dashboards: {},
    companyMarket: { cmp_1: 'Frontier AI' },
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

describe('getDashboardTab in-flight dedupe', () => {
  it('shares one direct official read and preserves its cited overview after repository reopen without discovery spend', async () => {
    const quote = 'OpenAI develops research tools for businesses and independent researchers.';
    const ground = vi.fn().mockRejectedValue(new Error('Unexpected paid discovery'));
    const structure = vi.fn().mockResolvedValue({ excerpts: [{ sourceUrl: 'https://openai.com/', quote }] });
    const reader = vi.fn().mockResolvedValue({ requestedUrl: 'https://openai.com', finalUrl: 'https://openai.com/',
      status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), text: quote, retrievedAt: new Date().toISOString() });
    const store = memoryStore(snapshotWithCompany());
    const options = { apiKey: 'k', store, client: { ground, structure } as unknown as LlmClient, originalSourceReader: reader };
    const repo = new GeminiRepository(options);
    const [normal, forced] = await Promise.all([repo.getDashboardTab('cmp_1', 'overview'), repo.getDashboardTab('cmp_1', 'overview', true)]);
    expect(normal?.content.markdown).toContain(quote);
    expect(forced).toEqual(normal);
    expect(normal?.citations).toEqual([expect.objectContaining({ url: 'https://openai.com/' })]);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(ground).not.toHaveBeenCalled();
    expect(structure).toHaveBeenCalledTimes(1);
    const reopened = await new GeminiRepository(options).getDashboardTab('cmp_1', 'overview');
    expect(reopened?.content).toEqual(normal?.content);
    expect(reopened?.citations).toEqual(normal?.citations);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(structure).toHaveBeenCalledTimes(1);
  });
  it('two concurrent requests for the same tab share ONE research pass', async () => {
    let resolveGround: (v: { text: string; citations: never[]; queries: string[] }) => void;
    const groundPromise = new Promise((r) => {
      resolveGround = r as typeof resolveGround;
    });
    const ground = vi.fn().mockReturnValue(groundPromise);
    const structure = vi.fn().mockResolvedValue({ markdown: 'sourced overview' });
    const client = { ground, structure } as unknown as LlmClient;
    const repo = new GeminiRepository({
      apiKey: 'k',
      store: memoryStore(snapshotWithCompany()),
      client,
      originalSourceReader: unavailableOriginal,
    });

    // Fire both BEFORE the research resolves — a true race.
    const a = repo.getDashboardTab('cmp_1', 'overview');
    const b = repo.getDashboardTab('cmp_1', 'overview');
    resolveGround!({ text: 'notes', citations: [], queries: [] });
    const [ra, rb] = await Promise.all([a, b]);

    expect(ground).toHaveBeenCalledTimes(1); // ONE grounded pass, not two
    expect(ra?.content).toEqual(rb?.content);
  });

  it('after completion the result is served from cache with no new research', async () => {
    const ground = vi
      .fn()
      .mockResolvedValue({ text: 'notes', citations: [], queries: [] });
    const structure = vi.fn().mockResolvedValue({ markdown: 'sourced overview' });
    const client = { ground, structure } as unknown as LlmClient;
    const repo = new GeminiRepository({
      apiKey: 'k',
      store: memoryStore(snapshotWithCompany()),
      client,
      originalSourceReader: unavailableOriginal,
    });

    await repo.getDashboardTab('cmp_1', 'overview');
    await repo.getDashboardTab('cmp_1', 'overview');
    expect(ground).toHaveBeenCalledTimes(1);
  });

  it('different tabs research independently (no false sharing)', async () => {
    const ground = vi
      .fn()
      .mockResolvedValue({ text: 'notes', citations: [], queries: [] });
    const structure = vi
      .fn()
      .mockResolvedValue({ markdown: 'x', nodes: [], items: [] });
    const client = { ground, structure } as unknown as LlmClient;
    const repo = new GeminiRepository({
      apiKey: 'k',
      store: memoryStore(snapshotWithCompany()),
      client,
      originalSourceReader: unavailableOriginal,
    });

    await Promise.all([
      repo.getDashboardTab('cmp_1', 'overview'),
      repo.getDashboardTab('cmp_1', 'live_intel'),
    ]);
    expect(ground.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('refreshDeck = update sweep, not rebuild', () => {
  function snapshotWithDeck(): RepoSnapshot {
    const now = new Date().toISOString();
    const base = snapshotWithCompany() as unknown as {
      markets: unknown[];
      decks: unknown[];
      cards: unknown[];
      metrics: unknown[];
    };
    base.markets = [
      {
        id: 'mkt_1',
        name: 'Frontier AI',
        scopeDefinition: { vertical: 'AI', geography: null, notes: null },
        refreshCadence: 'weekly',
        createdAt: now,
      },
    ];
    base.decks = [{ id: 'deck_1', marketId: 'mkt_1', createdAt: now, lastRefreshedAt: null }];
    base.cards = [
      {
        id: 'card_1',
        deckId: 'deck_1',
        companyId: 'cmp_1',
        cardType: 'company',
        title: null,
        summary: null,
        tier: 7,
        tierReason: null,
        citations: [],
        keyPoints: [],
        createdAt: now,
      },
    ];
    base.metrics = [
      {
        id: 'met_arr',
        companyId: 'cmp_1',
        metricType: 'arr',
        value: 40_000_000_000,
        confidence: 'verified',
        source: 'https://reuters.com/x',
        citations: [{ title: 'reuters.com', url: 'https://reuters.com/x' }],
        methodNote: null,
        capturedAt: now,
        lastVerifiedAt: now,
        staleAfterSeconds: 86_400,
      },
      {
        id: 'met_users',
        companyId: 'cmp_1',
        metricType: 'users',
        value: 900_000_000,
        confidence: 'user_verified',
        source: 'Analyst confirmed',
        citations: [],
        methodNote: null,
        capturedAt: now,
      },
    ];
    return base as unknown as RepoSnapshot;
  }

  it('marks machine metrics due immediately, preserves human overrides, keeps cards', async () => {
    // expandDeck's hunt will fail against this stub client — the sweep must stand anyway.
    const client = {
      ground: vi.fn().mockRejectedValue(new Error('no live research in this test')),
      structure: vi.fn().mockRejectedValue(new Error('no live research in this test')),
    } as unknown as LlmClient;
    const repo = new GeminiRepository({
      apiKey: 'k',
      store: memoryStore(snapshotWithDeck()),
      client,
    });

    const before = await repo.listCards('deck_1');
    const deck = await repo.refreshDeck('mkt_1');
    const after = await repo.listCards('deck_1');

    // Non-destructive: same cards, refresh stamped.
    expect(after.map((c) => c.card.id)).toEqual(before.map((c) => c.card.id));
    expect(deck.lastRefreshedAt).toBeTruthy();

    const metrics = await repo.getCompanyMetrics('cmp_1');
    const arr = metrics.find((m) => m.metricType === 'arr')!;
    const users = metrics.find((m) => m.metricType === 'users')!;
    // The verified figure is queued for re-verification (due now)…
    expect(arr.lastVerifiedAt ?? null).toBeNull();
    expect(arr.staleAfterSeconds).toBe(1);
    expect(arr.value).toBe(40_000_000_000); // value untouched until re-verified
    // …but the human's figure is never rescheduled.
    expect(users.confidence).toBe('user_verified');
    expect(users.staleAfterSeconds ?? null).not.toBe(1);
  });
});
