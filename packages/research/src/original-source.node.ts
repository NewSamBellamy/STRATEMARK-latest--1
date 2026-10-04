/// <reference types="node" />
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';

const MAX_BYTES = 262144;
const MAX_TEXT = 4000;
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
import type { OriginalSourceReceipt } from './original-source';
// Pin the socket to the validated IPv4 address, but retain the original Host and
// TLS servername/certificate verification. No second DNS resolution or proxy.
const transport: SourceTransport = {
  lookup: async (host) => (await lookup(host, { all: true, family: 4 })).map((entry) => entry.address),
  read: ({ url, address, signal }) => new Promise((resolve, reject) => {
    const req = request({
      hostname: address, port: 443, servername: url.hostname,
      path: `${url.pathname}${url.search}`, method: 'GET', agent: false, signal,
      headers: { Host: url.hostname, Accept: 'text/html, text/plain', 'Accept-Encoding': 'identity', 'User-Agent': 'Stratemark-Research/1.0' },
    }, (res) => {
      const headers: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(res.headers)) headers[key] = Array.isArray(value) ? value.join(',') : value;
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) req.destroy(new Error('Source exceeds byte limit'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  }),
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
  return plain.replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (entity) => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ',
  })[entity] ?? entity).replace(/\s+/g, ' ').trim();
}

/** Retrieval is a receipt, NOT proof of entity, metric, period or truth. */
export async function retrieveOriginalSource(raw: string, io: SourceTransport = transport): Promise<OriginalSourceReceipt> {
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
      if (!['text/html', 'text/plain'].includes(type) ||
        (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') || response.body.length > MAX_BYTES) {
        return { ...receipt, reason: 'Unsupported or oversized source content' };
      }
      const body = response.body.toString('utf8');
      if (/noarchive|nosnippet/i.test(response.headers['x-robots-tag'] ?? '') ||
        /<meta\b(?=[^>]*\bname\s*=\s*["']?(?:robots|googlebot)\b)(?=[^>]*\bcontent\s*=\s*["'][^"']*(?:noarchive|nosnippet))[^>]*>/i.test(body)) {
        return { ...receipt, status: 'blocked', reason: 'Source prohibits retained extracts' };
      }
      const text = pageText(body, type === 'text/html');
      if (!text) return { ...receipt, reason: 'No readable source text' };
      return { ...receipt, status: 'retrieved', contentHash: createHash('sha256').update(response.body).digest('hex'), text: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT };
    }
    return receipt;
  };
  try {
    return await Promise.race([work(), new Promise<OriginalSourceReceipt>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve({ ...receipt, reason: 'Source retrieval timed out' }); }, 6000);
    })]);
  } catch {
    return { ...receipt, reason: 'Source retrieval failed' };
  } finally { if (timer) clearTimeout(timer); }
}
