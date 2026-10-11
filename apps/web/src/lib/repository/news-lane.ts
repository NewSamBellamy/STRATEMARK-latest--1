/**
 * The free news lane for the metrics hunt: dated news articles as extra
 * candidates, through the relay (dev bridge or hosted Worker). No key.
 *
 * One cached search function per page session: escalation passes and the face
 * sweep repeat a company's queries minutes apart, and the feed is unofficial,
 * so identical queries are answered from memory for 30 minutes. Any relay
 * failure is "no leads", never an error in the hunt.
 */
import { cachedWebSearch, type WebSearchFn, type WebSearchResult } from '@mi/research';
import { relayEndpoint } from './local-source-reader';

const TIMEOUT_MS = 8_000;
let lane: WebSearchFn | null | undefined;

async function relayNews(query: string): Promise<WebSearchResult[]> {
  const endpoint = relayEndpoint('news');
  if (!endpoint) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(endpoint.url, { method: 'POST', credentials: 'omit', cache: 'no-store', signal: controller.signal,
      headers: endpoint.headers, body: JSON.stringify({ query }) });
    if (!response.ok) return [];
    const body = await response.json() as { results?: unknown };
    return Array.isArray(body.results)
      ? (body.results as WebSearchResult[]).filter((r) => typeof r?.url === 'string' && r.url.startsWith('https://')).slice(0, 8)
      : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** The hunt's news lane, or null when this build has no relay. */
export function currentNewsSearch(): WebSearchFn | null {
  if (lane === undefined) lane = relayEndpoint('news') ? cachedWebSearch((query) => relayNews(query)) : null;
  return lane;
}
