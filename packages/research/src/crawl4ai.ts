/**
 * Optional self-hosted rendering lane — Crawl4AI's server API as a second
 * chance for JS-heavy pages the direct reader sees as thin shells or outright
 * failures (docker run -d -p 11235:11235 unclecode/crawl4ai). Feature-detected
 * with a cheap /health probe and memoized exactly like the SearXNG lane: when
 * no container answers, every call degrades at zero cost and the direct
 * reader's receipt stands unchanged.
 *
 * Rendering is transport only: markdown from the lane is wrapped into the
 * same hashed, excerpt-bounded receipt as any direct read and passes the
 * identical claim gates. The lane never retrieves a page the source policy
 * already refused — callers re-apply it before any crawl.
 */
import { z } from 'zod';

export const DEFAULT_CRAWL4AI_BASE = 'http://127.0.0.1:11235';

export function crawl4aiHealthUrl(base: string): string {
  return `${base.replace(/\/+$/, '')}/health`;
}

export function crawl4aiCrawlUrl(base: string): string {
  return `${base.replace(/\/+$/, '')}/crawl`;
}

/** A probe that answers within the timeout means the container is up; the
 * /crawl call itself stays the real capability test. */
export async function probeCrawl4ai(base: string = DEFAULT_CRAWL4AI_BASE,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis), timeoutMs = 2000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(crawl4aiHealthUrl(base), { signal: controller.signal });
      return response.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/** Newer Crawl4AI versions return markdown as a MarkdownGenerationResult
 * object; older ones return the raw string. Both carry the same content. */
const crawlResultSchema = z.object({
  success: z.boolean().nullish(),
  status_code: z.number().nullish(),
  markdown: z.union([z.string(), z.object({ raw_markdown: z.string().nullish() }).passthrough()]).nullish(),
}).passthrough();

const crawlResponseSchema = z.object({
  results: z.array(crawlResultSchema).max(10),
}).passthrough();

export interface Crawl4aiPage {
  markdown: string;
  /** HTTP status the container reports for the crawled page. */
  status: number;
}

/** One bounded crawl: POST {urls, formats} to the server API. Any failure —
 * transport, deadline, schema, a failed or empty result — returns null so the
 * caller keeps its direct receipt unchanged. */
export async function crawl4aiRead(url: string,
  options: { base?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<Crawl4aiPage | null> {
  const base = options.base ?? DEFAULT_CRAWL4AI_BASE;
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const response = await doFetch(crawl4aiCrawlUrl(base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls: [url], formats: ['markdown'] }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const parsed = crawlResponseSchema.safeParse(await response.json());
    const result = parsed.success
      ? parsed.data.results.find((row) => row.markdown != null && row.success !== false)
      : undefined;
    const markdown = typeof result?.markdown === 'string' ? result.markdown : result?.markdown?.raw_markdown ?? null;
    if (!markdown?.trim() || !result) return null;
    // A version that omits status_code but reports success attests the page
    // was fetched; anything else stays an unverifiable zero.
    const status = result.status_code ?? (result.success === true ? 200 : 0);
    return { markdown, status };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface Crawl4aiLane {
  read(url: string, timeoutMs?: number): Promise<Crawl4aiPage | null>;
}

let laneCache: { available: boolean; checkedAt: number } | null = null;
const LANE_PROBE_TTL_MS = 5 * 60_000;

/** Test hook — the probe result is memoized for five minutes. */
export function resetCrawl4aiLaneCache(): void {
  laneCache = null;
}

/** The memoized rendering lane: null when no local Crawl4AI answers. The probe
 * costs one tiny request per five minutes, never per read. */
export async function getCrawl4aiLane(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  base = DEFAULT_CRAWL4AI_BASE): Promise<Crawl4aiLane | null> {
  if (!laneCache || Date.now() - laneCache.checkedAt > LANE_PROBE_TTL_MS) {
    laneCache = { available: await probeCrawl4ai(base, fetchImpl), checkedAt: Date.now() };
  }
  if (!laneCache.available) return null;
  return {
    read: async (url, timeoutMs) => crawl4aiRead(url, { base, fetchImpl, timeoutMs }),
  };
}
