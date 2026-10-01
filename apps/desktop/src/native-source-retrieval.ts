import dns, { type LookupAddress } from 'node:dns';
import http, { type ClientRequest, type IncomingMessage } from 'node:http';
import https, { type RequestOptions } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { performance } from 'node:perf_hooks';

export type SourceRetrievalResult = {
  originalUrl: string;
  canonicalUrl: string;
  text: string | null;
  retrievalStatus: 'retrieved' | 'partial' | 'failed' | 'blocked';
  reason: string | null;
};

export type SourceRetrievalOptions = {
  signal: AbortSignal;
  beforeRequest?: () => void;
  /** Trusted, in-process test seams only; never accept these over IPC. */
  testDependencies?: {
    resolve?: (hostname: string, signal: AbortSignal) => Promise<readonly LookupAddress[]>;
    request?: (
      options: RequestOptions,
      onResponse: (response: IncomingMessage) => void,
    ) => ClientRequest;
  };
};

const MAX_BYTES = 256 * 1024;
const MAX_TEXT = 20_000;
const MAX_URL = 2_048;
const TIMEOUT_MS = 15_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const special = new BlockList();
// Conservatively deny special-purpose ranges, including their globally reachable exceptions.
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  special.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['2620:4f:8000::', 48],
  ['3fff::', 20],
] as const)
  special.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

class RetrievalFailure extends Error {
  constructor(
    readonly status: 'failed' | 'blocked',
    reason: string,
  ) {
    super(reason);
  }
}

class AuthorityFailure extends Error {
  constructor(readonly original: unknown) {
    super('Source request authority rejected.');
  }
}

function fail(reason = 'Source retrieval failed.'): never {
  throw new RetrievalFailure('failed', reason);
}

function block(reason = 'Source target is not allowed.'): never {
  throw new RetrievalFailure('blocked', reason);
}

function abortError() {
  const error = new Error('Source retrieval cancelled.');
  error.name = 'AbortError';
  return error;
}

function publicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !special.check(address, 'ipv4');
  // Allow only global unicast; excludes mapped/compatible IPv4, NAT64, ULA, link/site-local,
  // multicast, unspecified and loopback rather than attempting to unwrap embedded addresses.
  return family === 6 && globalV6.check(address, 'ipv6') && !special.check(address, 'ipv6');
}

function target(input: string, previous?: URL) {
  if (input.length > MAX_URL) block();
  let url: URL;
  try {
    url = new URL(input, previous);
  } catch {
    block();
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) ||
    (previous?.protocol === 'https:' && url.protocol === 'http:')
  )
    block();
  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (isIP(hostname)) {
    if (!publicAddress(hostname)) block();
  } else {
    if (
      hostname.length > 253 ||
      !hostname.includes('.') ||
      hostname.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      /(?:^|\.)(?:localhost|local|localdomain|internal|home|lan|test|invalid|example|onion|alt|arpa)$/.test(
        hostname,
      )
    )
      block();
    url.hostname = hostname;
  }
  url.hash = '';
  if (url.href.length > MAX_URL) block();
  return { url, hostname };
}

function resolveAll(hostname: string): Promise<LookupAddress[]> {
  // Node's OS lookup has no cancellation API. The enclosing abort race settles immediately;
  // a late callback cannot dispatch a request and is never awaited during shutdown.
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (error, answers) => {
      if (error) reject(error);
      else resolve(answers);
    });
  });
}

function cancellable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener('abort', aborted);
      reject(signal.reason);
    };
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

