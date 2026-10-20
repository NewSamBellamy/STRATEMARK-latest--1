import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { screen } from '@testing-library/react';
import type { ZodType } from 'zod';
import { GeminiRepository, migrateSnapshot, type LlmClient, type RepoSnapshot } from '@mi/research';
import frontier from '@/sample/frontier-snapshot.json';
import { ErrorBoundary } from '@/components/states/ErrorBoundary';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/test-utils';
import { importQuestion, importSummary } from './importSummary';
import { installBrowserResearch, openBrowserResearchStore, planResearchImport, readBrowserResearchData } from './browserResearchStore';

/** Research stored in this browser, as a file would carry it: a real researched deck (the bundled sample) with edits. */
type ResearchFile = Record<string, unknown> & { decks: { id: string }[]; companies: { id: string }[] };
const real = () => structuredClone(frontier) as unknown as ResearchFile;
const unavailable = async (url: string) => ({ requestedUrl: url, status: 'unavailable' as const, retrievedAt: '', reason: 'offline' });
const market = (id: string, name: unknown) => ({ id, name, scopeDefinition: { vertical: 'Test', geography: null, notes: null }, refreshCadence: 'weekly', createdAt: '2026-01-01T00:00:00Z' });

/** A workspace with the given markets, each with a deck, and no companies. */
function workspace(...markets: { id: string }[]): RepoSnapshot {
  const snapshot = migrateSnapshot(null).snapshot as unknown as Record<string, unknown>;
  snapshot.markets = markets;
  snapshot.decks = markets.map((m) => ({ id: `d_${m.id}`, marketId: m.id, createdAt: '2026-01-01T00:00:00Z', lastRefreshedAt: null }));
  return snapshot as unknown as RepoSnapshot;
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Opens the app on what is stored, as a reload does, and says what the person would see. */
async function openApp() {
  const store = await openBrowserResearchStore();
  const offline: LlmClient = { ground: (async () => { throw new Error('offline'); }) as never, structure: (async () => { throw new Error('offline'); }) as never };
  const repository = new GeminiRepository({ apiKey: 'k', client: offline, store, dashboardWarmup: false, originalSourceReader: unavailable });
  const view = renderWithProviders(<ErrorBoundary fallbackTitle="The app failed to start"><AppRoutes /></ErrorBoundary>, { repository: repository as never, route: '/' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  return { ...view, text: view.container.textContent ?? '' };
}

describe('an imported file cannot plant a crash that survives a reload', () => {
  // The inputs the independent review used: a valid-shape export whose first market's name is an object, a number, or missing.
  const importThenOpen = async (name: unknown, ...more: { id: string }[]) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const plan = await installBrowserResearch(JSON.stringify(workspace(market('m1', name), ...more)));
    const app = await openApp();
    return { plan, ...app };
  };

  it('a deck named by an object is left out of the import and the app starts', async () => {
    const { plan, text, unmount } = await importThenOpen({ a: 1 }, market('m2', 'Real market'));
    expect(text).not.toMatch(/failed to start|This view crashed/);
    expect(text).toContain('Real market');
    expect(text).toContain('Settings');
    expect(plan).toBe(1);
    expect(JSON.parse((await readBrowserResearchData()).current!).markets.map((m: { name: string }) => m.name)).toEqual(['Real market']);
    unmount();
  });

  it('a deck named by a number is kept as text; one with no name is left out', async () => {
    const numeric = await importThenOpen(5);
    expect(numeric.text).not.toMatch(/failed to start|This view crashed/);
    expect(JSON.parse((await readBrowserResearchData()).current!).markets[0].name).toBe('5');
    numeric.unmount();
    vi.stubGlobal('indexedDB', new IDBFactory());
    const missing = await importThenOpen(undefined);
    expect(missing.plan).toBe(0);
    expect(missing.text).not.toMatch(/failed to start|This view crashed/);
    missing.unmount();
  });

  it('says how many rows it left out before anything is replaced', () => {
    const hostile = workspace(market('m1', { a: 1 }), market('m2', 'Real market'));
    const plan = planResearchImport(JSON.stringify(hostile));
    expect(plan).toMatchObject({ decks: 1, companies: 0, skipped: 2 });
    const question = importQuestion(plan, 'this export');
    expect(question).toContain('This brings in 1 deck and 0 companies.');
    expect(question).toContain('2 items in the file could not be read, so they are left out.');
    expect(question).toContain('kept as a separate copy from before the import');
  });

  it('reads a real researched deck without leaving anything out', () => {
    const plan = planResearchImport(JSON.stringify(real()));
    expect(plan).toMatchObject({ decks: 1, companies: 10, skipped: 0, unfinishedResearch: 0 });
    expect(plan.snapshot.metrics).toHaveLength(48);
    expect(plan.snapshot.viceClaims).toHaveLength(21);
  });
});

describe('a bad row already in storage cannot take the whole app down', () => {
  it('the sidebar fails alone and Settings stays reachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Written straight to storage, as an older build's import could have: the store only checks that rows are objects.
    await (await openBrowserResearchStore()).write(workspace(market('m1', { a: 1 }), market('m2', 'Real market')));
    const { text, container, unmount } = await openApp();
    expect(text).not.toMatch(/failed to start/);
    expect(text).toContain('Your deck list could not be shown.');
    expect(container.querySelector('nav[aria-label="Primary"]')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: /settings/i }).length).toBeGreaterThan(0);
    unmount();
  });
});

