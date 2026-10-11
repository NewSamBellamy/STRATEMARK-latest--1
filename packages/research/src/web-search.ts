/**
 * Pluggable web-search discovery — real search engines (bring-your-own-key or
 * the hosted relay) answer the hunt's "where is this figure published?" step
 * instead of model-grounded search.
 *
 * Discovery only, exactly like the SearXNG lane: a result names a CANDIDATE
 * page. Anything that becomes a figure still passes the original-read and
 * verbatim-passage gates; the engine that found a page earns no trust the page
 * itself doesn't carry.
 *
 * Provider APIs are called from a relay (the dev server, the desktop main
 * process or the Worker), never straight from the page: several providers do
 * not allow browser CORS, and a relay keeps one code path for BYOK and hosted.
 * The pure builders/parsers below are shared by every relay.
 */
import { z } from 'zod';
import type { DiscoveryNotes, SearxngResult } from './searxng';
import { searxngNotes } from './searxng';

export const SEARCH_PROVIDERS = ['tavily', 'serper', 'exa', 'brave', 'jina'] as const;
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

export interface SearchProviderInfo {
  id: SearchProvider;
  name: string;
  /** Plain-English free allowance, shown on the onboarding card. */
  freeTier: string;
  signupUrl: string;
  keyPrefix?: string;
  noCard: boolean;
  /** Terms that change how results may be shown. */
  note?: string;
}

/** Ordered by how easy the free key is to get; the first is the recommended default. */
export const SEARCH_PROVIDER_INFO: readonly SearchProviderInfo[] = [
  { id: 'tavily', name: 'Tavily', freeTier: '1,000 searches a month, free', signupUrl: 'https://app.tavily.com', keyPrefix: 'tvly-', noCard: true },
  { id: 'serper', name: 'Serper (Google results)', freeTier: '2,500 free searches to start', signupUrl: 'https://serper.dev', noCard: true },
  { id: 'exa', name: 'Exa', freeTier: 'Free starter credit', signupUrl: 'https://dashboard.exa.ai', noCard: true },
  { id: 'jina', name: 'Jina', freeTier: 'Free key with a large token allowance', signupUrl: 'https://jina.ai', keyPrefix: 'jina_', noCard: true },
  { id: 'brave', name: 'Brave Search', freeTier: 'Monthly free credit (card required)', signupUrl: 'https://api-dashboard.search.brave.com', noCard: false, note: 'Brave requires attribution when its results are shown.' },
];

export function isSearchProvider(value: unknown): value is SearchProvider {
  return typeof value === 'string' && (SEARCH_PROVIDERS as readonly string[]).includes(value);
}

/** Printable ASCII only, bounded: a key travels in an HTTP header. */
export function isPlausibleSearchKey(key: unknown): key is string {
  return typeof key === 'string' && /^[\x21-\x7e]{8,200}$/.test(key);
}

export interface WebSearchResult extends SearxngResult {
  /** Publication date when the engine reports one (free text, never trusted as an as-of). */
  published?: string;
}

export interface SearchRequest {
  url: string;
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string };
}

const MAX_RESULTS = 8;

