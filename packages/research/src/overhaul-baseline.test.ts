/**
 * G00 risk reproductions, not release acceptance. Synthetic data, no real key.
 * These ordinary tests deliberately remain RED until the named invariants are
 * implemented. Never skip/invert them to manufacture a healthy baseline.
 */
import { describe, expect, it, vi } from 'vitest';
import { companyMetricSchema, type ResearchJob } from '@mi/contracts';
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

  it('a future schema must not become a writable repository', async () => {
    const source = { ...snapshot(), schemaVersion: REPO_SCHEMA_VERSION + 1 };
    const data = memory(source);
    const repo = new GeminiRepository({ client: client(), store: data.store });
    await repo.getDashboardTab('co_fixture', 'overview');
    expect(data.writes).toHaveLength(0);
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
    const oldRead = oldOwner.getDashboardTab('co_fixture', 'overview');
    await started;
    const replacement = migrateSnapshot(null).snapshot;
    data.replace(replacement);
    release({ text: 'Late synthetic response', citations: [], queries: [] });
    await oldRead;
    expect(data.read()).toEqual(replacement);
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
  });
});
