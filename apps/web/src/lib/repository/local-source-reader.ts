import { isBrowserOriginalSourceSupported, retrieveBrowserOriginalSource, secAdvCrd } from '@mi/research';
import type { OriginalSourceReceipt, OriginalSourceScope } from '@mi/research';
import { hasHostedApi, hostedUrl } from '@/lib/hostedApi';

export function hasLocalSourceBridge(): boolean {
  return import.meta.env.DEV && ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname);
}

/**
 * Where server-side page reads go: the Vite dev bridge on localhost, the
 * hosted Worker in a production build that has one, otherwise nowhere (the
 * browser falls back to the few sources it can read directly).
 */
function sourceEndpoint(kind: 'source' | 'asset-source'): { url: string; headers: Record<string, string> } | null {
  if (hasLocalSourceBridge()) {
    return { url: `/__stratemark/${kind}`, headers: { 'Content-Type': 'application/json', 'X-Stratemark-Source': 'local-preview' } };
  }
  if (hasHostedApi()) return { url: hostedUrl(kind), headers: { 'Content-Type': 'application/json' } };
  return null;
}

export function supportsPreviewSource(raw: string): boolean {
  if (!sourceEndpoint('source')) return isBrowserOriginalSourceSupported(raw);
  try {
    const url = new URL(raw);
    return raw.length <= 2048 && url.protocol === 'https:' && !url.username && !url.password &&
      (!url.port || url.port === '443');
  } catch { return false; }
}

/** Server-side read (dev bridge or hosted Worker); both apply the desktop DNS/SSRF policy. */
export async function readPreviewSource(url: string, scope?: OriginalSourceScope): Promise<OriginalSourceReceipt> {
  const endpoint = sourceEndpoint('source');
  if (!endpoint) return retrieveBrowserOriginalSource(url, undefined, scope);
  const fallback: OriginalSourceReceipt = {
    requestedUrl: url.slice(0, 2048), status: 'unavailable', retrievedAt: new Date().toISOString(),
    reason: 'Source reader unavailable. No source-backed facts were accepted.',
  };
  const controller = new AbortController();
  // The official Form ADV PDF download + bounded text extraction takes tens of
  // seconds; plain page reads stay on a snappy budget.
  const timeoutMs = secAdvCrd(url) ? 90_000 : 12_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: endpoint.headers, body: JSON.stringify({ url, scope }), signal: controller.signal,
    });
    if (!response.ok) return fallback;
    const receipt = await response.json() as OriginalSourceReceipt;
    if (receipt.requestedUrl !== url || !['retrieved', 'blocked', 'unavailable'].includes(receipt.status) ||
      (receipt.status === 'retrieved' && (!receipt.text || !receipt.contentHash))) return fallback;
    return receipt;
  } catch { return fallback; }
  finally { clearTimeout(timer); }
}

/**
 * Asset lane reader: RAW HTML for logo/headshot parsing (the main reader
 * strips tags). Without the dev bridge or the hosted Worker the browser cannot
 * read cross-origin HTML, so the asset lane is honestly unavailable.
 */
export async function readAssetSource(url: string): Promise<OriginalSourceReceipt> {
  const endpoint = sourceEndpoint('asset-source');
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: endpoint.headers, body: JSON.stringify({ url }), signal: controller.signal,
    });
    if (!response.ok) return fallback;
    const receipt = await response.json() as OriginalSourceReceipt;
    if (receipt.requestedUrl !== url.slice(0, 2048) || !['retrieved', 'unavailable'].includes(receipt.status)) return fallback;
    return receipt;
  } catch { return fallback; }
  finally { clearTimeout(timer); }
}
