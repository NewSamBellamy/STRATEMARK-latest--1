/**
 * Shared set-up for the import tests: a real researched deck as a file, small
 * workspaces, and the real app opened on what is stored with a fake model that
 * counts every call it is asked to make. Tests only; nothing in the app imports it.
 */
import { vi } from 'vitest';
import type { RenderResult } from '@testing-library/react';
import type { ZodType } from 'zod';
import { GeminiRepository, migrateSnapshot, type LlmClient, type RepoSnapshot } from '@mi/research';
import frontier from '@/sample/frontier-snapshot.json';
import { ErrorBoundary } from '@/components/states/ErrorBoundary';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/test-utils';
import { openBrowserResearchStore } from './browserResearchStore';

export type ResearchFile = Record<string, unknown> & { markets: { id: string }[]; decks: { id: string }[]; companies: { id: string }[]; dashboards: Record<string, Record<string, unknown>> };

/** A real researched deck (the bundled sample), as a file would carry it. */
export const real = () => structuredClone(frontier) as unknown as ResearchFile;
export const unavailable = async (url: string) => ({ requestedUrl: url, status: 'unavailable' as const, retrievedAt: '', reason: 'offline' });
export const market = (id: string, name: unknown, createdAt = '2026-01-01T00:00:00Z') =>
  ({ id, name, scopeDefinition: { vertical: 'Test', geography: null, notes: null }, refreshCadence: 'weekly', createdAt });

/** A workspace with the given markets, each with a deck, and no companies. */
export function workspace(...markets: { id: string }[]): RepoSnapshot {
  const snapshot = migrateSnapshot(null).snapshot as unknown as Record<string, unknown>;
  snapshot.markets = markets;
  snapshot.decks = markets.map((m) => ({ id: `d_${m.id}`, marketId: m.id, createdAt: '2026-01-01T00:00:00Z', lastRefreshedAt: null }));
  return snapshot as unknown as RepoSnapshot;
}

/** The names of the decks in a saved workspace's text. */
export const deckNames = (json: string | null) => json ? (JSON.parse(json).markets as { name: unknown }[]).map((m) => m.name) : null;

export interface Counters { ground: number; structure: number; news: number; reads: number }
export const counters = (): Counters => ({ ground: 0, structure: 0, news: 0, reads: 0 });

function countingClient(count: Counters): LlmClient {
  return {
    ground: vi.fn(async () => { count.ground += 1; return { text: 'x', citations: [], queries: [] }; }) as unknown as LlmClient['ground'],
    structure: (async (_prompt: string, schema: ZodType<unknown>) => { count.structure += 1; return schema.parse({}); }) as LlmClient['structure'],
  };
}

/** Opens the real app on what is stored, as a reload does, with every outside call counted and answered with nothing. */
export async function openApp(count: Counters, options: { route?: string; waitMs?: number } = {}): Promise<RenderResult & { repository: GeminiRepository; text: () => string }> {
  const store = await openBrowserResearchStore();
  const repository = new GeminiRepository({
    apiKey: 'k', client: countingClient(count), store, dashboardWarmup: false,
    originalSourceReader: async (url: string) => { count.reads += 1; return unavailable(url); },
    // A news lane that always finds one article, so a check that runs shows up in the count.
    newsSearch: () => async (query: string) => {
      count.news += 1;
      const name = /"([^"]+)"/.exec(query)?.[1] ?? 'Acme';
      return [{ title: `${name} raises $5 million Series A`, url: `https://news.example.org/${encodeURIComponent(name)}`, snippet: `${name} raised a round`, published: new Date().toISOString(), publisher: 'Example News' }] as never;
    },
  } as never);
  const view = renderWithProviders(<ErrorBoundary fallbackTitle="The app failed to start"><AppRoutes /></ErrorBoundary>, { repository: repository as never, route: options.route ?? '/' });
  await new Promise((resolve) => setTimeout(resolve, options.waitMs ?? 300));
  // A page's code loads the first time it is asked for: wait for it to leave its loading state.
  for (let waited = 0; waited < 15_000; waited += 100) {
    const main = view.container.querySelector('main')?.textContent ?? '';
    if (main.trim() !== '' && !/Loading…$/.test(main.trim())) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { ...view, repository, text: () => view.container.textContent ?? '' };
}

/** What a crashed page or a failed start looks like on screen. */
export const CRASHED = /This view crashed|failed to start|could not be shown/;
