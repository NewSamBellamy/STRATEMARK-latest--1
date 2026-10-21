import { isBrowserOriginalSourceSupported, retrieveBrowserOriginalSource, secAdvCrd } from '@mi/research';
import type { OriginalSourceReceipt, OriginalSourceScope } from '@mi/research';
import { hasHostedApi, hostedUrl } from '@/lib/hostedApi';

export function hasLocalSourceBridge(): boolean {
  return import.meta.env.DEV && ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname);
}

export type RelayRoute = 'source' | 'asset-source' | 'search' | 'news';

/**
 * Where server-side work goes (page reads, search, news): the Vite dev bridge
 * on localhost, the hosted Worker in a production build that has one,
 * otherwise nowhere (the browser falls back to what it can do directly).
 */
export function relayEndpoint(kind: RelayRoute): { url: string; headers: Record<string, string> } | null {
  if (hasLocalSourceBridge()) {
    return { url: `/__stratemark/${kind}`, headers: { 'Content-Type': 'application/json', 'X-Stratemark-Source': 'local-preview' } };
  }
  if (hasHostedApi()) return { url: hostedUrl(kind), headers: { 'Content-Type': 'application/json' } };
  return null;
}

export function supportsPreviewSource(raw: string): boolean {
  if (!relayEndpoint('source')) return isBrowserOriginalSourceSupported(raw);
  try {
    const url = new URL(raw);
    return raw.length <= 2048 && url.protocol === 'https:' && !url.username && !url.password &&
      (!url.port || url.port === '443');
  } catch { return false; }
}

/**
 * The relay (dev bridge or Worker) caps concurrent reads and answers 429 when
 * busy. A deck build issues far more reads at once than that cap, so reads
 * queue here instead of bouncing, and a busy answer waits and retries. A read
 * that still fails says WHY (busy, timed out) so callers can tell a transient
 * failure from a page that is simply not there.
 */
const MAX_RELAY_READS = 8;
let relayActive = 0;
const relayWaiting: Array<() => void> = [];

async function relaySlot<T>(work: () => Promise<T>): Promise<T> {
  if (relayActive >= MAX_RELAY_READS) await new Promise<void>((resolve) => relayWaiting.push(resolve));
  relayActive += 1;
  try { return await work(); } finally {
    relayActive -= 1;
    relayWaiting.shift()?.();
  }
}

type RelayAnswer = { response: Response } | { httpStatus?: number; reason: string };

async function relayPost(endpoint: { url: string; headers: Record<string, string> }, body: unknown, timeoutMs: number): Promise<RelayAnswer> {
  for (let attempt = 0; ; attempt += 1) {
    const answer = await relaySlot(async (): Promise<RelayAnswer> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(endpoint.url, {
          method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
          headers: endpoint.headers, body: JSON.stringify(body), signal: controller.signal,
        });
        return response.ok ? { response } : { httpStatus: response.status, reason: `Source reader answered ${response.status}.` };
      } catch {
        return { reason: controller.signal.aborted ? `Source read timed out after ${timeoutMs / 1000}s.` : 'Source reader network error.' };
      } finally { clearTimeout(timer); }
    });
    if ('response' in answer || answer.httpStatus !== 429 || attempt >= 3) return answer;
    await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt + Math.random() * 200));
  }
}

/** Server-side read (dev bridge or hosted Worker); both apply the desktop DNS/SSRF policy. */
export async function readPreviewSource(url: string, scope?: OriginalSourceScope): Promise<OriginalSourceReceipt> {
  const endpoint = relayEndpoint('source');
  if (!endpoint) return retrieveBrowserOriginalSource(url, undefined, scope);
  const fallback: OriginalSourceReceipt = {
    requestedUrl: url.slice(0, 2048), status: 'unavailable', retrievedAt: new Date().toISOString(),
    reason: 'Source reader unavailable. No source-backed facts were accepted.',
  };
  // The official Form ADV PDF download + bounded text extraction takes tens of
  // seconds; plain page reads stay on a snappy budget.
  const answer = await relayPost(endpoint, { url, scope }, secAdvCrd(url) ? 90_000 : 12_000);
  if (!('response' in answer)) return { ...fallback, reason: answer.reason, ...(answer.httpStatus ? { httpStatus: answer.httpStatus } : {}) };
  try {
    const receipt = await answer.response.json() as OriginalSourceReceipt;
    if (receipt.requestedUrl !== url || !['retrieved', 'blocked', 'unavailable'].includes(receipt.status) ||
      (receipt.status === 'retrieved' && (!receipt.text || !receipt.contentHash))) return fallback;
    return receipt;
  } catch { return fallback; }
}

/**
 * Asset lane reader: RAW HTML for logo/headshot parsing (the main reader
 * strips tags). Without the dev bridge or the hosted Worker the browser cannot
 * read cross-origin HTML, so the asset lane is honestly unavailable.
 */
export async function readAssetSource(url: string): Promise<OriginalSourceReceipt> {
  const endpoint = relayEndpoint('asset-source');
  if (!endpoint) {
    return {
      requestedUrl: url.slice(0, 2048), status: 'unavailable', retrievedAt: new Date().toISOString(),
      reason: 'Asset reads need the source reader.',
    };
  }
  const fallback: OriginalSourceReceipt = {
    requestedUrl: url.slice(0, 2048), status: 'unavailable', retrievedAt: new Date().toISOString(),
    reason: 'Asset source reader unavailable.',
  };
  const answer = await relayPost(endpoint, { url }, 15_000);
  if (!('response' in answer)) return { ...fallback, reason: answer.reason, ...(answer.httpStatus ? { httpStatus: answer.httpStatus } : {}) };
  try {
    const receipt = await answer.response.json() as OriginalSourceReceipt;
    if (receipt.requestedUrl !== url.slice(0, 2048) || !['retrieved', 'unavailable'].includes(receipt.status)) return fallback;
    return receipt;
  } catch { return fallback; }
}
