import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { completenessFixture } from './completeness-report.fixture';
import { MAX_IMPORTED_COMPANIES, prepareImportedSnapshot } from './import-snapshot';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';

afterEach(() => { vi.unstubAllGlobals(); });

const fixture = () => completenessFixture() as unknown as RepoSnapshot;
/** A copy of the fixture with its first market altered the way a damaged or hostile file would. */
const withMarket = (change: Record<string, unknown>) => {
  const snapshot = fixture();
  snapshot.markets = [{ ...snapshot.markets[0]!, ...change }] as RepoSnapshot['markets'];
  return snapshot;
};

describe('prepareImportedSnapshot: what an import keeps', () => {
  it('keeps every row of a real workspace untouched and reports nothing skipped', () => {
    const original = fixture();
    const plan = prepareImportedSnapshot(original);
    expect(plan.skipped).toBe(0);
    expect(plan.unfinishedResearch).toBe(0);
    for (const field of ['markets', 'decks', 'companies', 'metrics', 'cards'] as const) {
      expect(plan.snapshot[field]).toEqual(original[field]);
    }
    expect({ decks: plan.decks, companies: plan.companies }).toEqual({ decks: original.markets.length, companies: original.companies.length });
  });

  it('leaves out a deck whose name is an object, with the rows that hung off it, and keeps the rest', () => {
    const hostile = withMarket({ name: { a: 1 } });
    hostile.markets.push({ id: 'mkt_ok', name: 'Fine market', createdAt: '2026-01-01T00:00:00Z', refreshCadence: 'weekly', scopeDefinition: { vertical: 'x', geography: null, notes: null } });
    hostile.decks.push({ id: 'deck_ok', marketId: 'mkt_ok', createdAt: '2026-01-01T00:00:00Z', lastRefreshedAt: null });
    const plan = prepareImportedSnapshot(hostile);
    expect(plan.snapshot.markets.map((m) => m.name)).toEqual(['Fine market']);
    // The market's own deck is left out with it; the unrelated deck stays.
    expect(plan.snapshot.decks.map((d) => d.id)).toEqual(['deck_ok']);
    // The deck's cards went with it; the company they showed stays (companies are shared).
    expect(plan.snapshot.cards).toEqual([]);
    expect(plan.snapshot.companies).toHaveLength(hostile.companies.length);
    expect(plan.skipped).toBe(1 + 1 + hostile.cards.length);
    // Nothing that reaches a screen as text is anything but text.
    for (const market of plan.snapshot.markets) expect(typeof market.name).toBe('string');
  });

  it('leaves out a deck with no name or an empty one, but makes a numeric name into text', () => {
    const missing = withMarket({}); delete (missing.markets[0] as unknown as Record<string, unknown>).name;
    expect(prepareImportedSnapshot(missing).snapshot.markets).toEqual([]);
    expect(prepareImportedSnapshot(withMarket({ name: '' })).snapshot.markets).toEqual([]);
    expect(prepareImportedSnapshot(withMarket({ name: null })).snapshot.markets).toEqual([]);
    const numeric = prepareImportedSnapshot(withMarket({ name: 5 }));
    expect(numeric.snapshot.markets[0]!.name).toBe('5');
    expect(numeric.skipped).toBe(0);
  });

  it('leaves out a figure or card whose company was left out, and a claim whose card was left out', () => {
    const hostile = fixture();
    hostile.companies = hostile.companies.map((c) => c.id === 'acme' ? { ...c, name: ['Acme'] } as never : c);
    const plan = prepareImportedSnapshot(hostile);
    expect(plan.snapshot.companies.map((c) => c.id)).not.toContain('acme');
    expect(plan.snapshot.metrics.some((m) => m.companyId === 'acme')).toBe(false);
    expect(plan.snapshot.cards.some((c) => c.companyId === 'acme')).toBe(false);
    expect(plan.snapshot.metrics.some((m) => m.companyId === 'beta')).toBe(true);
  });

  it('does not accept a figure whose confidence is not one the product knows', () => {
    const hostile = fixture();
    hostile.metrics = [...hostile.metrics, { ...hostile.metrics[0]!, id: 'forged', confidence: 'certain' as never }];
    const plan = prepareImportedSnapshot(hostile);
    expect(plan.snapshot.metrics.map((m) => m.id)).not.toContain('forged');
    expect(plan.skipped).toBe(1);
  });

  it('keeps partial reports from older builds but not a report whose title is not text', () => {
    const snapshot = fixture();
    snapshot.reports = [{ id: 'old', markdown: 'kept' }, { id: 'bad', title: { x: 1 }, markdown: 'm' }] as never;
    const plan = prepareImportedSnapshot(snapshot);
    expect(plan.snapshot.reports.map((r) => r.id)).toEqual(['old']);
    expect(plan.skipped).toBe(1);
  });

  it('refuses a file with more companies than any real workspace holds, in plain words', () => {
    const big = fixture();
    big.companies = Array.from({ length: MAX_IMPORTED_COMPANIES + 1 }, (_, n) => ({ ...big.companies[0]!, id: `c${n}` }));
    expect(() => prepareImportedSnapshot(big)).toThrow(/1,001 companies, more than the 1,000 an import can bring in/);
    big.companies.pop();
    expect(prepareImportedSnapshot(big).companies).toBe(MAX_IMPORTED_COMPANIES);
  });
});

