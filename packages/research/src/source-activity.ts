/**
 * The websites research touched most recently, for the deck status bar's
 * "Where research is looking" panel.
 *
 * Reported as it happens, never forecast: a row exists only because a page was
 * read, a search returned a site, or a grounded answer cited one. Absence is an
 * empty list. Only a bare hostname is ever stored (no path, query, credentials,
 * port or full URL), so nothing secret can leak through this feed.
 */
import type { SourceActivity } from '@mi/contracts';
import type { LlmClient } from './types';
import type { OriginalSourceReceipt, OriginalSourceScope, OriginalSourceServices } from './original-source';
import type { WebSearchFn } from './web-search';

export type SourceActivityKind = SourceActivity['kind'];

/** Newest rows kept; older ones fall off the front. */
export const SOURCE_ACTIVITY_CAP = 300;
/** The same (kind, site, company) inside this window is one row. */
export const SOURCE_ACTIVITY_DEDUPE_MS = 2000;

const MAX_COMPANY_LENGTH = 120;
const MAX_HOST_LENGTH = 253;

/** Hosts that only redirect to the real page. Without the real target they say nothing. */
const REDIRECT_HOSTS = new Set([
  'vertexaisearch.cloud.google.com',
  'news.google.com',
  't.co',
  'bit.ly',
  'tinyurl.com',
  'l.facebook.com',
  'lm.facebook.com',
  'lnkd.in',
  'ow.ly',
  'goo.gl',
  'rebrand.ly',
]);
/** Google's own result and click-tracking paths: wrappers, not pages. */
const GOOGLE_WRAPPER_PATHS = new Set(['/url', '/imgres', '/aclk', '/search', '/maps/dir']);
const PRIVATE_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet', '.private', '.test', '.invalid', '.example', '.arpa'];

function isGoogleHost(host: string): boolean {
  return host === 'google.com' || host.endsWith('.google.com') || /^(www\.)?google\.[a-z.]{2,6}$/.test(host);
}

