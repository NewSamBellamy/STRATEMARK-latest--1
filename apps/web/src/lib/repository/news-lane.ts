/**
 * The free news lane for the metrics hunt: dated news articles as extra
 * candidates, through the relay (dev bridge or hosted Worker). No key.
 *
 * One cached search function per page session: escalation passes and the face
 * sweep repeat a company's queries minutes apart, and the feed is unofficial,
 * so identical queries are answered from memory for 30 minutes. For the hunt a
 * relay failure is "no leads", never an error. For Today it is an error: an
 * unreachable feed must not look like "no news" (the company is retried), and
 * a failure is never cached.
 */
import { cachedWebSearch, type WebSearchFn, type WebSearchResult } from '@mi/research';
import { relayEndpoint } from './local-source-reader';

const TIMEOUT_MS = 8_000;
let strictLane: WebSearchFn | null | undefined;
let huntLane: WebSearchFn | null | undefined;

/** Throws when the relay is unreachable, refuses, times out or answers nonsense; [] only when it answered nothing. */
async function relayNews(query: string): Promise<WebSearchResult[]> {
  const endpoint = relayEndpoint('news');
  if (!endpoint) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(endpoint.url, { method: 'POST', credentials: 'omit', cache: 'no-store', signal: controller.signal,
      headers: endpoint.headers, body: JSON.stringify({ query }) });
    if (!response.ok) throw new Error(`The news relay answered ${response.status}.`);
    const body = await response.json() as { results?: unknown };
    if (!Array.isArray(body.results)) throw new Error('The news relay answered something unreadable.');
    return (body.results as WebSearchResult[]).filter((r) => typeof r?.url === 'string' && r.url.startsWith('https://')).slice(0, 12);
  } finally {
    clearTimeout(timer);
  }
}

function strictNewsSearch(): WebSearchFn | null {
  if (strictLane === undefined) strictLane = relayEndpoint('news') ? cachedWebSearch((query) => relayNews(query)) : null;
  return strictLane;
}

/** The hunt's news lane (failures are no leads), or null when this build has no relay. */
export function currentNewsSearch(): WebSearchFn | null {
  if (huntLane === undefined) {
    const strict = strictNewsSearch();
    huntLane = strict ? (async (query, options) => { try { return await strict(query, options); } catch { return []; } }) : null;
  }
  return huntLane;
}

/** Today's news lane: throws when the feed is down, so the engine retries the company. */
export function currentMovesNewsSearch(): WebSearchFn | null {
  return strictNewsSearch();
}