function pin(answer: LookupAddress): LookupFunction {
  const address = answer.address;
  const family = answer.family;
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

function decodeEntity(entity: string) {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  const name = entity.slice(1, -1);
  if (Object.hasOwn(named, name)) return named[name]!;
  if (!name.startsWith('#')) return entity;
  const value =
    name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
  return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
    ? String.fromCodePoint(value)
    : '\ufffd';
}

function htmlText(html: string) {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start < 0) {
      parts.push(html.slice(cursor));
      break;
    }
    parts.push(html.slice(cursor, start));
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      cursor = end < 0 ? html.length : end + 3;
      continue;
    }
    let end = start + 1;
    let quote = '';
    for (; end < html.length; end++) {
      const char = html[end]!;
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === html.length) break;
    const tag = /^<\s*(\/?)([a-z][a-z0-9]*)\b/i.exec(html.slice(start, end + 1));
    cursor = end + 1;
    if (tag && !tag[1] && /^(script|style)$/i.test(tag[2]!)) {
      const closing = new RegExp(`</${tag[2]}\\s*>`, 'ig');
      closing.lastIndex = cursor;
      const match = closing.exec(html);
      cursor = match ? closing.lastIndex : html.length;
    }
    parts.push(' ');
  }
  // Decode after stripping: encoded markup stays literal untrusted text, never parsed again.
  return parts
    .join('')
    .replace(/&(?:#\d{1,8}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, decodeEntity)
    .replace(/\s+/g, ' ')
    .trim();
}

type Hop = { redirect: string } | { text: string; partial: boolean };

function requestHop(
  url: URL,
  hostname: string,
  answer: LookupAddress,
  options: SourceRetrievalOptions,
  signal: AbortSignal,
  check: () => void,
): Promise<Hop> {
  const requestOptions: RequestOptions & { autoSelectFamily: boolean } = {
    protocol: url.protocol,
    hostname,
    port: url.protocol === 'https:' ? 443 : 80,
    path: url.pathname + url.search,
    method: 'GET',
    headers: { Accept: 'text/html, text/plain', 'Accept-Encoding': 'identity' },
    agent: false,
    lookup: pin(answer),
    family: answer.family,
    autoSelectFamily: false,
    signal,
    maxHeaderSize: 16 * 1024,
    ...(url.protocol === 'https:'
      ? { servername: isIP(hostname) ? '' : hostname, rejectUnauthorized: true }
      : {}),
  };
  const transport =
    options.testDependencies?.request ?? (url.protocol === 'https:' ? https.request : http.request);
  return new Promise((resolve, reject) => {
    let request: ClientRequest | undefined;
    let response: IncomingMessage | undefined;
    let settled = false;
    const finish = (error: unknown, hop?: Hop) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', aborted);
      // Destroy immediately. Never await a remote peer, close event, or shutdown drain.
      response?.destroy();
      request?.destroy();
      if (hop) resolve(hop);
      else reject(error);
    };
    const aborted = () => finish(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    try {
      check();
      try {
        options.beforeRequest?.();
      } catch (error) {
        throw new AuthorityFailure(error);
      }
      check();
      request = transport(requestOptions, (incoming) => {
        response = incoming;
        if (settled) {
          incoming.destroy();
          return;
        }
        incoming.on('error', () =>
          finish(new RetrievalFailure('failed', 'Source retrieval failed.')),
        );
        incoming.on('aborted', () =>
          finish(new RetrievalFailure('failed', 'Source retrieval failed.')),
        );
        incoming.on('close', () => {
          if (!settled) finish(new RetrievalFailure('failed', 'Source retrieval failed.'));
        });
        try {
          check();
          const status = incoming.statusCode ?? 0;
          if (REDIRECTS.has(status)) {
            const location = incoming.headers.location;
            if (typeof location !== 'string' || !location) fail();
            finish(null, { redirect: location });
            return;
          }
          if (status < 200 || status >= 300) fail();
          const encoding = incoming.headers['content-encoding'];
          if (
            encoding !== undefined &&
            (typeof encoding !== 'string' || encoding.trim().toLowerCase() !== 'identity')
          )
            fail('Unsupported source encoding.');
          const transfer = incoming.headers['transfer-encoding'];
          if (
            transfer !== undefined &&
            (typeof transfer !== 'string' || transfer.trim().toLowerCase() !== 'chunked')
          )
            fail('Unsupported source encoding.');
          const type = incoming.headers['content-type'];
          if (typeof type !== 'string') fail('Unsupported source type.');
          if (/^application\/pdf(?:\s*;|$)/i.test(type)) fail('PDF sources are unsupported.');
          const match =
            /^(text\/html|text\/plain)(?:\s*;\s*charset\s*=\s*(?:"(utf-8|utf8|us-ascii)"|(utf-8|utf8|us-ascii)))?\s*$/i.exec(
              type,
            );
          if (!match) fail('Unsupported source type or charset.');
          const ascii = (match[2] ?? match[3])?.toLowerCase() === 'us-ascii';
          const length = incoming.headers['content-length'];
          if (
            length !== undefined &&
            (typeof length !== 'string' || !/^\d+$/.test(length) || Number(length) > MAX_BYTES)
          )
            fail('Source exceeds size limit.');
          // Fixed storage also bounds overhead from arbitrarily fragmented/empty data events.
          const body = Buffer.allocUnsafe(MAX_BYTES);
          let bytes = 0;
          incoming.on('data', (chunk: Buffer) => {
            if (settled) return;
            try {
              check();
              if (!Buffer.isBuffer(chunk)) fail();
              if (bytes + chunk.length > MAX_BYTES) fail('Source exceeds size limit.');
              if (ascii && chunk.some((byte) => byte > 127)) fail('Unsupported source encoding.');
              chunk.copy(body, bytes);
              bytes += chunk.length;
            } catch (error) {
              finish(error);
            }
          });
          incoming.on('end', () => {
            if (settled) return;
            try {
              check();
              if (!incoming.complete || (length !== undefined && Number(length) !== bytes)) fail();
              const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
                body.subarray(0, bytes),
              );
              if (decoded.startsWith('%PDF-')) fail('PDF sources are unsupported.');
              if (Buffer.byteLength(decoded, 'utf8') > MAX_BYTES)
                fail('Source exceeds size limit.');
              const text = match[1]!.toLowerCase() === 'text/html' ? htmlText(decoded) : decoded;
              if (!text.trim()) fail('Source contains no text.');
              check();
              finish(null, { text, partial: status === 206 });
            } catch (error) {
              finish(error);
            }
          });
        } catch (error) {
          finish(error);
        }
      });
      request.on('error', (error) => finish(error));
      if (settled) request.destroy();
      else request.end();
    } catch (error) {
      finish(error);
    }
  });
}

