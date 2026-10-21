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
  /** The publication's name when the engine reports it ("Reuters"). */
  publisher?: string;
}

export interface SearchRequest {
  url: string;
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string };
}

const MAX_RESULTS = 8;

export interface SearchOptions {
  /** News articles (dated reporting) instead of the general web index. */
  news?: boolean;
  /** Only results published within this many days, where the provider supports it. */
  sinceDays?: number;
}

function sinceDate(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

export function buildSearchRequest(provider: SearchProvider, key: string, query: string,
  options: SearchOptions = {}, now = new Date()): SearchRequest {
  const json = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const since = options.sinceDays && options.sinceDays > 0 ? Math.floor(options.sinceDays) : null;
  switch (provider) {
    case 'serper': {
      // Google's relative windows: past month / past year (no 2-year window).
      const tbs = since == null ? null : since <= 31 ? 'qdr:m' : since <= 366 ? 'qdr:y' : null;
      return { url: `https://google.serper.dev/${options.news ? 'news' : 'search'}`, init: { method: 'POST',
        headers: { ...json, 'X-API-KEY': key }, body: JSON.stringify({ q: query, num: 10, ...(tbs ? { tbs } : {}) }) } };
    }
    case 'tavily':
      return { url: 'https://api.tavily.com/search', init: { method: 'POST',
        headers: { ...json, Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query, max_results: MAX_RESULTS, search_depth: 'basic',
          ...(options.news ? { topic: 'news' } : {}), ...(since ? { start_date: sinceDate(since, now) } : {}) }) } };
    case 'exa':
      return { url: 'https://api.exa.ai/search', init: { method: 'POST',
        headers: { ...json, 'x-api-key': key },
        body: JSON.stringify({ query, numResults: MAX_RESULTS, contents: { highlights: { numSentences: 3 } },
          ...(options.news ? { category: 'news' } : {}),
          ...(since ? { startPublishedDate: `${sinceDate(since, now)}T00:00:00.000Z` } : {}) }) } };
    case 'brave':
      return { url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}${
        since ? `&freshness=${sinceDate(since, now)}to${now.toISOString().slice(0, 10)}` : ''}`,
        init: { method: 'GET', headers: { Accept: 'application/json', 'X-Subscription-Token': key } } };
    case 'jina':
      return { url: `https://s.jina.ai/?q=${encodeURIComponent(query)}`,
        init: { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${key}`, 'X-Respond-With': 'no-content' } } };
  }
}

const text = z.string().nullish();
const serperRow = z.object({ link: z.string(), title: text, snippet: text, date: text });
const serperSchema = z.object({ organic: z.array(serperRow).default([]), news: z.array(serperRow).default([]) }).passthrough();
const tavilySchema = z.object({ results: z.array(z.object({ url: z.string(), title: text, content: text, published_date: text })).default([]) }).passthrough();
const exaSchema = z.object({ results: z.array(z.object({ url: z.string(), title: text, highlights: z.array(z.string()).nullish(), text, summary: text, publishedDate: text })).default([]) }).passthrough();
const braveSchema = z.object({ web: z.object({ results: z.array(z.object({ url: z.string(), title: text, description: text, page_age: text, age: text })).default([]) }).nullish() }).passthrough();
const jinaSchema = z.object({ data: z.array(z.object({ url: z.string(), title: text, description: text, content: text, date: text })).nullish() }).passthrough();

interface RawRow { url: string; title?: string | null; snippet?: string | null; published?: string | null }

function rawRows(provider: SearchProvider, body: unknown): RawRow[] {
  switch (provider) {
    case 'serper': {
      const p = serperSchema.safeParse(body);
      return p.success ? [...p.data.organic, ...p.data.news].map((r) => ({ url: r.link, title: r.title, snippet: r.snippet, published: r.date })) : [];
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
  fetchImpl: typeof fetch, timeoutMs = 10_000, options: SearchOptions = {}): Promise<WebSearchResult[]> {
  const request = buildSearchRequest(provider, key, query.slice(0, 400), options);
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

export interface SearchRelayRequest extends SearchOptions { provider: SearchProvider; query: string }

/** Validate a relay request body; null when malformed. */
export function parseSearchRelayRequest(body: unknown): SearchRelayRequest | null {
  if (!body || typeof body !== 'object') return null;
  const { provider, query, news, sinceDays } = body as Record<string, unknown>;
  if (!isSearchProvider(provider) || typeof query !== 'string') return null;
  const q = query.trim();
  if (q.length < 2 || q.length > 400) return null;
  return {
    provider, query: q,
    ...(news === true ? { news: true } : {}),
    ...(typeof sinceDays === 'number' && Number.isInteger(sinceDays) && sinceDays > 0 && sinceDays <= 3650 ? { sinceDays } : {}),
  };
}

export type WebSearchFn = (query: string, options?: SearchOptions) => Promise<WebSearchResult[]>;

/** Page side: ask a relay to search. `key` omitted = the relay's hosted key. */
export function relayWebSearch(options: { endpoint: string; provider: SearchProvider; key?: string | null;
  headers?: Record<string, string>; fetchImpl?: typeof fetch; timeoutMs?: number }): WebSearchFn {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  return async (query, searchOptions = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    try {
      const response = await fetchImpl(options.endpoint, {
        method: 'POST', signal: controller.signal, credentials: 'omit',
        headers: { ...options.headers, 'Content-Type': 'application/json', ...(options.key ? { 'X-Search-Key': options.key } : {}) },
        body: JSON.stringify({ provider: options.provider, query, ...searchOptions } satisfies SearchRelayRequest),
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
// News-style wording on purpose: a verifiable figure is a dated sentence in a
// press release or article ("X raised $Y at a $Z valuation, the company said
// on ..."). Measured live: "annual revenue 2026" instead matched a company's
// own market-research reports about OTHER companies, and data-aggregator
// pages that list bare, undated numbers the passage gate rightly rejects.
// News mode (measured live): dated articles and press releases instead of
// aggregator and social pages. Filing-style queries stay on the web index.
const QUERY_FAMILIES: ReadonlyArray<{ types: readonly string[]; terms: string; news: boolean }> = [
  { types: ['valuation', 'funding_total', 'last_round', 'market_cap'], terms: 'raises funding round valuation', news: true },
  { types: ['arr', 'revenue'], terms: 'revenue ARR million announced', news: true },
  { types: ['aum'], terms: 'assets under management billion', news: false },
  { types: ['employees', 'users', 'distribution', 'market_share'], terms: 'employees customers stores countries company says', news: true },
];

/** The passage gate's notion of "current": older reporting can't be accepted anyway. */
export const HUNT_SEARCH_SINCE_DAYS = 366;

export interface HuntQuery { query: string; news: boolean }

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** Own-site pages that state facts ABOUT the company (not its content marketing). */
const OWN_SITE_FACT_PATH = /^\/?$|\/(news|newsroom|press|press-releases?|media|about|about-us|company|investors?|ir|blog\/.*(announc|raise|funding|series|milestone))/i;

/**
 * Keep results that can plausibly state a figure about THIS company:
 * on the official site only newsroom/press/about/investor pages (the site's
 * reports, guides and product pages are about everyone else); elsewhere the
 * title or snippet must name the company.
 */
export function relevantSearchResults<T extends { url: string; title: string; snippet: string }>(results: readonly T[],
  companyName: string, officialWebsite?: string | null): T[] {
  const official = officialWebsite ? hostOf(officialWebsite.includes('://') ? officialWebsite : `https://${officialWebsite}`) : null;
  const name = companyName.replace(/\s*\(.*?\)\s*/g, ' ').replace(/,?\s+(inc|llc|ltd|corp|corporation|co|limited|plc|gmbh|s\.?a)\.?$/i, '').trim().toLowerCase();
  return results.filter((row) => {
    const host = hostOf(row.url);
    if (!host) return false;
    if (official && (host === official || host.endsWith(`.${official}`))) {
      return OWN_SITE_FACT_PATH.test(new URL(row.url).pathname);
    }
    return !name || `${row.title} ${row.snippet}`.toLowerCase().includes(name);
  });
}

/** At most three engine queries for the missing metrics, most valuable family first. */
export function huntSearchQueries(companyName: string, missing: readonly string[],
  options: { financialFirm?: boolean; escalation?: number; year?: number } = {}): HuntQuery[] {
  const year = options.year ?? new Date().getFullYear();
  const name = `"${companyName.replace(/"/g, '').trim()}"`;
  const queries: HuntQuery[] = QUERY_FAMILIES
    .filter((family) => family.types.some((t) => missing.includes(t)))
    .map((family) => ({ query: `${name} ${family.terms}`, news: family.news }));
  if (options.financialFirm && !queries.some((q) => q.query.includes('assets under management'))) {
    queries.unshift({ query: `${name} assets under management Form ADV`, news: false });
  }
  if ((options.escalation ?? 0) > 0) queries.unshift({ query: `${name} annual report filing disclosure`, news: false });
  return (queries.length ? queries : [{ query: `${name} company overview ${year}`, news: false }]).slice(0, 3);
}

export interface CappedWebSearch extends WebSearchFn {
  /** Provider requests actually sent so far. */
  readonly used: () => number;
}

/** Hard ceiling on provider requests (free allowances are small). Past the cap
 * the function answers [] without calling the provider, so the hunt falls back
 * to grounded search instead of spending more. */
export function cappedWebSearch(search: WebSearchFn, max: number, onSpend?: (used: number) => void): CappedWebSearch {
  let used = 0;
  const capped = (async (query: string, options?: SearchOptions) => {
    if (used >= max) return [];
    used += 1;
    onSpend?.(used);
    return search(query, options);
  }) as CappedWebSearch;
  Object.defineProperty(capped, 'used', { value: () => used });
  return capped;
}

/** Memoize identical queries (same text and options) for `ttlMs`: escalation
 * passes and the face sweep often repeat a company's query minutes apart. A
 * failed search is not cached. Bounded so a long session cannot grow it. */
export function cachedWebSearch(search: WebSearchFn, ttlMs = 30 * 60_000, maxEntries = 200, now = () => Date.now()): WebSearchFn {
  const cache = new Map<string, { at: number; results: Promise<WebSearchResult[]> }>();
  return (query, options) => {
    const key = JSON.stringify([query, options?.news ?? false, options?.sinceDays ?? null]);
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.results;
    const results = search(query, options);
    cache.set(key, { at: now(), results });
    results.catch(() => cache.delete(key));
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
    return results;
  };
}

export interface WebSearchLane {
  /** Run each query, merge distinct results into one set of discovery notes. */
  discover(queries: ReadonlyArray<string | HuntQuery>, scope?: { companyName: string; officialWebsite?: string | null }): Promise<DiscoveryNotes>;
}

const RELATIVE_AGE = /^(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago$/i;
const RELATIVE_MS: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000, year: 365 * 86_400_000 };

/** A provider's `published` text as a time, or null when it states none we can read ("2 days ago" counts). Never a guess. */
export function publishedAtMs(published: string | undefined, now: Date): number | null {
  const text = (published ?? '').trim();
  if (!text) return null;
  const relative = RELATIVE_AGE.exec(text);
  if (relative) return now.getTime() - Number(relative[1]) * RELATIVE_MS[relative[2]!.toLowerCase()]!;
  const at = Date.parse(text);
  // A date in the future is not a publication date.
  return Number.isFinite(at) && at <= now.getTime() + 86_400_000 ? at : null;
}

/** Newest first, undated last; ties and undated rows keep their provider order. Ordering only: the date is not stored (owner decision D9). */
export function orderByPublished<T extends { published?: string }>(rows: readonly T[], now: Date = new Date()): T[] {
  return rows.map((row, index) => ({ row, index, at: publishedAtMs(row.published, now) }))
    .sort((a, b) => (a.at === null) !== (b.at === null) ? (a.at === null ? 1 : -1) : (b.at ?? 0) - (a.at ?? 0) || a.index - b.index)
    .map((entry) => entry.row);
}

/** Wrap a search function as a hunt discovery lane. A failing query is skipped
 * (the caller falls back when nothing at all comes back). */
export function webSearchLane(search: WebSearchFn, sinceDays = HUNT_SEARCH_SINCE_DAYS): WebSearchLane {
  return {
    discover: async (rawQueries, scope) => {
      const queries = rawQueries.map((q) => typeof q === 'string' ? { query: q, news: false } : q);
      const settled = await Promise.allSettled(queries.map((q) => search(q.query, { news: q.news, sinceDays })));
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
      // Latest first: the newest dated result leads, undated last.
      const ordered = orderByPublished(merged);
      const kept = scope ? relevantSearchResults(ordered, scope.companyName, scope.officialWebsite) : ordered;
      const notes = searxngNotes(queries.map((q) => q.query).join(' | '), kept.map((r) => ({ ...r,
        snippet: r.published ? `${r.snippet} [published ${r.published}]` : r.snippet })));
      return { ...notes, queries: queries.map((q) => q.query) };
    },
  };
}
