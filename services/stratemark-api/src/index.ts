/**
 * stratemark-api — the hosted half of the web app (Cloudflare Worker).
 *
 *   POST /v1/gemini/:model:generateContent  Gemini on the server-held key, behind a daily dollar budget
 *   POST /v1/search        { provider, query } web-search discovery (visitor's key, or hosted Serper on the budget)
 *   POST /v1/news          { query }         free news discovery (Bing News RSS, no key)
 *   POST /v1/source        { url, scope }    original-source read (same reader + policy as desktop)
 *   POST /v1/asset-source  { url }           raw HTML for logo/headshot parsing
 *   GET  /v1/image?url=                      a public image with CORS (logos, real cover images)
 *   GET  /v1/preview?url=                    the real image a page publishes for link previews
 *   POST /v1/share                           store a read-only share (made by the browser), answer its link and a stop-sharing token
 *   GET  /v1/share/:id                       a share's compressed snapshot (public by link, any origin)
 *   DELETE /v1/share/:id                     stop sharing (needs the token from creation)
 *   GET  /s/:id, /s/:id/og.png               the link people paste: preview tags, a hand-off to the viewer, the preview picture
 *   GET  /health
 *
 * The Gemini key lives only in the GEMINI_API_KEY secret; it is never echoed,
 * logged or returned.
 *
 * Privacy (a beta promise, see the web app's "About this beta" page): request
 * and response bodies pass through and are never stored or logged. The one
 * exception is a share link the user chooses to create: that stores a read-only
 * copy of the shared card or deck for a bounded time (90 days by default) until
 * its owner stops sharing it. Invocation
 * logs (which record URLs) are off; the only logs are status codes. The budget
 * ledger keeps today's per-IP spend to enforce the free limit and replaces it
 * with a count each day. These routes replace the Vite dev-only /__stratemark
 * bridges so a production build reads sources and logos the same way dev does.
 */
import { Buffer } from 'node:buffer';
import { retrieveOriginalSource, type SourceTransport } from '@mi/research/original-source-node';
import type { OriginalSourceReceipt, OriginalSourceScope } from '@mi/research';
import { allowedModel, allowedOrigin, callCostMicros, isPrivateIpv4, reserveMicros, safePublicUrl, type GeminiUsage } from './policy';
import type { BudgetCounter } from './budget';
import { previewFromHtml, type PagePreview } from './preview';
import type { ShareQuota, ShareVault } from './share-vault';
import {
  SHARE_LIMITS_DEFAULT, SHARE_MAX_BODY_CHARS, SHARE_TTL_DAYS_DEFAULT, goneHtml, newShareId, parseShareCreate, randomToken, sha256Hex, sharePageHtml,
} from './share-policy';
import { parseNewsRelayRequest, runNewsSearch } from '@mi/research/news-search';
import { isPlausibleSearchKey, parseSearchRelayRequest, runProviderSearch, WebSearchError, type SearchProvider, type SearchRelayRequest } from '@mi/research/web-search';

export { BudgetCounter } from './budget';
export { ShareVault, ShareQuota } from './share-vault';

export interface Env {
  GEMINI_API_KEY?: string;
  /** Hosted web search for visitors without their own search key. */
  SERPER_API_KEY?: string;
  BUDGET: DurableObjectNamespace<BudgetCounter>;
  /** One object per share, named by its id. */
  SHARES: DurableObjectNamespace<ShareVault>;
  /** Today's share counts per visitor and in all. */
  SHARE_QUOTA: DurableObjectNamespace<ShareQuota>;
  /** Days a share lives (default 90, at most 365). */
  SHARE_TTL_DAYS?: string;
  /** Public address of this Worker's share links, if it is served from a custom domain (https, no trailing slash). */
  SHARE_PUBLIC_BASE?: string;
  ALLOWED_ORIGINS?: string;
  ALLOW_LOCALHOST?: string;
  /** Hard ceiling on hosted Gemini spend per UTC day, all visitors together. */
  DAILY_BUDGET_USD?: string;
  /** Per-visitor (IP) share of that budget per UTC day. */
  DAILY_VISITOR_BUDGET_USD?: string;
}

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';
const UA = 'Stratemark-Research/1.0 (+https://getstratemark.com)';
const MAX_JSON_BODY = 2 * 1024 * 1024;
const MAX_PAGE_BYTES = 12 * 1024 * 1024;
/** Longest a grounded Gemini call may run; the browser's own attempts are shorter. */
const UPSTREAM_TIMEOUT_MS = 120_000;
const DNS_TIMEOUT_MS = 5_000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function cors(origin: string | null): Record<string, string> {
  return origin ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Search-Key, X-Share-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  } : {};
}