/** Retrieved text is untrusted source data, not instructions or verified claim support. */
export async function retrievePublicSource(
  originalUrl: string,
  options: SourceRetrievalOptions,
): Promise<SourceRetrievalResult> {
  if (options.signal.aborted) throw abortError();
  let canonicalUrl = originalUrl;
  const controller = new AbortController();
  const cancelled = () => controller.abort(abortError());
  options.signal.addEventListener('abort', cancelled, { once: true });
  const deadline = performance.now() + TIMEOUT_MS;
  const timeout = () =>
    controller.abort(new RetrievalFailure('failed', 'Source retrieval timed out.'));
  const timer = setTimeout(timeout, TIMEOUT_MS);
  timer.unref();
  const check = () => {
    if (options.signal.aborted) throw abortError();
    if (performance.now() >= deadline) timeout();
    if (controller.signal.aborted) throw controller.signal.reason;
  };
  try {
    let current = target(originalUrl);
    for (let redirects = 0; ; redirects++) {
      check();
      const { url, hostname } = current;
      const answers = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await cancellable(
            (options.testDependencies?.resolve ?? resolveAll)(hostname, controller.signal),
            controller.signal,
          );
      check();
      if (!Array.isArray(answers) || !answers.length || answers.length > 64) block();
      const snapshot = answers.map((answer) => ({
        address: answer?.address,
        family: answer?.family,
      }));
      if (
        snapshot.some(
          (answer) =>
            !answer || isIP(answer.address) !== answer.family || !publicAddress(answer.address),
        )
      )
        block();
      // Copy primitives: a resolver-owned record cannot mutate the pin between validation and dispatch.
      const answer = snapshot[0]!;
      canonicalUrl = url.href;
      const hop = await requestHop(url, hostname, answer, options, controller.signal, check);
      check();
      if ('redirect' in hop) {
        if (redirects >= 2) block('Too many source redirects.');
        current = target(hop.redirect, url);
        continue;
      }
      const truncated = hop.text.length > MAX_TEXT;
      let text = hop.text.slice(0, MAX_TEXT);
      if (truncated && /[\ud800-\udbff]$/.test(text)) text = text.slice(0, -1);
      return {
        originalUrl,
        canonicalUrl,
        text,
        retrievalStatus: truncated || hop.partial ? 'partial' : 'retrieved',
        reason: truncated
          ? 'Source excerpt truncated.'
          : hop.partial
            ? 'Source is incomplete.'
            : null,
      };
    }
  } catch (error) {
    if (options.signal.aborted) throw abortError();
    if (error instanceof AuthorityFailure) throw error.original;
    const failure =
      error instanceof RetrievalFailure
        ? error
        : new RetrievalFailure('failed', 'Source retrieval failed.');
    return {
      originalUrl,
      canonicalUrl,
      text: null,
      retrievalStatus: failure.status,
      reason: failure.message,
    };
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', cancelled);
  }
}