describe('prepareImportedSnapshot: what an import never carries', () => {
  const stamped = () => ({
    ...fixture(),
    deckWarmup: { deck_fx: { startedAt: '2026-01-01T00:00:00Z' } },
    dashboardWarmup: { acme: { overview: { at: '2026-01-01T00:00:00Z', outcome: 'empty' } } },
    deckRun: { deck_fx: { submittedAt: '2026-01-01T00:00:00Z' } },
    researchJobs: [
      { id: 'j_run', status: 'running', stage: 'metrics', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', catalogNames: [], completedEntityNames: [], warnings: [], error: null },
      { id: 'j_wait', status: 'queued', stage: 'scope', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', catalogNames: [], completedEntityNames: [], warnings: [], error: null },
      { id: 'j_done', status: 'completed', stage: 'dashboard', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', catalogNames: [], completedEntityNames: [], warnings: [], error: null },
    ],
  }) as unknown as RepoSnapshot;

  it('removes warm-up, tab-attempt and run state, and running or queued jobs, and counts them', () => {
    const input = stamped();
    const plan = prepareImportedSnapshot(input);
    expect(plan.snapshot.deckWarmup).toBeUndefined();
    expect(plan.snapshot.dashboardWarmup).toBeUndefined();
    expect(plan.snapshot.deckRun).toBeUndefined();
    expect(plan.snapshot.researchJobs.map((j) => j.id)).toEqual(['j_done']);
    expect(plan.unfinishedResearch).toBe(2);
    // A finished job is history, and unfinished research is not a damaged row.
    expect(plan.skipped).toBe(0);
    // The caller's object is not edited: the same snapshot still resumes for the person who owns it.
    expect(input.deckWarmup).toBeDefined();
  });

  it('survives migration without gaining the state back', () => {
    const migrated = migrateSnapshot(prepareImportedSnapshot(stamped()).snapshot).snapshot;
    expect(migrated.deckWarmup).toBeUndefined();
    expect(migrated.researchJobs.every((j) => j.status !== 'queued' && j.status !== 'running')).toBe(true);
  });
});

describe('an imported file cannot start research; the person\'s own workspace still resumes', () => {
  /** Boots a repository on `snapshot` and counts every model call it makes with no user action. */
  async function callsAfterBoot(snapshot: RepoSnapshot): Promise<number> {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    let calls = 0;
    const llm: LlmClient = {
      ground: vi.fn(async () => { calls += 1; return { text: 'x', citations: [], queries: [] }; }) as unknown as LlmClient['ground'],
      structure: (async (_prompt: string, schema: ZodType<unknown>) => { calls += 1; return schema.parse({}); }) as LlmClient['structure'],
    };
    const repo = new GeminiRepository({ apiKey: 'user-own-key', client: llm,
      dashboardWarmup: { backfill: false, startupDelayMs: 0, resumeDelayMs: 0, allowed: () => true },
      originalSourceReader: async (url) => ({ requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: 'offline' }),
      store: { read: () => structuredClone(snapshot), write: async () => {} } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await repo.waitForDashboardWarmup().catch(() => undefined);
    return calls;
  }
  const unfinished = () => ({ ...fixture(), deckWarmup: { deck_fx: { startedAt: '2026-01-01T00:00:00Z' } } }) as RepoSnapshot;

  it('an unfinished warm-up in an imported file makes no model call', async () => {
    expect(await callsAfterBoot(migrateSnapshot(prepareImportedSnapshot(unfinished()).snapshot).snapshot)).toBe(0);
  });

  it('the same unfinished warm-up in the person\'s own saved workspace still resumes after a reload', async () => {
    expect(await callsAfterBoot(migrateSnapshot(unfinished()).snapshot)).toBeGreaterThan(0);
  });
});