describe('an imported file cannot start research', () => {
  /** Opens a repository on what is stored and counts the model calls it makes with no click. */
  async function callsAfterBoot(): Promise<number> {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    let calls = 0;
    const client: LlmClient = {
      ground: vi.fn(async () => { calls += 1; return { text: 'x', citations: [], queries: [] }; }) as unknown as LlmClient['ground'],
      structure: (async (_prompt: string, schema: ZodType<unknown>) => { calls += 1; return schema.parse({}); }) as LlmClient['structure'],
    };
    const repository = new GeminiRepository({ apiKey: 'user-own-key', client, store: await openBrowserResearchStore(),
      // Research may begin; once any call is made the spend gate closes, so a resumed deck is observed without being paid for.
      dashboardWarmup: { backfill: false, startupDelayMs: 0, resumeDelayMs: 0, allowed: () => calls === 0 }, originalSourceReader: unavailable });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await repository.waitForDashboardWarmup().catch(() => undefined);
    return calls;
  }
  /** The proof input: the file says a deck's warm-up started and never finished. A cold deck, so there is research to start. */
  const unfinishedWarmup = () => {
    const file = real();
    file.dashboards = {};
    file.deckWarmup = { [file.decks[0]!.id]: { startedAt: '2026-01-01T00:00:00Z' } };
    return file;
  };

  it('importing a file with an unfinished warm-up makes no model call', async () => {
    await installBrowserResearch(JSON.stringify(unfinishedWarmup()));
    expect(await callsAfterBoot()).toBe(0);
    expect((await openBrowserResearchStore()).read()!.deckWarmup).toBeUndefined();
  });

  it('the same warm-up saved by this browser itself still resumes after a reload', async () => {
    await (await openBrowserResearchStore()).write(migrateSnapshot(unfinishedWarmup() as unknown as RepoSnapshot).snapshot);
    expect(await callsAfterBoot()).toBeGreaterThan(0);
  });

  it('refuses a file with more companies than any workspace holds, and keeps what is saved', async () => {
    const store = await openBrowserResearchStore();
    await store.write(workspace(market('m1', 'Mine')));
    const before = await readBrowserResearchData();
    const huge = real();
    huge.companies = Array.from({ length: 1001 }, (_, n) => ({ ...huge.companies[0], id: `c${n}` }));
    await expect(installBrowserResearch(JSON.stringify(huge))).rejects.toThrow(/1,001 companies, more than the 1,000 an import can bring in/);
    expect(await readBrowserResearchData()).toEqual(before);
  });
});

describe('the import confirmation', () => {
  it('states what it brings in and leaves out in plain words', () => {
    expect(importSummary({ decks: 1, companies: 1, skipped: 0, unfinishedResearch: 0, followsLeftOut: 0 })).toBe('This brings in 1 deck and 1 company.');
    expect(importSummary({ decks: 4, companies: 40, skipped: 1, unfinishedResearch: 2, followsLeftOut: 0 })).toBe(
      'This brings in 4 decks and 40 companies. 1 item in the file could not be read, so it is left out. 2 research runs that were still going when the file was saved will not be started again.');
  });
});
