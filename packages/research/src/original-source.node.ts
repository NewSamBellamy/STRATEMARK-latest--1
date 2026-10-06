/// <reference types="node" />
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { setTimeout as wait } from 'node:timers/promises';
import { selectSourceExcerpt } from './source-excerpt';
import { MAX_SEC_CONCEPT_TEXT, secFilingCik, secRevenueCik } from './sec-revenue';

// Annual filings routinely exceed 256 KB (Microsoft's 2025 HTML is ~601 KB).
// Keep whole-document hashing bounded; retained excerpts remain only 4,000 chars.
const MAX_BYTES = 2 * 1024 * 1024;
// Current inline-XBRL 10-Ks can exceed 8 MB. Only direct SEC filing
// documents get this larger bounded download; retained text stays 4 KB.
const MAX_SEC_FILING_BYTES = 12 * 1024 * 1024;
const MAX_TEXT = 4000;
let nextSecReadAt = 0;
const denied = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) denied.addSubnet(address, prefix, 'ipv4');

export interface SourceRead {
  status: number;
  headers: Record<string, string | undefined>;
  body: Buffer;
}
export interface SourceTransport {
  lookup(host: string): Promise<string[]>;
  read(target: { url: URL; address: string; signal: AbortSignal }): Promise<SourceRead>;
}
export type { OriginalSourceReceipt } from './original-source';
import type { OriginalSourceReceipt, OriginalSourceScope } from './original-source';
// Pin the socket to the validated IPv4 address, but retain the original Host and
// TLS servername/certificate verification. No second DNS resolution or proxy.
const transport: SourceTransport = {
  lookup: async (host) => (await lookup(host, { all: true, family: 4 })).map((entry) => entry.address),
  read: async ({ url, address, signal }) => {
    // Shared per-process courtesy limit; no unbounded retry/fetch fanout. A
    // multi-instance cloud rollout must coordinate its aggregate SEC budget.
    if (url.hostname === 'sec.gov' || url.hostname.endsWith('.sec.gov')) {
      const delay = Math.max(0, nextSecReadAt - Date.now());
      if (delay > 5000) throw new Error('SEC retrieval queue is busy');
      nextSecReadAt = Date.now() + delay + 500;
      await wait(delay, undefined, { signal });
    }
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
    const req = request({
      hostname: address, port: 443, servername: url.hostname,
      path: `${url.pathname}${url.search}`, method: 'GET', agent: false, signal,
      headers: { Host: url.hostname, Accept: 'text/html, text/plain, application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'Stratemark-Research/1.0 (+https://getstratemark.com)' },
    }, (res) => {
      const headers: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(res.headers)) headers[key] = Array.isArray(value) ? value.join(',') : value;
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > (secFilingCik(url.href) ? MAX_SEC_FILING_BYTES : MAX_BYTES)) req.destroy(Object.assign(new Error('Source exceeds byte limit'), { code: 'SOURCE_TOO_LARGE' }));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
    });
  },
};

function safeUrl(raw: string): URL | null {
  try {
    if (raw.length > 2048) return null;
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      isIP(url.hostname.replace(/^\[|\]$/g, '')) || !url.hostname.includes('.') ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

function pageText(body: string, html: boolean): string {
  const plain = html ? body.replace(/<!--[^]*?-->/g, ' ')
    .replace(/<(script|style|noscript)\b[^>]*>[^]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ') : body;
  return plain.replace(/&#(x[\da-f]+|\d+);/gi, (entity, digits: string) => {
    const code = /^x/i.test(digits) ? parseInt(digits.slice(1), 16) : Number(digits);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
  }).replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (entity) => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ',
  })[entity] ?? entity).replace(/\s+/g, ' ').trim();
}

function secRegistrantName(body: string): string | null {
  const match = /<ix:nonNumeric\b[^>]*\bname\s*=\s*['"]dei:EntityRegistrantName['"][^>]*>([^]{1,4096}?)<\/ix:nonNumeric\s*>/i.exec(body);
  const value = match?.[1] ? pageText(match[1], true) : null;
  return value && value.length <= 256 ? value : null;
}

/** An index is only a locator. Follow one actual 10-K link in its own
 * accession directory; never external URLs, another issuer, or an exhibit. */
function secIndexDocument(body: string, index: URL): string | null {
  if (!secFilingCik(index.href) || !/\/\d{10}-\d{2}-\d{6}-index\.html?$/.test(index.pathname)) return null;
  const directory = index.pathname.slice(0, index.pathname.lastIndexOf('/') + 1);
  const visible = body.replace(/<!--[^]*?-->/g, '').replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, '');
  const candidates = new Set<string>();
  for (const row of visible.matchAll(/<tr\b[^>]*>([^]*?)<\/tr\s*>/gi)) {
    if (!/<td\b[^>]*>\s*10-K(?:\/A)?\s*<\/td\s*>/i.test(row[1]!)) continue;
    const href = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(row[1]!)?.[1];
    if (!href) continue;
    try {
      let document = new URL(href.replaceAll('&amp;', '&'), index);
      if (document.origin === index.origin && document.pathname === '/ix' && document.searchParams.getAll('doc').length === 1)
        document = new URL(document.searchParams.get('doc')!, index);
      if (document.origin === index.origin && !document.username && !document.password && !document.search && !document.hash &&
        document.pathname.startsWith(directory) && !document.pathname.slice(directory.length).includes('/') &&
        /\.html?$/.test(document.pathname) && document.href !== index.href) candidates.add(document.href);
    } catch { /* Malformed locators are never followed. */ }
  }
  return candidates.size === 1 ? [...candidates][0]! : null;
}

