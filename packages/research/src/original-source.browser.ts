import type { OriginalSourceReceipt, OriginalSourceScope } from './original-source';
import { selectSourceExcerpt } from './source-excerpt';

// Browser networking cannot pin DNS like the native transport. Only these
// established public source hosts are eligible; arbitrary company domains need
// identity validation and a protected native/configured retrieval capability.
const hosts = ['sec.gov', 'uscourts.gov', 'companieshouse.gov.uk', 'find-and-update.company-information.service.gov.uk', 'sedarplus.ca', 'hkexnews.hk', 'reuters.com', 'bloomberg.com', 'wsj.com', 'ft.com', 'apnews.com', 'nytimes.com', 'bbc.com', 'bbc.co.uk', 'economist.com'];
const limit = 262144;

function supportedUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (raw.length > 2048 || url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

/** True only when the browser reader can attempt a direct, non-redirected read. */
export function isBrowserOriginalSourceSupported(raw: string): boolean { return supportedUrl(raw) !== null; }

/** Direct public CORS retrieval only. No proxy, key, cookies or redirect bypass. */
export async function retrieveBrowserOriginalSource(raw: string, fetchImpl: typeof fetch = fetch, scope?: OriginalSourceScope): Promise<OriginalSourceReceipt> {
  const receipt: OriginalSourceReceipt = { requestedUrl: raw.slice(0, 2048), status: 'unavailable', retrievedAt: new Date().toISOString() };
  const url = supportedUrl(raw);
  if (!url) return { ...receipt, status: 'blocked', reason: 'Browser source requires a supported public HTTPS host; use desktop for protected retrieval of other sources.' };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async (): Promise<OriginalSourceReceipt> => {
    const requestOptions = { signal: controller.signal, mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' } as const;
    const response = await fetchImpl(url.href, requestOptions);
    if (response.type === 'opaque' || response.redirected || (response.url && response.url !== url.href)) return { ...receipt, reason: 'Unreadable or redirected browser source' };
    const resolved = { ...receipt, finalUrl: url.href, httpStatus: response.status };
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (response.status !== 200 || !['text/html', 'text/plain'].includes(type) || Number(response.headers.get('content-length') ?? 0) > limit) {
      await response.body?.cancel();
      return { ...resolved, reason: 'Unsupported, oversized or unavailable source content' };
    }
    if (/noarchive|nosnippet/i.test(response.headers.get('x-robots-tag') ?? '')) {
      await response.body?.cancel();
      return { ...resolved, status: 'blocked', reason: 'Source prohibits retained extracts' };
    }
    if (!response.body) return { ...resolved, reason: 'No readable source body' };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        controller.signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) { await reader.cancel(); return { ...resolved, reason: 'Source exceeds byte limit' }; }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = new TextDecoder().decode(bytes);
    if (/<meta\b(?=[^>]*\bname\s*=\s*["']?(?:robots|googlebot)\b)(?=[^>]*\bcontent\s*=\s*["'][^"']*(?:noarchive|nosnippet))[^>]*>/i.test(body)) return { ...resolved, status: 'blocked', reason: 'Source prohibits retained extracts' };
    const plain = type === 'text/html' ? body.replace(/<!--[^]*?-->/g, ' ').replace(/<(script|style|noscript)\b[^>]*>[^]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ') : body;
    const text = plain.replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity] ?? entity).replace(/\s+/g, ' ').trim();
    if (!text) return { ...resolved, reason: 'No readable source text' };
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return { ...resolved, status: 'retrieved', contentHash: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''), text: selectSourceExcerpt(text, scope), truncated: text.length > 4000 };
  };
  try {
    return await Promise.race([work(), new Promise<OriginalSourceReceipt>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve({ ...receipt, reason: 'Browser source retrieval timed out' }); }, 6000);
    })]);
  } catch { return { ...receipt, reason: 'Browser could not read this source (CORS, network or redirect restriction). Use desktop for protected retrieval.' }; }
  finally { controller.abort(); if (timer) clearTimeout(timer); }
}
