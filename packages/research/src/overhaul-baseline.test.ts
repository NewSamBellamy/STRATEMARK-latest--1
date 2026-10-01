/**
 * G00 risk reproductions, not release acceptance. Synthetic data, no real key.
 * These ordinary tests deliberately remain RED until the named invariants are
 * implemented. Never skip/invert them to manufacture a healthy baseline.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  cardSchema,
  companyMetricSchema,
  reconcileMetrics,
  type ResearchJob,
  type Market,
  type Deck,
} from '@mi/contracts';
import {
  GeminiRepository,
  migrateSnapshot,
  REPO_SCHEMA_VERSION,
  type RepoSnapshot,
} from './repository';
import type { GroundedResult, LlmClient } from './types';

const pipeline = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('./pipeline', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runDeckResearch: pipeline.run,
}));

const AT = '2026-09-30T12:00:00.000Z';
function job(status: ResearchJob['status']): ResearchJob {
  return {
    id: 'run_fixture',
    status,
    stage: 'scope',
    brief: { prompt: 'Synthetic market', region: null },
    catalogNames: [],
    completedEntityNames: [],
    partialCards: [],
    warnings: [],
    error: null,
    createdAt: AT,
    updatedAt: AT,
  };
}
function snapshot(): RepoSnapshot {
  return {
    ...migrateSnapshot(null).snapshot,
    companies: [
      {
        id: 'co_fixture',
        name: 'Fixture Labs',
        oneLiner: 'Synthetic test company',
        logoUrl: null,
        websiteUrl: null,
        hqLocation: null,
        brandTheme: null,
      },
    ],
    companyMarket: { co_fixture: 'Synthetic market' },
  };
}
function market(id: string, name: string): Market {
  return {
    id,
    name,
    createdAt: AT,
    refreshCadence: 'daily',
    scopeDefinition: { vertical: 'Synthetic', geography: null, notes: null },
  };
}
function deck(id: string, marketId: string): Deck {
  return { id, marketId, createdAt: AT, lastRefreshedAt: null };
}
function card(id: string, deckId: string, companyId: string) {
  return cardSchema.parse({
    id,
    deckId,
    companyId,
    createdAt: AT,
    cardType: 'company',
    tier: null,
    tierReason: null,
    title: null,
    summary: null,
    citations: [],
  });
}
function memory(initial = snapshot()) {
  let current = structuredClone(initial);
  const writes: RepoSnapshot[] = [];
  return {
    store: {
      read: () => structuredClone(current),
      write: (next: RepoSnapshot) => {
        current = structuredClone(next);
        writes.push(current);
      },
    },
    replace: (next: RepoSnapshot) => {
      current = structuredClone(next);
    },
    read: () => structuredClone(current),
    writes,
  };
}
function client(
  ground = vi.fn(async (): Promise<GroundedResult> => ({
    text: 'Synthetic notes',
    citations: [],
    queries: [],
  })),
): LlmClient {
  return {
    ground,
    structure: async (_prompt, schema) => schema.parse({ markdown: 'Synthetic overview' }),
  };
}

describe('G00 UNRESOLVED baseline: cached reads, migration and writer fencing', () => {
  it('A04: opening an uncached section must not make a provider call', async () => {
    const llm = client();
    const repo = new GeminiRepository({ client: llm, store: memory().store });
    await repo.getDashboardTab('co_fixture', 'overview');
    expect(llm.ground).not.toHaveBeenCalled();
  });

  it('migration inspection must not rewrite active job status', () => {
    const source = snapshot();
    source.researchJobs = [job('running')];
    const inspected = migrateSnapshot(source);
    expect(inspected.snapshot.researchJobs[0]?.status).toBe('running');
    expect(source.researchJobs[0]?.status).toBe('running');
  });

  it('a future schema is refused before any provider call or repository write', () => {
    const source = { ...snapshot(), schemaVersion: REPO_SCHEMA_VERSION + 1 };
    const data = memory(source);
    const llm = client();
    // Construction refusal is stronger than permitting an unknown-shape reader:
    // no mutation path or paid work can start against the newer data format.
    expect(() => new GeminiRepository({ client: llm, store: data.store })).toThrow(
      /newer.*version/i,
    );
    expect(llm.ground).not.toHaveBeenCalled();
    expect(data.writes).toHaveLength(0);
    expect(data.read()).toEqual(source);
  });

  it('an old in-flight worker must not overwrite a replaced vault snapshot', async () => {
    const data = memory();
    let release!: (result: GroundedResult) => void;
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const pending = new Promise<GroundedResult>((resolve) => {
      release = resolve;
    });
    const llm = client(
      vi.fn(() => {
        began();
        return pending;
      }),
    );
    const oldOwner = new GeminiRepository({ client: llm, store: data.store });
    const oldRead = oldOwner.getDashboardTab('co_fixture', 'overview', true);
    await started;
    const replacement = migrateSnapshot(null).snapshot;
    data.replace(replacement);
    release({ text: 'Late synthetic response', citations: [], queries: [] });
    await expect(oldRead).rejects.toMatchObject({
      name: 'RepositoryOwnershipLostError',
      code: 'REPOSITORY_OWNERSHIP_LOST',
    });
    expect(data.read()).toEqual(replacement);
    expect(data.writes).toHaveLength(0);
  });

  it('metric records must retain reporting periods separately from retrieval time', () => {
    const period = { start: '2025-01-01', end: '2025-12-31' };
    const parsed = companyMetricSchema.parse({
      id: 'metric_fixture',
      companyId: 'co_fixture',
      metricType: 'arr',
      value: null,
      confidence: 'unknown',
      source: null,
      citations: [],
      methodNote: null,
      capturedAt: AT,
      period,
    });
    expect(parsed).toHaveProperty('period', period);
  });

  it('cancellation must remain requested until active work acknowledges or is fenced', async () => {
    const source = snapshot();
    source.researchJobs = [
      {
        ...job('failed'),
        marketPlan: {
          marketName: 'Synthetic market',
          vertical: 'Test',
          geography: null,
          notes: null,
          searchThemes: [],
        },
        market: {
          id: 'market_fixture',
          name: 'Synthetic market',
          createdAt: AT,
          scopeDefinition: { vertical: 'Test', geography: null, notes: null },
          refreshCadence: 'daily',
        },
        deck: {
          id: 'deck_fixture',
          marketId: 'market_fixture',
          createdAt: AT,
          lastRefreshedAt: null,
        },
        catalog: [],
        brief: { prompt: 'Synthetic market', region: null },
      },
    ];
    let rejectProvider!: (error: Error) => void;
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const pending = new Promise<never>((_resolve, reject) => {
      rejectProvider = reject;
    });
    pipeline.run.mockImplementationOnce(() => {
      began();
      return pending;
    });
    const repo = new GeminiRepository({ client: client(), store: memory(source).store });
    const running = repo.resumeResearchJob('run_fixture');
    await started;
    const result = await repo.cancelResearchJob('run_fixture');
    try {
      expect(result?.status).toBe('cancelling');
    } finally {
      // Synthetic provider cooperates only after the assertion; no leaked work.
      rejectProvider(new Error('Synthetic provider acknowledged abort'));
      await running;
    }
    expect((await repo.getResearchJob('run_fixture'))?.status).toBe('cancelled');
  });

  it('a provider that ignores abort cannot commit a late success after cancellation', async () => {
    const source = snapshot();
    source.researchJobs = [
      {
        ...job('failed'),
        marketPlan: {
          marketName: 'Synthetic market',
          vertical: 'Test',
          geography: null,
          notes: null,
          searchThemes: [],
        },
        market: market('market_fixture', 'Synthetic market'),
        deck: deck('deck_fixture', 'market_fixture'),
        catalog: [],
      },
    ];
    let release!: (result: { market: Market; deck: Deck; cards: [] }) => void;
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    pipeline.run.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
          began();
        }),
    );
    const data = memory(source);
    const repo = new GeminiRepository({ client: client(), store: data.store });
    const running = repo.resumeResearchJob('run_fixture');
    await started;
    expect((await repo.cancelResearchJob('run_fixture'))?.status).toBe('cancelling');
    release({
      market: market('market_fixture', 'Synthetic market'),
      deck: deck('deck_fixture', 'market_fixture'),
      cards: [],
    });
    await running;
    expect((await repo.getResearchJob('run_fixture'))?.status).toBe('cancelled');
    expect(data.read().decks).toEqual([]);
  });

  it('a shared company correction must invalidate both market projections', async () => {
    const source = snapshot();
    source.markets = [market('market_a', 'Synthetic A'), market('market_b', 'Synthetic B')];
    source.decks = [deck('deck_a', 'market_a'), deck('deck_b', 'market_b')];
    source.cards = [card('card_a', 'deck_a', 'co_fixture'), card('card_b', 'deck_b', 'co_fixture')];
    source.companyMarket.co_fixture = 'Synthetic A';
    source.opportunity = {
      market_a: { markdown: 'Old synthetic projection', citations: [], at: AT },
      market_b: { markdown: 'Old synthetic projection', citations: [], at: AT },
    };
    const data = memory(source);
    const repo = new GeminiRepository({ client: client(), store: data.store });
    await repo.overrideMetric({
      companyId: 'co_fixture',
      metricType: 'arr',
      value: null,
      note: 'Synthetic correction: unsupported value cleared',
    });
    expect(Object.keys(data.read().opportunity)).toEqual([]);
  });

  it('same-name companies with distinct domains must retain distinct IDs on refresh', async () => {
    const source = snapshot();
    source.markets = [market('market_a', 'Synthetic A')];
    source.decks = [deck('deck_a', 'market_a')];
    const first = { ...source.companies[0]!, websiteUrl: 'https://one.fixture.test' };
    const second = { ...first, id: 'co_other', websiteUrl: 'https://two.fixture.test' };
    source.companies = [first, second];
    source.cards = [card('card_a', 'deck_a', first.id), card('card_b', 'deck_a', second.id)];
    source.researchJobs = [
      {
        ...job('failed'),
        market: source.markets[0],
        deck: source.decks[0],
        marketPlan: {
          marketName: 'Synthetic A',
          vertical: 'Synthetic',
          geography: null,
          notes: null,
          searchThemes: [],
        },
        catalog: [],
      },
    ];
    pipeline.run.mockResolvedValueOnce({
      market: source.markets[0],
      deck: source.decks[0],
      cards: source.cards.map((item, index) => ({
        card: { ...item },
        company: { ...source.companies[index]! },
        metrics: [],
        viceClaims: [],
      })),
    });
    const repo = new GeminiRepository({ client: client(), store: memory(source).store });
    await repo.resumeResearchJob('run_fixture');
    const cards = await repo.listCards('deck_a');
    expect(new Set(cards.map((item) => item.company?.id)).size).toBe(2);
    expect(new Set(cards.map((item) => item.company?.websiteUrl)).size).toBe(2);
  });

  it('different reporting periods must coexist rather than become a same-period conflict', () => {
    const observation = (year: number, value: number) => ({
      ...companyMetricSchema.parse({
        id: `metric_${year}`,
        companyId: 'co_fixture',
        metricType: 'arr',
        value,
        confidence: 'verified',
        source: `https://reports.fixture.test/${year}`,
        methodNote: 'Synthetic annual source',
        citations: [
          {
            title: 'Synthetic company statement',
            url: `https://reports.fixture.test/${year}`,
            credibility: 'primary',
          },
        ],
        capturedAt: AT,
      }),
      period: { start: `${year}-01-01`, end: `${year}-12-31` },
    });
    const combined = reconcileMetrics([observation(2024, 100)], [observation(2025, 200)]);
    expect(combined[0]?.value).toBe(100);
    expect(combined).toHaveLength(2);
    expect(combined.flatMap((item) => item.conflicts ?? [])).toEqual([]);
  });
});
