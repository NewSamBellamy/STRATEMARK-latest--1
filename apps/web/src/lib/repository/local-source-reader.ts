import { isBrowserOriginalSourceSupported, retrieveBrowserOriginalSource } from '@mi/research';
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
  const timer = setTimeout(() => controller.abort(), 8000);
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