/** Retrieval is a receipt, NOT proof of entity, metric, period or truth. */
export async function retrieveOriginalSource(raw: string, io: SourceTransport = transport, scope?: OriginalSourceScope): Promise<OriginalSourceReceipt> {
  const receipt: OriginalSourceReceipt = { requestedUrl: raw.slice(0, 2048), status: 'unavailable', retrievedAt: new Date().toISOString() };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async (): Promise<OriginalSourceReceipt> => {
    let target = raw;
    for (let hop = 0; hop <= 3; hop++) {
      const url = safeUrl(target);
      if (!url) return { ...receipt, status: 'blocked', reason: 'Unsafe source URL' };
      const addresses = await io.lookup(url.hostname);
      if (!addresses.length || addresses.some((ip) => isIP(ip) !== 4 || denied.check(ip, 'ipv4'))) {
        return { ...receipt, status: 'blocked', reason: 'Non-public or unsupported source address' };
      }
      controller.signal.throwIfAborted();
      const response = await io.read({ url, address: addresses[0]!, signal: controller.signal });
      receipt.finalUrl = url.href;
      receipt.httpStatus = response.status;
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.headers.location || hop === 3) return { ...receipt, reason: 'Redirect limit or missing destination' };
        target = new URL(response.headers.location, url).href;
        continue;
      }
      if (response.status !== 200) return { ...receipt, reason: 'Source did not return a readable public page' };
      const type = (response.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      const byteLimit = secFilingCik(url.href) ? MAX_SEC_FILING_BYTES : MAX_BYTES;
      if (response.body.length > byteLimit) return { ...receipt, reason: `Source exceeds the ${byteLimit / 1024 / 1024} MB document limit` };
      const secJson = type === 'application/json' && Boolean(secRevenueCik(url.href));
      if ((!['text/html', 'text/plain'].includes(type) && !secJson) ||
        (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
        return { ...receipt, reason: 'Unsupported or oversized source content' };
      }
      const body = response.body.toString('utf8');
      if (/noarchive|nosnippet/i.test(response.headers['x-robots-tag'] ?? '') ||
        /<meta\b(?=[^>]*\bname\s*=\s*["']?(?:robots|googlebot)\b)(?=[^>]*\bcontent\s*=\s*["'][^"']*(?:noarchive|nosnippet))[^>]*>/i.test(body)) {
        return { ...receipt, status: 'blocked', reason: 'Source prohibits retained extracts' };
      }
      if (secJson) {
        if (body.length > MAX_SEC_CONCEPT_TEXT) return { ...receipt, reason: 'SEC concept exceeds the retained document limit' };
        try { JSON.parse(body); } catch { return { ...receipt, reason: 'SEC source did not return valid JSON' }; }
        return { ...receipt, status: 'retrieved', format: 'sec-companyconcept', text: body, truncated: false,
          contentHash: createHash('sha256').update(response.body).digest('hex') };
      }
      const filingDocument = type === 'text/html' && scope?.metricType === 'employees' ? secIndexDocument(body, url) : null;
      if (filingDocument && hop < 3) { target = filingDocument; continue; }
      const text = pageText(body, type === 'text/html');
      if (!text) return { ...receipt, reason: 'No readable source text' };
      const issuerName = type === 'text/html' ? secRegistrantName(body) : null;
      const filingCik = secFilingCik(url.href);
      if (filingCik && issuerName) {
        const excerptScope = scope?.companyName
          ? { companyName: scope.companyName, metricType: scope.metricType === 'company_profile' ? 'employees' : scope.metricType }
          : undefined;
        return { ...receipt, status: 'retrieved', format: 'sec-filing', issuerName,
          contentHash: createHash('sha256').update(response.body).digest('hex'),
          text: selectSourceExcerpt(text, excerptScope), truncated: false };
      }
      return { ...receipt, status: 'retrieved', contentHash: createHash('sha256').update(response.body).digest('hex'), text: selectSourceExcerpt(text, scope), truncated: text.length > MAX_TEXT };
    }
    return receipt;
  };
  try {
    return await Promise.race([work(), new Promise<OriginalSourceReceipt>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve({ ...receipt, reason: 'Source retrieval timed out' }); }, 6000);
    })]);
  } catch (error) {
    const oversized = error && typeof error === 'object' && 'code' in error && error.code === 'SOURCE_TOO_LARGE';
    return { ...receipt, reason: oversized ? 'Source exceeds the 2 MB document limit' : 'Source retrieval failed' };
  } finally { if (timer) clearTimeout(timer); }
}