export function buildSearchRequest(provider: SearchProvider, key: string, query: string): SearchRequest {
  const json = { 'Content-Type': 'application/json', Accept: 'application/json' };
  switch (provider) {
    case 'serper':
      return { url: 'https://google.serper.dev/search', init: { method: 'POST',
        headers: { ...json, 'X-API-KEY': key }, body: JSON.stringify({ q: query, num: 10 }) } };
    case 'tavily':
      return { url: 'https://api.tavily.com/search', init: { method: 'POST',
        headers: { ...json, Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query, max_results: MAX_RESULTS, search_depth: 'basic' }) } };
    case 'exa':
      return { url: 'https://api.exa.ai/search', init: { method: 'POST',
        headers: { ...json, 'x-api-key': key },
        body: JSON.stringify({ query, numResults: MAX_RESULTS, contents: { highlights: { numSentences: 3 } } }) } };
    case 'brave':
      return { url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}`,
        init: { method: 'GET', headers: { Accept: 'application/json', 'X-Subscription-Token': key } } };
    case 'jina':
      return { url: `https://s.jina.ai/?q=${encodeURIComponent(query)}`,
        init: { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${key}`, 'X-Respond-With': 'no-content' } } };
  }
}

const text = z.string().nullish();
const serperSchema = z.object({ organic: z.array(z.object({ link: z.string(), title: text, snippet: text, date: text })).default([]) }).passthrough();
const tavilySchema = z.object({ results: z.array(z.object({ url: z.string(), title: text, content: text, published_date: text })).default([]) }).passthrough();
const exaSchema = z.object({ results: z.array(z.object({ url: z.string(), title: text, highlights: z.array(z.string()).nullish(), text, summary: text, publishedDate: text })).default([]) }).passthrough();
const braveSchema = z.object({ web: z.object({ results: z.array(z.object({ url: z.string(), title: text, description: text, page_age: text, age: text })).default([]) }).nullish() }).passthrough();
const jinaSchema = z.object({ data: z.array(z.object({ url: z.string(), title: text, description: text, content: text, date: text })).nullish() }).passthrough();

interface RawRow { url: string; title?: string | null; snippet?: string | null; published?: string | null }

function rawRows(provider: SearchProvider, body: unknown): RawRow[] {
  switch (provider) {
    case 'serper': {
      const p = serperSchema.safeParse(body);
      return p.success ? p.data.organic.map((r) => ({ url: r.link, title: r.title, snippet: r.snippet, published: r.date })) : [];
    }
    case 'tavily': {
      const p = tavilySchema.safeParse(body);
      return p.success ? p.data.results.map((r) => ({ url: r.url, title: r.title, snippet: r.content, published: r.published_date })) : [];
    }
    case 'exa': {
      const p = exaSchema.safeParse(body);
      return p.success ? p.data.results.map((r) => ({ url: r.url, title: r.title,
        snippet: r.highlights?.length ? r.highlights.join(' … ') : (r.summary ?? r.text), published: r.publishedDate })) : [];
    }
    case 'brave': {
      const p = braveSchema.safeParse(body);
      return p.success ? (p.data.web?.results ?? []).map((r) => ({ url: r.url, title: r.title, snippet: r.description, published: r.page_age ?? r.age })) : [];
    }
    case 'jina': {
      const p = jinaSchema.safeParse(body);
      return p.success ? (p.data.data ?? []).map((r) => ({ url: r.url, title: r.title, snippet: r.description ?? r.content, published: r.date })) : [];
    }
  }
}

function plain(value: string | null | undefined, max: number): string {
  return (value ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Normalize any provider's JSON into https-only, de-duplicated, bounded rows. */
export function parseSearchResponse(provider: SearchProvider, body: unknown): WebSearchResult[] {
  const seen = new Set<string>();
  const out: WebSearchResult[] = [];
  for (const row of rawRows(provider, body)) {
    let url: URL;
    try {
      url = new URL(row.url);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:') continue;
    url.hash = '';
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const published = plain(row.published, 40);
    out.push({ url: url.href, title: plain(row.title, 200) || url.hostname, snippet: plain(row.snippet, 600),
      ...(published ? { published } : {}) });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

export class WebSearchError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'WebSearchError';
  }
}

/** Plain-English failure for the UI; never echoes the key or provider body. */
export function searchFailureMessage(provider: SearchProvider, status: number): string {
  const name = SEARCH_PROVIDER_INFO.find((p) => p.id === provider)?.name ?? provider;
  if (status === 401 || status === 403) return `Your ${name} key was rejected. Check or replace it in Settings.`;
  if (status === 402 || status === 429 || status === 432 || status === 433) return `Your ${name} free allowance is used up for now.`;
  return `${name} search is unavailable right now (${status}).`;
}

/** Relay side: call the provider directly. Throws WebSearchError with a safe message. */
export async function runProviderSearch(provider: SearchProvider, key: string, query: string,
  fetchImpl: typeof fetch, timeoutMs = 10_000): Promise<WebSearchResult[]> {
  const request = buildSearchRequest(provider, key, query.slice(0, 400));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(request.url, { ...request.init, signal: controller.signal });
    if (!response.ok) throw new WebSearchError(searchFailureMessage(provider, response.status), response.status);
    return parseSearchResponse(provider, await response.json());
  } catch (error) {
    if (error instanceof WebSearchError) throw error;
    throw new WebSearchError(searchFailureMessage(provider, 504), 504);
  } finally {
    clearTimeout(timer);
  }
}

export interface SearchRelayRequest { provider: SearchProvider; query: string }

/** Validate a relay request body; null when malformed. */
export function parseSearchRelayRequest(body: unknown): SearchRelayRequest | null {
  if (!body || typeof body !== 'object') return null;
  const { provider, query } = body as Record<string, unknown>;
  if (!isSearchProvider(provider) || typeof query !== 'string') return null;
  const q = query.trim();
  return q.length >= 2 && q.length <= 400 ? { provider, query: q } : null;
}

export type WebSearchFn = (query: string) => Promise<WebSearchResult[]>;

/** Page side: ask a relay to search. `key` omitted = the relay's hosted key. */
export function relayWebSearch(options: { endpoint: string; provider: SearchProvider; key?: string | null;
  headers?: Record<string, string>; fetchImpl?: typeof fetch; timeoutMs?: number }): WebSearchFn {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  return async (query) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    try {
      const response = await fetchImpl(options.endpoint, {
        method: 'POST', signal: controller.signal, credentials: 'omit',
        headers: { ...options.headers, 'Content-Type': 'application/json', ...(options.key ? { 'X-Search-Key': options.key } : {}) },
        body: JSON.stringify({ provider: options.provider, query } satisfies SearchRelayRequest),
      });
      const body = await response.json().catch(() => null) as { results?: unknown; error?: unknown } | null;
      if (!response.ok) {
        throw new WebSearchError(typeof body?.error === 'string' ? body.error.slice(0, 200)
          : searchFailureMessage(options.provider, response.status), response.status);
      }
      return Array.isArray(body?.results) ? (body.results as WebSearchResult[]).filter((r) =>
        typeof r?.url === 'string' && r.url.startsWith('https://')).slice(0, MAX_RESULTS) : [];
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Metric families searched together — one query per family keeps the
 * engine's ranking focused (a "revenue employees valuation" soup ranks
 * aggregator pages over the disclosure that actually states the figure). */
const QUERY_FAMILIES: ReadonlyArray<{ types: readonly string[]; terms: string }> = [
  { types: ['arr', 'revenue'], terms: 'annual revenue' },
  { types: ['valuation', 'funding_total', 'last_round', 'market_cap'], terms: 'valuation funding round' },
  { types: ['aum'], terms: 'assets under management' },
  { types: ['employees', 'users', 'distribution', 'market_share'], terms: 'employees customers' },
];

/** At most three engine queries for the missing metrics, most valuable family first. */
export function huntSearchQueries(companyName: string, missing: readonly string[],
  options: { financialFirm?: boolean; escalation?: number; year?: number } = {}): string[] {
  const year = options.year ?? new Date().getFullYear();
  const name = `"${companyName.replace(/"/g, '').trim()}"`;
  const queries = QUERY_FAMILIES
    .filter((family) => family.types.some((t) => missing.includes(t)))
    .map((family) => `${name} ${family.terms} ${year}`);
  if (options.financialFirm && !queries.some((q) => q.includes('assets under management'))) {
    queries.unshift(`${name} assets under management Form ADV`);
  }
  if ((options.escalation ?? 0) > 0) queries.unshift(`${name} annual report filing disclosure`);
  return (queries.length ? queries : [`${name} company overview ${year}`]).slice(0, 3);
}

export interface WebSearchLane {
  /** Run each query, merge distinct results into one set of discovery notes. */
  discover(queries: readonly string[]): Promise<DiscoveryNotes>;
}

/** Wrap a search function as a hunt discovery lane. A failing query is skipped
 * (the caller falls back when nothing at all comes back). */
export function webSearchLane(search: WebSearchFn): WebSearchLane {
  return {
    discover: async (queries) => {
      const settled = await Promise.allSettled(queries.map((q) => search(q)));
      const seen = new Set<string>();
      const merged: WebSearchResult[] = [];
      for (const result of settled) {
        if (result.status !== 'fulfilled') continue;
        for (const row of result.value) {
          if (seen.has(row.url)) continue;
          seen.add(row.url);
          merged.push(row);
        }
      }
      const notes = searxngNotes(queries.join(' | '), merged.map((r) => ({ ...r,
        snippet: r.published ? `${r.snippet} [published ${r.published}]` : r.snippet })));
      return { ...notes, queries: [...queries] };
    },
  };
}