function bareHostname(raw: string): string | null {
  let host = raw.toLowerCase();
  while (host.endsWith('.')) host = host.slice(0, -1);
  if (host.startsWith('www.')) host = host.slice(4);
  if (host.length === 0 || host.length > MAX_HOST_LENGTH) return null;
  if (host.includes('[') || host.includes(':')) return null; // IPv6
  const labels = host.split('.');
  if (labels.length < 2) return null; // localhost and single-label intranet names
  if (labels.every((label) => label.length > 0 && label.length <= 63 && /^[0-9]+$/.test(label))) return null; // IPv4
  if (!labels.every((label) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  if (/^[0-9]+$/.test(labels[labels.length - 1]!)) return null; // numeric TLD: an IP in disguise
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
  if (host === 'localhost' || host.endsWith('.localhost')) return null;
  return host;
}

const DEPTH_LIMIT = 2;

/**
 * Reduce a URL (or a bare host) to the site only. Null when it is not a public
 * http(s) site, or it is a redirect wrapper whose real target is unknown.
 */
export function reduceToHostname(input: string, depth = 0): string | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (text.length === 0 || text.length > 4096) return null;
  let candidate = text;
  if (text.includes('://')) {
    if (!/^https?:\/\//i.test(text)) return null;
  } else if (/^[a-z][a-z0-9+.-]*:(?!\d+([/?#]|$))/i.test(text)) {
    return null; // mailto:, data:, javascript:, file: ... (a "host:port" is allowed through)
  } else if (text.startsWith('//')) {
    candidate = `https:${text}`;
  } else {
    candidate = `https://${text}`;
  }
  let url: URL;
  try { url = new URL(candidate); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = bareHostname(url.hostname);
  if (!host) return null;
  if (host.includes('grounding-api-redirect')) return null;
  if (REDIRECT_HOSTS.has(host)) return null;
  if (isGoogleHost(host)) {
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (GOOGLE_WRAPPER_PATHS.has(path)) {
      // A click wrapper names its real target in a query parameter. Use it only when it is a real site.
      if (path === '/url' && depth < DEPTH_LIMIT) {
        const target = url.searchParams.get('q') ?? url.searchParams.get('url');
        if (target && /^https?:\/\//i.test(target)) return reduceToHostname(target, depth + 1);
      }
      return null;
    }
  }
  return host;
}

export class SourceActivityLog {
  private rows: SourceActivity[] = [];
  private nextId = 1;
  private readonly recent = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Record that research touched a site. Returns false when nothing was stored. */
  record(kind: SourceActivityKind, urlOrHost: string, company: string | null = null): boolean {
    const domain = reduceToHostname(urlOrHost);
    if (!domain) return false;
    const name = typeof company === 'string' ? company.trim().slice(0, MAX_COMPANY_LENGTH) : '';
    const owner = name.length > 0 ? name : null;
    const nowMs = this.now();
    const key = `${kind}\u0000${domain}\u0000${owner ?? ''}`;
    const last = this.recent.get(key);
    if (last !== undefined && nowMs - last < SOURCE_ACTIVITY_DEDUPE_MS && nowMs >= last) return false;
    this.recent.set(key, nowMs);
    if (this.recent.size > SOURCE_ACTIVITY_CAP * 4) {
      for (const [k, at] of this.recent) if (nowMs - at >= SOURCE_ACTIVITY_DEDUPE_MS) this.recent.delete(k);
    }
    this.rows.push({ id: this.nextId, at: new Date(nowMs).toISOString(), domain, kind, company: owner });
    this.nextId += 1;
    if (this.rows.length > SOURCE_ACTIVITY_CAP) this.rows.splice(0, this.rows.length - SOURCE_ACTIVITY_CAP);
    return true;
  }

  /** Rows with id above `sinceId`, oldest first, and the newest id issued (0 when none yet). */
  list(sinceId = 0): { items: SourceActivity[]; lastId: number } {
    const after = Number.isFinite(sinceId) ? Math.max(0, Math.floor(sinceId)) : 0;
    return { items: this.rows.filter((row) => row.id > after).map((row) => ({ ...row })), lastId: this.nextId - 1 };
  }
}

/** Never lets reporting break research. */
function safely(fn: () => void): void {
  try { fn(); } catch { /* a status feed must never fail a read, a search or an answer */ }
}

/** Copy own properties a lane carries (e.g. a capped search's `used`) onto its wrapper. */
function carryProperties<T extends object>(wrapper: T, source: object): T {
  const skip = new Set(['length', 'name', 'prototype', 'caller', 'arguments']);
  const descriptors = Object.getOwnPropertyDescriptors(source);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key === 'string' && skip.has(key)) continue;
    Object.defineProperty(wrapper, key, descriptors[key as keyof typeof descriptors]!);
  }
  return wrapper;
}

/** A search lane that reports the sites its result sets name (never the query). */
export function observeSearch(lane: WebSearchFn, log: SourceActivityLog): WebSearchFn {
  const observed: WebSearchFn = async (...args: Parameters<WebSearchFn>) => {
    const results = await lane(...args);
    safely(() => { for (const result of results) if (result?.url) log.record('searched', result.url, null); });
    return results;
  };
  return carryProperties(observed, lane);
}

/** A page reader that reports each page it starts reading. */
export function observeRead<A extends [string, ...unknown[]]>(
  read: (...args: A) => Promise<OriginalSourceReceipt>, log: SourceActivityLog,
  company?: (...args: A) => string | null,
): (...args: A) => Promise<OriginalSourceReceipt> {
  return (...args: A) => {
    safely(() => log.record('read', args[0], company?.(...args) ?? null));
    return read(...args);
  };
}

/** Original-source services whose retrievals report the page being read. */
export function observeOriginalSources(sources: OriginalSourceServices, log: SourceActivityLog): OriginalSourceServices {
  const retrieve = observeRead<[string, OriginalSourceScope?]>(
    (url, scope) => sources.retrieve(url, scope), log, (_url, scope) => scope?.companyName ?? null);
  return {
    ...(sources.supports ? { supports: (url: string) => sources.supports!(url) } : {}),
    retrieve: (url, scope) => retrieve(url, scope),
    save: (attempt) => sources.save(attempt),
    list: (input) => sources.list(input),
  };
}

/** A fetch-like function (JSON fetchers, `fetch` itself) that reports the site it is asked for. */
export function observeFetch<A extends [string, ...unknown[]], R>(
  fetcher: (...args: A) => Promise<R>, log: SourceActivityLog,
): (...args: A) => Promise<R> {
  return (...args: A) => {
    safely(() => log.record('read', args[0], null));
    return fetcher(...args);
  };
}

/** `typeof fetch` whose first argument may be a string, URL or Request. */
export function observeFetchApi(fetchImpl: typeof fetch, log: SourceActivityLog): typeof fetch {
  const observed = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    safely(() => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as { url?: string }).url;
      if (typeof url === 'string') log.record('read', url, null);
    });
    return fetchImpl(input, init);
  }) as typeof fetch;
  return observed;
}

/**
 * A client whose grounded answers report the sites they cite ('found'). Redirect
 * wrappers are skipped by the log itself, so only real sources appear.
 */
export function observeGrounding(client: LlmClient, log: SourceActivityLog): LlmClient {
  return {
    ...client,
    async ground(prompt, opts) {
      const answer = await client.ground(prompt, opts);
      safely(() => {
        const company = opts?.researchContext?.companyName ?? null;
        for (const citation of answer.citations ?? []) {
          if (citation?.url && /^https:\/\//i.test(citation.url)) log.record('found', citation.url, company);
        }
      });
      return answer;
    },
  };
}
