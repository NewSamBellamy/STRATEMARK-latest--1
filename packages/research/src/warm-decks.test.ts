/**
 * Navigation reads saved research only. Accepted research-run warm-ups and
 * explicit section research share in-flight work without duplicate spend.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

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

describe('getDashboardTab cached reads', () => {
  function withSavedOverview(): RepoSnapshot {
    const saved = snapshotWithCompany();
    saved.dashboards.cmp_1 = {
      overview: {
        content: { markdown: 'Saved earlier' },
        lastRefreshedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    return saved;
  }

  it('a missing saved section does not call a provider or write', async () => {
    const ground = vi.fn().mockRejectedValue(new Error('must not call'));
    const structure = vi.fn();
    const store = memoryStore(snapshotWithCompany());
    const write = vi.spyOn(store, 'write');
    const repo = new GeminiRepository({
      store,
      client: { ground, structure } as unknown as LlmClient,
    });

    expect(await repo.getDashboardTab('cmp_1', 'overview')).toBeNull();
    expect(await repo.getDashboardTab('cmp_1', 'overview', false)).toBeNull();
    expect(ground).not.toHaveBeenCalled();
    expect(structure).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('reading during an explicit research pass does not wait for or start research', async () => {
    let finish!: (value: { text: string; citations: never[]; queries: string[] }) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const ground = vi.fn().mockReturnValue(pending);
    const structure = vi.fn().mockResolvedValue({ markdown: 'sourced overview' });
    const repo = new GeminiRepository({
      store: memoryStore(snapshotWithCompany()),
      client: { ground, structure } as unknown as LlmClient,
    });
    const research = repo.getDashboardTab('cmp_1', 'overview', true);
    const savedRead = repo.getDashboardTab('cmp_1', 'overview');
    // Fail quickly on the old implementation without leaving an unresolved test.
    const result = await Promise.race([savedRead, Promise.resolve('joined research')]);
    finish({ text: 'notes', citations: [], queries: [] });
    await research;
    expect(result).toBeNull();
    expect(ground).toHaveBeenCalledTimes(1);
  });

  it('refuses explicit paid work before dispatch when the stored snapshot was replaced', async () => {
    const ground = vi.fn().mockResolvedValue({ text: 'notes', citations: [], queries: [] });
    const store = memoryStore(snapshotWithCompany());
    const repo = new GeminiRepository({
      store,
      client: { ground, structure: vi.fn() } as unknown as LlmClient,
    });
    store.write({ ...snapshotWithCompany(), companyMarket: { cmp_1: 'Replaced' } });
    await expect(repo.getDashboardTab('cmp_1', 'overview', true)).rejects.toMatchObject({
      code: 'REPOSITORY_OWNERSHIP_LOST',
    });
    expect(ground).not.toHaveBeenCalled();
  });

  it('saved content remains readable during and after a failed refresh; retry starts one new run', async () => {
    let fail!: (reason: Error) => void;
    const pending = new Promise((_resolve, reject) => {
      fail = reject;
    });
    const ground = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockResolvedValue({ text: 'new notes', citations: [], queries: [] });
    const repo = new GeminiRepository({
      store: memoryStore(withSavedOverview()),
      client: {
        ground,
        structure: vi.fn().mockResolvedValue({ markdown: 'New sourced overview' }),
      } as unknown as LlmClient,
    });
    const saved = await repo.getDashboardTab('cmp_1', 'overview');
    const refresh = repo.getDashboardTab('cmp_1', 'overview', true);
    const failed = expect(refresh).rejects.toThrow('Provider unavailable');
    expect(await repo.getDashboardTab('cmp_1', 'overview')).toEqual(saved);
    fail(new Error('Provider unavailable'));
    await failed;
    expect(await repo.getDashboardTab('cmp_1', 'overview')).toEqual(saved);
    const retried = await repo.getDashboardTab('cmp_1', 'overview', true);
    expect(retried?.content).toEqual({ markdown: 'New sourced overview' });
    expect(ground).toHaveBeenCalledTimes(2);
  });

  it('a storage failure cannot replace the saved view in memory', async () => {
    const store = memoryStore(withSavedOverview());
    const ground = vi.fn().mockResolvedValue({ text: 'new notes', citations: [], queries: [] });
    const repo = new GeminiRepository({
      store,
      client: {
        ground,
        structure: vi.fn().mockResolvedValue({ markdown: 'Uncommitted' }),
      } as unknown as LlmClient,
    });
    const saved = await repo.getDashboardTab('cmp_1', 'overview');
    vi.spyOn(store, 'write').mockImplementationOnce(() => {
      throw new Error('Disk unavailable');
    });
    await expect(repo.getDashboardTab('cmp_1', 'overview', true)).rejects.toThrow(
      'Disk unavailable',
    );
    expect(await repo.getDashboardTab('cmp_1', 'overview')).toEqual(saved);
    expect(store.read()?.dashboards.cmp_1?.overview?.content).toEqual(saved?.content);
  });
});

describe('getDashboardTab explicit research in-flight dedupe', () => {
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
    });

    // Fire both BEFORE the research resolves — a true race.
    const a = repo.getDashboardTab('cmp_1', 'overview', true);
    const b = repo.getDashboardTab('cmp_1', 'overview', true);
    resolveGround!({ text: 'notes', citations: [], queries: [] });
    const [ra, rb] = await Promise.all([a, b]);

    expect(ground).toHaveBeenCalledTimes(1); // ONE grounded pass, not two
    expect(ra?.content).toEqual(rb?.content);
  });

  it('after completion the result is served from cache with no new research', async () => {
    const ground = vi.fn().mockResolvedValue({ text: 'notes', citations: [], queries: [] });
    const structure = vi.fn().mockResolvedValue({ markdown: 'sourced overview' });
    const client = { ground, structure } as unknown as LlmClient;
    const repo = new GeminiRepository({
      apiKey: 'k',
      store: memoryStore(snapshotWithCompany()),
      client,
    });

    await repo.getDashboardTab('cmp_1', 'overview', true);
    await repo.getDashboardTab('cmp_1', 'overview');
    expect(ground).toHaveBeenCalledTimes(1);
  });

  it('different tabs research independently (no false sharing)', async () => {
    const ground = vi.fn().mockResolvedValue({ text: 'notes', citations: [], queries: [] });
    const structure = vi.fn().mockResolvedValue({ markdown: 'x', nodes: [], items: [] });
    const client = { ground, structure } as unknown as LlmClient;
    const repo = new GeminiRepository({
      apiKey: 'k',
      store: memoryStore(snapshotWithCompany()),
      client,
    });

    await Promise.all([
      repo.getDashboardTab('cmp_1', 'overview', true),
      repo.getDashboardTab('cmp_1', 'live_intel', true),
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
