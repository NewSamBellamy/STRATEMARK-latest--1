import { isBrowserOriginalSourceSupported, retrieveBrowserOriginalSource, secAdvCrd } from '@mi/research';
import type { OriginalSourceReceipt, OriginalSourceScope } from '@mi/research';

export function hasLocalSourceBridge(): boolean {
  return import.meta.env.DEV && ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname);
}

export function supportsPreviewSource(raw: string): boolean {
  if (!hasLocalSourceBridge()) return isBrowserOriginalSourceSupported(raw);
  try {
    const url = new URL(raw);
    return raw.length <= 2048 && url.protocol === 'https:' && !url.username && !url.password &&
      (!url.port || url.port === '443');
  } catch { return false; }
}

/** Development loopback only. The server applies the desktop DNS/SSRF policy. */
export async function readPreviewSource(url: string, scope?: OriginalSourceScope): Promise<OriginalSourceReceipt> {
  if (!hasLocalSourceBridge()) return retrieveBrowserOriginalSource(url, undefined, scope);
  const fallback: OriginalSourceReceipt = {
    requestedUrl: url.slice(0, 2048), status: 'unavailable', retrievedAt: new Date().toISOString(),
    reason: 'Local source reader unavailable. No source-backed facts were accepted.',
  };
  const controller = new AbortController();
  // The official Form ADV PDF download + bounded text extraction takes tens of
  // seconds; plain page reads stay on the snappy 8s budget.
  const timeoutMs = secAdvCrd(url) ? 90_000 : 8000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('/__stratemark/source', {
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Stratemark-Source': 'local-preview' },
      body: JSON.stringify({ url, scope }), signal: controller.signal,
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
 * Asset lane reader: RAW HTML for logo/headshot parsing (the main bridge
 * strips tags). Development loopback only; outside the bridge the browser
 * cannot read cross-origin HTML, so the asset lane is honestly unavailable.
 */
export async function readAssetSource(url: string): Promise<OriginalSourceReceipt> {
  if (!hasLocalSourceBridge()) {
    return {
      requestedUrl: url.slice(0, 2048), status: 'unavailable', retrievedAt: new Date().toISOString(),
      reason: 'Asset reads need the local source bridge.',
    };
  }
  const fallback: OriginalSourceReceipt = {
    requestedUrl: url.slice(0, 2048), status: 'unavailable', retrievedAt: new Date().toISOString(),
    reason: 'Asset source reader unavailable.',
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch('/__stratemark/asset-source', {
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Stratemark-Source': 'local-preview' },
      body: JSON.stringify({ url }), signal: controller.signal,
    });
    if (!response.ok) return fallback;
    const receipt = await response.json() as OriginalSourceReceipt;
    if (receipt.requestedUrl !== url.slice(0, 2048) || !['retrieved', 'unavailable'].includes(receipt.status)) return fallback;
    return receipt;
  } catch { return fallback; }
  finally { clearTimeout(timer); }
}
