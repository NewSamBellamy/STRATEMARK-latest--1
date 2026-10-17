/**
 * Free news discovery: Bing News RSS. No key, no account.
 *
 * Measured against the alternatives (2026-10): GDELT's DOC API throttles to one
 * request per 5 s and answered a single query in ~10 s with a 429; Google News
 * RSS links are opaque redirects, so the original article cannot be read. Bing
 * News RSS answered in ~0.3 s with real publisher URLs and publication dates —
 * exactly the dated funding/revenue reporting the passage gates need.
 *
 * Discovery only, like every search lane: a result names a candidate article.
 * Figures still come only from the article itself through the same gates.
 * The feed is unofficial, so every failure degrades to "no extra candidates".
 */
import type { WebSearchResult } from './web-search';

const MAX_RESULTS = 12;

export function bingNewsRssUrl(query: string): string {
  return `https://www.bing.com/news/search?q=${encodeURIComponent(query.slice(0, 300))}&format=rss&setlang=en-US`;
}

function decodeXml(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}

function tag(item: string, name: string): string {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(item);
  return match ? decodeXml(match[1]!).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
}

/** Bing percent-encodes punctuation in the source field ("Morningstar%2c Inc."); a name never carries a URL escape, so read it back. */
export function cleanPublisher(raw: string): string {
  const name = raw.replace(/\s+on MSN$/i, '');
  if (!/%[0-9a-f]{2}/i.test(name)) return name;
  try { return decodeURIComponent(name); } catch { return name; }
}

/** Bing wraps article links in an apiclick redirect; the real URL is its `url` parameter. */
function articleUrl(link: string): URL | null {
  try {
    const wrapped = new URL(link);
    const target = /(^|\.)bing\.com$/i.test(wrapped.hostname) ? wrapped.searchParams.get('url') : link;
    if (!target) return null;
    const url = new URL(target);
    url.hash = '';
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Parse the RSS body into https-only, de-duplicated, bounded results. */
export function parseBingNewsRss(xml: string): WebSearchResult[] {
  const seen = new Set<string>();
  const out: WebSearchResult[] = [];
  for (const match of xml.slice(0, 500_000).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = match[1]!;
    const url = articleUrl(tag(item, 'link'));
    if (!url || seen.has(url.href)) continue;
    seen.add(url.href);
    const published = tag(item, 'pubDate');
    const date = Number.isFinite(Date.parse(published)) ? new Date(published).toISOString().slice(0, 10) : '';
    const publisher = cleanPublisher(tag(item, 'News:Source')).slice(0, 120);
    out.push({ url: url.href, title: tag(item, 'title').slice(0, 200) || url.hostname,
      snippet: tag(item, 'description').slice(0, 600), ...(date ? { published: date } : {}), ...(publisher ? { publisher } : {}) });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

/** Relay side: fetch and parse one news query. Any failure is an empty result. */
export async function runNewsSearch(query: string, fetchImpl: typeof fetch, timeoutMs = 8_000): Promise<WebSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(bingNewsRssUrl(q), {
      signal: controller.signal,
      headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'Stratemark-Research/1.0 (+https://getstratemark.com)' },
    });
    if (!response.ok) return [];
    return parseBingNewsRss(await response.text());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Validate a news relay body: { query }. */
export function parseNewsRelayRequest(body: unknown): { query: string } | null {
  if (!body || typeof body !== 'object') return null;
  const query = (body as Record<string, unknown>).query;
  if (typeof query !== 'string') return null;
  const q = query.trim();
  return q.length >= 2 && q.length <= 300 ? { query: q } : null;
}