function json(body: unknown, status: number, origin: string | null, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(origin), ...extra },
  });
}

/** Public IPv4 answers only, resolved over Cloudflare DNS-over-HTTPS. */
async function resolvePublic(host: string): Promise<string[]> {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, {
    headers: { Accept: 'application/dns-json' },
    signal: AbortSignal.timeout(DNS_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const data = await res.json() as { Answer?: Array<{ type: number; data: string }> };
  return (data.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
}

async function hostIsPublic(host: string): Promise<boolean> {
  const addresses = await resolvePublic(host).catch(() => []);
  return addresses.length > 0 && !addresses.some(isPrivateIpv4);
}

/** Bounded body read: stops at `limit` bytes instead of buffering a huge download. */
async function readCapped(res: Response, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}

/** Worker transport for the shared reader: DoH lookup + fetch, redirects handled by the reader. */
const workerTransport: SourceTransport = {
  lookup: (host) => resolvePublic(host),
  read: async ({ url, signal }) => {
    const res = await fetch(url.href, { redirect: 'manual', signal, headers: { 'User-Agent': UA, Accept: '*/*' } });
    const headers: Record<string, string | undefined> = {};
    res.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
    const bytes = await readCapped(res, MAX_PAGE_BYTES);
    // Over the cap: a non-200 status makes the reader report "not readable".
    return bytes ? { status: res.status, headers, body: Buffer.from(bytes) } : { status: 413, headers, body: Buffer.alloc(0) };
  },
};

async function readJson<T>(request: Request, limit = MAX_JSON_BODY): Promise<T | null> {
  if ((request.headers.get('content-type') ?? '').split(';')[0] !== 'application/json') return null;
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > limit) return null;
  const text = await request.text();
  if (text.length > limit) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

/** The secret as typed into a terminal can carry quotes, spaces or a stray CR/LF; headers can't. */
function cleanKey(raw: string | undefined): string {
  return (raw ?? '').replace(/[^!-~]/g, '').replace(/^['"]+|['"]+$/g, '');
}

/** Shape check only — never the key itself. AI Studio keys are "AIza" + 35 URL-safe chars. */
export function keyShape(raw: string | undefined): { present: boolean; length: number; looksValid: boolean } {
  const key = cleanKey(raw);
  return { present: key.length > 0, length: key.length, looksValid: /^AIza[0-9A-Za-z_-]{35}$/.test(key) };
}

const usd = (micros: number) => Math.round(micros / 10_000) / 100;

function budgets(env: Env): { budget: number; visitor: number } {
  const budget = Number(env.DAILY_BUDGET_USD ?? 100);
  const visitor = Number(env.DAILY_VISITOR_BUDGET_USD ?? 20);
  return {
    budget: Math.round((Number.isFinite(budget) && budget > 0 ? budget : 100) * 1_000_000),
    visitor: Math.round((Number.isFinite(visitor) && visitor > 0 ? visitor : 20) * 1_000_000),
  };
}

function ledger(env: Env) {
  return env.BUDGET.get(env.BUDGET.idFromName('global'));
}

async function geminiProxy(request: Request, env: Env, model: string, origin: string): Promise<Response> {
  const key = cleanKey(env.GEMINI_API_KEY);
  if (!key) return json({ error: 'Hosted research is not configured.' }, 503, origin);
  if (!allowedModel(model)) return json({ error: 'Model not allowed.' }, 400, origin);
  const body = await request.text();
  if (body.length > MAX_JSON_BODY) return json({ error: 'Request too large.' }, 413, origin);

  // Dollar budget: hold this call's worst-case cost before it runs, settle to
  // the real cost (from Google's usage report) after. Exact under bursts.
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const grounded = /"google_?search"|"googleSearch"/.test(body);
  const held = reserveMicros(model, grounded, body.length);
  const caps = budgets(env);
  const counter = ledger(env);
  const reservation = await counter.reserve(day, ip, held, caps.budget, caps.visitor);
  if (!reservation.ok) {
    // 402, not 429: a spent budget must not look like a transient rate limit
    // (clients retry 429s). The web app shows a banner and stops asking.
    return json({
      budget: 'exhausted', reason: reservation.reason,
      error: reservation.reason === 'global'
        ? 'Free research has reached today’s budget. It resets at midnight UTC, or add your own Gemini key in Settings to keep going.'
        : 'You’ve used today’s free research. It resets at midnight UTC, or add your own Gemini key in Settings to keep going.',
    }, 402, origin);
  }

  let actual = 0;
  let answered = false;
  try {
    // Bounded, and abandoned when the browser gives up: a client that timed
    // out and retried must not leave this call running against the budget.
    const upstream = await fetch(`${GEMINI}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    });
    answered = true;
    // Pass Google's body and status through; never its headers (no key echo).
    // Buffered, not streamed: a streamed error body arrived empty at the browser.
    const text = await upstream.text();
    if (upstream.ok) {
      try {
        const parsed = JSON.parse(text) as {
          usageMetadata?: GeminiUsage;
          candidates?: Array<{ groundingMetadata?: { webSearchQueries?: unknown[] } }>;
        };
        const queries = (parsed.candidates ?? []).reduce((n, c) => n + (c.groundingMetadata?.webSearchQueries?.length ?? 0), 0);
        actual = callCostMicros(model, parsed.usageMetadata, grounded, queries);
      } catch {
        actual = held; // unreadable usage: charge the worst case rather than nothing
      }
    } else {
      // Status only: Google's error text can quote the request, and we never log research content.
      console.log(`gemini ${model} -> ${upstream.status}`);
    }
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store', ...cors(origin) },
    });
  } catch (cause) {
    // Google answered, or was cut off mid-generation (timeout, client gone):
    // it may have billed, so hold the worst case. Only a call that failed
    // before reaching Google is free.
    const aborted = cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError');
    actual = answered || aborted ? held : 0;
    throw cause;
  } finally {
    await counter.settle(day, ip, held, actual);
  }
}

/** One hosted Serper query, held against the same daily dollar budget as Gemini. */
const SEARCH_COST_MICROS = 1_000;

/**
 * POST /v1/search { provider, query } — the hunt's web-search discovery.
 * With X-Search-Key the visitor's own key is forwarded for this one request
 * (never stored, logged or charged). Without it the server's SERPER_API_KEY
 * answers, behind the daily budget.
 */
async function searchRelay(request: Request, env: Env, origin: string): Promise<Response> {
  const input = parseSearchRelayRequest(await readJson<unknown>(request));
  if (!input) return json({ error: 'Bad search request.' }, 400, origin);
  const userKey = cleanKey(request.headers.get('x-search-key') ?? undefined);
  if (userKey) {
    if (!isPlausibleSearchKey(userKey)) return json({ error: 'That search key does not look right.' }, 400, origin);
    return runSearch(input.provider, userKey, input, origin);
  }
  const hostedKey = cleanKey(env.SERPER_API_KEY);
  if (!hostedKey) return json({ error: 'Hosted search is not configured.' }, 503, origin);
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const caps = budgets(env);
  const counter = ledger(env);
  const reservation = await counter.reserve(day, ip, SEARCH_COST_MICROS, caps.budget, caps.visitor);
  if (!reservation.ok) return json({ budget: 'exhausted', reason: reservation.reason, error: 'Free search has reached today’s budget.' }, 402, origin);
  let actual = 0;
  try {
    const response = await runSearch('serper', hostedKey, input, origin);
    actual = response.ok ? SEARCH_COST_MICROS : 0;
    return response;
  } finally {
    await counter.settle(day, ip, SEARCH_COST_MICROS, actual);
  }
}

async function runSearch(provider: SearchProvider, key: string, input: SearchRelayRequest, origin: string): Promise<Response> {
  try {
    return json({ results: await runProviderSearch(provider, key, input.query, fetch, undefined, input) }, 200, origin);
  } catch (error) {
    const status = error instanceof WebSearchError ? error.status : 502;
    console.log(`search ${provider} -> ${status}`);
    return json({ error: error instanceof WebSearchError ? error.message : 'Search failed.' }, status >= 400 && status < 600 ? status : 502, origin);
  }
}

/** POST /v1/news { query } — the free news lane (no key, no budget). Any
 * upstream failure is an empty result: news only ever adds candidate articles. */
async function newsRelay(request: Request, origin: string): Promise<Response> {
  const input = parseNewsRelayRequest(await readJson<unknown>(request));
  if (!input) return json({ error: 'Bad news request.' }, 400, origin);
  return json({ results: await runNewsSearch(input.query, fetch) }, 200, origin);
}

async function sourceRead(request: Request, origin: string): Promise<Response> {
  const input = await readJson<{ url?: unknown; scope?: OriginalSourceScope }>(request);
  if (!input || typeof input.url !== 'string' || input.url.length > 2048) return json({}, 400, origin);
  const scope = input.scope;
  if (scope && (typeof scope.companyName !== 'string' || scope.companyName.length > 300 ||
    typeof scope.companyId !== 'string' || scope.companyId.length > 300 ||
    (scope.metricType !== undefined && (typeof scope.metricType !== 'string' || scope.metricType.length > 100)))) {
    return json({}, 400, origin);
  }
  const receipt = await retrieveOriginalSource(input.url, workerTransport, scope);
  return json(receipt, 200, origin);
}

async function assetRead(request: Request, origin: string): Promise<Response> {
  const input = await readJson<{ url?: unknown }>(request);
  const raw = typeof input?.url === 'string' ? input.url : '';
  const unavailable = (reason: string, httpStatus?: number): OriginalSourceReceipt => ({
    requestedUrl: raw.slice(0, 2048), status: 'unavailable', retrievedAt: new Date().toISOString(), reason,
    ...(httpStatus ? { httpStatus } : {}),
  });
  let url = safePublicUrl(raw);
  if (!url) return json(unavailable('Unsafe source URL'), 200, origin);
  for (let hop = 0; hop <= 3; hop++) {
    if (!(await hostIsPublic(url.hostname))) return json(unavailable('Non-public or unsupported source address'), 200, origin);
    const res = await fetch(url.href, {
      redirect: 'manual', signal: AbortSignal.timeout(12_000),
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    }).catch(() => null);
    if (!res) return json(unavailable('Source retrieval failed'), 200, origin);
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const next = safePublicUrl(res.headers.get('location') ? new URL(res.headers.get('location')!, url).href : '');
      if (!next || hop === 3) return json(unavailable('Redirect limit or unsafe destination'), 200, origin);
      url = next;
      continue;
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (res.status !== 200 || !['text/html', 'application/xhtml+xml'].includes(type)) {
      return json(unavailable('Source did not return a readable public page', res.status), 200, origin);
    }
    const bytes = await readCapped(res, 2_000_000);
    if (!bytes) return json(unavailable('Source exceeds the document limit'), 200, origin);
    const receipt: OriginalSourceReceipt = {
      requestedUrl: raw.slice(0, 2048), finalUrl: url.href, status: 'retrieved',
      retrievedAt: new Date().toISOString(), httpStatus: 200, text: new TextDecoder().decode(bytes), truncated: false,
    };
    return json(receipt, 200, origin);
  }
  return json(unavailable('Source retrieval failed'), 200, origin);
}

/** A public page's HTML (head is enough), following up to 3 safe redirects. */
async function fetchPublicHtml(start: URL, limit: number): Promise<{ finalUrl: string; html: string } | null> {
  let url = start;
  for (let hop = 0; hop <= 3; hop++) {
    if (!(await hostIsPublic(url.hostname))) return null;
    const res = await fetch(url.href, {
      redirect: 'manual', signal: AbortSignal.timeout(8_000),
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    }).catch(() => null);
    if (!res) return null;
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const next = safePublicUrl(res.headers.get('location') ? new URL(res.headers.get('location')!, url).href : '');
      if (!next) return null;
      url = next;
      continue;
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (res.status !== 200 || !['text/html', 'application/xhtml+xml'].includes(type)) return null;
    const bytes = await readCapped(res, limit).catch(() => null);
    const html = bytes ? new TextDecoder().decode(bytes) : null;
    return html ? { finalUrl: url.href, html } : null;
  }
  return null;
}

/**
 * GET /v1/preview?url= — the real image a page publishes for link previews.
 * Cached at the edge for a week, so each story or product page is fetched
 * once for everyone. The image itself is then shown through /v1/image, so
 * publishers never see our users' addresses.
 */
async function previewRead(request: Request, origin: string): Promise<Response> {
  const target = safePublicUrl(new URL(request.url).searchParams.get('url'));
  if (!target) return json({ image: null, title: null, site: null }, 400, origin);
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(`https://preview.cache/${encodeURIComponent(target.href)}`);
  const hit = await cache.match(cacheKey);
  let body: PagePreview;
  if (hit) {
    body = await hit.json() as PagePreview;
  } else {
    // Over-long pages fail the cap and simply get no preview image.
    const page = await fetchPublicHtml(target, 1_500_000);
    body = page ? previewFromHtml(page.html, page.finalUrl) : { image: null, title: null, site: null };
    await cache.put(cacheKey, new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${body.image ? 604_800 : 86_400}` },
    }));
  }
  return json(body, 200, origin, { 'Cache-Control': 'public, max-age=86400' });
}

async function imageRead(request: Request, origin: string): Promise<Response> {
  let url = safePublicUrl(new URL(request.url).searchParams.get('url'));
  if (!url) return new Response(null, { status: 400, headers: cors(origin) });
  for (let hop = 0; hop <= 3; hop++) {
    if (!(await hostIsPublic(url.hostname))) return new Response(null, { status: 403, headers: cors(origin) });
    const res = await fetch(url.href, {
      redirect: 'manual', signal: AbortSignal.timeout(8_000),
      headers: { 'User-Agent': UA, Accept: 'image/*' },
      cf: { cacheTtl: 86_400, cacheEverything: true },
    } as RequestInit).catch(() => null);
    if (!res) return new Response(null, { status: 502, headers: cors(origin) });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const next = safePublicUrl(res.headers.get('location') ? new URL(res.headers.get('location')!, url).href : '');
      if (!next || hop === 3) return new Response(null, { status: 502, headers: cors(origin) });
      url = next;
      continue;
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    // SVG is excluded: it can carry script, and colour sampling needs a raster anyway.
    if (res.status !== 200 || !/^image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|avif)$/.test(type)) {
      return new Response(null, { status: 415, headers: cors(origin) });
    }
    const bytes = await readCapped(res, MAX_IMAGE_BYTES);
    if (!bytes) return new Response(null, { status: 413, headers: cors(origin) });
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': type, 'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'",
        ...cors(origin),
      },
    });
  }
  return new Response(null, { status: 502, headers: cors(origin) });
}


// ---- Share links -------------------------------------------------------------

const SHARE_HEADERS: Record<string, string> = {
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function shareTtlMs(env: Env): number {
  const days = Number(env.SHARE_TTL_DAYS ?? SHARE_TTL_DAYS_DEFAULT);
  return (Number.isInteger(days) && days >= 1 && days <= 365 ? days : SHARE_TTL_DAYS_DEFAULT) * 86_400_000;
}

/** The address share links are published at: a configured custom domain, else wherever this request came in. */
function shareBase(env: Env, request: Request): string {
  const configured = (env.SHARE_PUBLIC_BASE ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+$/.test(configured) ? configured : new URL(request.url).origin;
}

function vaultFor(env: Env, id: string) {
  return env.SHARES.get(env.SHARES.idFromName(id));
}

/** POST /v1/share: store a read-only copy and answer the link and the token that stops it. */
async function shareCreate(request: Request, env: Env, origin: string): Promise<Response> {
  // A body past the ceiling is refused on its declared size, before any of it is read.
  if (Number(request.headers.get('content-length') ?? 0) > SHARE_MAX_BODY_CHARS) {
    return json({ error: 'This share is too large to host. Share a single card, or use a private link.' }, 413, origin);
  }
  const parsed = parseShareCreate(await readJson<unknown>(request, SHARE_MAX_BODY_CHARS), origin);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status, origin);
  const input = parsed.value;
  const bytes = input.data.length + (input.og?.length ?? 0);
  const day = new Date().toISOString().slice(0, 10);
  const visitor = (await sha256Hex(request.headers.get('cf-connecting-ip') ?? 'unknown')).slice(0, 24);
  const quota = env.SHARE_QUOTA.get(env.SHARE_QUOTA.idFromName('global'));
  const taken = await quota.take(day, visitor, bytes, SHARE_LIMITS_DEFAULT);
  if (!taken.ok) {
    return json({
      error: taken.reason === 'visitor'
        ? 'You have made today’s share links. Try again tomorrow, or copy a private link instead.'
        : 'Share links have reached today’s limit. Try again tomorrow, or copy a private link instead.',
    }, 429, origin);
  }
  const now = Date.now();
  const deleteToken = randomToken(18);
  const tokenHash = await sha256Hex(deleteToken);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = newShareId();
      const stored = await vaultFor(env, id).put({
        meta: {
          kind: input.kind, title: input.title, description: input.description, viewer: input.viewer,
          createdAt: now, expiresAt: now + shareTtlMs(env), chunks: 0, hasOg: false, bytes,
        },
        data: input.data, og: input.og, tokenHash,
      });
      if (!stored) continue; // an id collision, which 96 random bits make a bug rather than a risk
      const base = shareBase(env, request);
      return json({
        id, url: `${base}/s/${id}`, imageUrl: input.og ? `${base}/s/${id}/og.png` : null,
        expiresAt: now + shareTtlMs(env), deleteToken,
      }, 201, origin);
    }
    throw new Error('no free share id');
  } catch (cause) {
    await quota.give(day, visitor, bytes).catch(() => undefined);
    throw cause;
  }
}

/** GET /v1/share/:id: the compressed snapshot. Public by link, so any origin may read it. */
async function shareRead(id: string, env: Env): Promise<Response> {
  const vault = vaultFor(env, id);
  const meta = await vault.meta();
  const data = meta ? await vault.data() : null;
  if (!meta || data === null) {
    return new Response(JSON.stringify({ error: 'This share is no longer available.' }), {
      status: 404, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', ...SHARE_HEADERS },
    });
  }
  return new Response(JSON.stringify({
    v: 1, kind: meta.kind, title: meta.title, description: meta.description, createdAt: meta.createdAt, expiresAt: meta.expiresAt, data,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*', ...SHARE_HEADERS },
  });
}

/** DELETE /v1/share/:id: stop sharing. Only the token made at creation can. */
async function shareRemove(request: Request, id: string, env: Env, origin: string): Promise<Response> {
  const token = (request.headers.get('x-share-token') ?? '').trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return json({ error: 'Missing share token.' }, 403, origin);
  const result = await vaultFor(env, id).remove(await sha256Hex(token));
  if (result === 'forbidden') return json({ error: 'That token does not stop this share.' }, 403, origin);
  return json({ ok: true, removed: result === 'removed' }, result === 'missing' ? 404 : 200, origin);
}

/** GET /s/:id: the link people paste. Preview tags for a chat app, then a hand-off to the viewer. */
async function sharePage(request: Request, id: string, env: Env): Promise<Response> {
  const meta = await vaultFor(env, id).meta();
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'",
    ...SHARE_HEADERS,
  };
  if (!meta) return new Response(goneHtml(), { status: 404, headers: { ...headers, 'Cache-Control': 'no-store' } });
  const base = shareBase(env, request);
  return new Response(sharePageHtml({
    title: meta.title, description: meta.description, pageUrl: `${base}/s/${id}`,
    imageUrl: meta.hasOg ? `${base}/s/${id}/og.png` : null, viewerUrl: `${meta.viewer}?s=${id}`,
  }), { status: 200, headers: { ...headers, 'Cache-Control': 'public, max-age=300' } });
}

/** GET /s/:id/og.png: the picture a chat app shows with the link. */
async function shareOg(id: string, env: Env): Promise<Response> {
  const encoded = await vaultFor(env, id).og();
  if (!encoded) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store', ...SHARE_HEADERS } });
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600', 'Content-Security-Policy': "default-src 'none'",
      'Cross-Origin-Resource-Policy': 'cross-origin', ...SHARE_HEADERS,
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      const shape = keyShape(env.GEMINI_API_KEY);
      const status = await ledger(env).status(new Date().toISOString().slice(0, 10)).catch(() => null);
      return json({
        ok: true, hostedResearch: shape.present, keyLength: shape.length, keyLooksValid: shape.looksValid,
        budgetUsd: usd(budgets(env).budget), visitorBudgetUsd: usd(budgets(env).visitor),
        spentTodayUsd: status ? usd(status.spentMicros) : null, visitorsToday: status?.visitors ?? null,
        last7Days: status?.history ?? [],
      }, 200, null);
    }

    // Share links are opened by anyone, from chat apps and crawlers that send no Origin: they sit before the origin check.
    const reading = request.method === 'GET' || request.method === 'HEAD';
    const pasted = url.pathname.match(/^\/s\/([A-Za-z0-9_-]{16})(\/og\.png)?$/);
    const shared = url.pathname.match(/^\/v1\/share\/([A-Za-z0-9_-]{16})$/);
    try {
      if (pasted && reading) return pasted[2] ? await shareOg(pasted[1]!, env) : await sharePage(request, pasted[1]!, env);
      if (shared && reading) return await shareRead(shared[1]!, env);
    } catch {
      return new Response('The request failed.', { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }

    const origin = request.headers.get('origin');
    if (!allowedOrigin(origin, env.ALLOWED_ORIGINS ?? '', env.ALLOW_LOCALHOST === 'true')) {
      return json({ error: 'Origin not allowed.' }, 403, null);
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const allowed = origin!;

    try {
      const gemini = url.pathname.match(/^\/v1\/gemini\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,119}):generateContent$/);
      if (gemini && request.method === 'POST') return await geminiProxy(request, env, gemini[1]!, allowed);
      if (url.pathname === '/v1/search' && request.method === 'POST') return await searchRelay(request, env, allowed);
      if (url.pathname === '/v1/news' && request.method === 'POST') return await newsRelay(request, allowed);
      if (url.pathname === '/v1/source' && request.method === 'POST') return await sourceRead(request, allowed);
      if (url.pathname === '/v1/asset-source' && request.method === 'POST') return await assetRead(request, allowed);
      if (url.pathname === '/v1/image' && request.method === 'GET') return await imageRead(request, allowed);
      if (url.pathname === '/v1/preview' && request.method === 'GET') return await previewRead(request, allowed);
      if (url.pathname === '/v1/share' && request.method === 'POST') return await shareCreate(request, env, allowed);
      if (shared && request.method === 'DELETE') return await shareRemove(request, shared[1]!, env, allowed);
      return json({ error: 'Not found.' }, 404, origin);
    } catch {
      return json({ error: 'The request failed.' }, 500, origin);
    }
  },
};
