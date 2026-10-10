/**
 * Free self-hosted discovery lane — SearXNG's JSON API as the hunt's search
 * engine when one runs locally (docker run -d -p 8888:8080 searxng/searxng
 * with formats:[html,json]). Feature-detected with a cheap probe; every
 * failure degrades to the Gemini grounded lane, never blocks a hunt.
 *
 * Discovery only: SearXNG results name CANDIDATES. Anything that becomes a
 * figure still passes the same original-read + passage gates as before — the
 * engine that found the page earns no trust the page itself doesn't carry.
 */
import { z } from 'zod';

export const DEFAULT_SEARXNG_BASE = 'http://localhost:8888';

/** JSON mode must be enabled server-side (formats:[html,json]); a probe that
 * answers within the timeout with a results array means the lane is usable. */
export async function probeSearxng(base: string, fetchImpl: typeof fetch, timeoutMs = 2500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(searxngUrl(base, 'stratemark availability probe'), { signal: controller.signal });
      if (!response.ok) return false;
      const parsed = searxngResponseSchema.safeParse(await response.json());
      return parsed.success;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

export function searxngUrl(base: string, query: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}/search?q=${encodeURIComponent(query)}&format=json&language=en`;
}

const searxngResponseSchema = z.object({
  results: z.array(z.object({
    url: z.string().url(),
    title: z.string().nullish(),
    content: z.string().nullish(),
  })).max(100),
}).passthrough();

export interface SearxngResult {
  url: string;
  title: string;
  snippet: string;
}

export async function searxngSearch(base: string, query: string, fetchImpl: typeof fetch, timeoutMs = 8000): Promise<SearxngResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(searxngUrl(base, query), { signal: controller.signal });
    if (!response.ok) return [];
    const parsed = searxngResponseSchema.safeParse(await response.json());
    if (!parsed.success) return [];
    const seen = new Set<string>();
    const results: SearxngResult[] = [];
    for (const row of parsed.data.results) {
      let url: URL;
      try {
        url = new URL(row.url);
      } catch {
        continue;
      }
      if (url.protocol !== 'https:' || seen.has(url.href)) continue;
      seen.add(url.href);
      results.push({ url: url.href, title: (row.title ?? url.hostname).trim(), snippet: (row.content ?? '').trim() });
      if (results.length >= 8) break;
    }
    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export interface DiscoveryNotes {
  text: string;
  citations: Array<{ title: string; url: string }>;
  queries: string[];
  grounding: undefined;
}

export interface SearxngLane {
  discover(query: string): Promise<DiscoveryNotes>;
}

let laneCache: { available: boolean; checkedAt: number } | null = null;
const LANE_PROBE_TTL_MS = 5 * 60_000;

/** Test hook — the probe result is memoized for five minutes. */
export function resetSearxngLaneCache(): void {
  laneCache = null;
}

/** The memoized discovery lane: null when no local SearXNG answers. The probe
 * costs one tiny request per five minutes, never per hunt. */
export async function getSearxngLane(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  base = DEFAULT_SEARXNG_BASE): Promise<SearxngLane | null> {
  if (!laneCache || Date.now() - laneCache.checkedAt > LANE_PROBE_TTL_MS) {
    laneCache = { available: await probeSearxng(base, fetchImpl), checkedAt: Date.now() };
  }
  if (!laneCache.available) return null;
  return {
    discover: async (query) => searxngNotes(query, await searxngSearch(base, query, fetchImpl)),
  };
}

/** Synthesize hunt notes from result snippets. Snippets are discovery text
 * for the structure step — figures still need the retained original pages, so
 * this is explicitly NOT provider grounding (no supports/offsets). */
export function searxngNotes(query: string, results: readonly SearxngResult[]): DiscoveryNotes {
  const lines = results.map((r) => `${r.title} — ${r.snippet} (${r.url})`);
  return {
    text: lines.length > 0
      ? `Search results for "${query}":\n${lines.join('\n')}`
      : `No search results for "${query}".`,
    citations: results.map((r) => ({ title: r.title, url: r.url })),
    queries: [query],
    grounding: undefined,
  };
}
