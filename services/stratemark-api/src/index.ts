/**
 * stratemark-api — the hosted half of the web app (Cloudflare Worker).
 *
 *   POST /v1/gemini/:model:generateContent  Gemini on the server-held key, behind a daily dollar budget
 *   POST /v1/source        { url, scope }    original-source read (same reader + policy as desktop)
 *   POST /v1/asset-source  { url }           raw HTML for logo/headshot parsing
 *   GET  /v1/image?url=                      a public image with CORS, for brand-colour sampling
 *   GET  /health
 *
 * The Gemini key lives only in the GEMINI_API_KEY secret; it is never echoed,
 * logged or returned.
 *
 * Privacy (a beta promise, see the web app's "About this beta" page): request
 * and response bodies pass through and are never stored or logged. Invocation
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

export { BudgetCounter } from './budget';

export interface Env {
  GEMINI_API_KEY?: string;
  BUDGET: DurableObjectNamespace<BudgetCounter>;
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
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function cors(origin: string | null): Record<string, string> {
  return origin ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

async function readJson<T>(request: Request): Promise<T | null> {
  if ((request.headers.get('content-type') ?? '').split(';')[0] !== 'application/json') return null;
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > MAX_JSON_BODY) return null;
  const text = await request.text();
  if (text.length > MAX_JSON_BODY) return null;
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
  try {
    const upstream = await fetch(`${GEMINI}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body,
    });
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
    actual = 0; // the request never reached Google, so it was not billed
    throw cause;
  } finally {
    await counter.settle(day, ip, held, actual);
  }
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

    const origin = request.headers.get('origin');
    if (!allowedOrigin(origin, env.ALLOWED_ORIGINS ?? '', env.ALLOW_LOCALHOST === 'true')) {
      return json({ error: 'Origin not allowed.' }, 403, null);
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const allowed = origin!;

    try {
      const gemini = url.pathname.match(/^\/v1\/gemini\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,119}):generateContent$/);
      if (gemini && request.method === 'POST') return await geminiProxy(request, env, gemini[1]!, allowed);
      if (url.pathname === '/v1/source' && request.method === 'POST') return await sourceRead(request, allowed);
      if (url.pathname === '/v1/asset-source' && request.method === 'POST') return await assetRead(request, allowed);
      if (url.pathname === '/v1/image' && request.method === 'GET') return await imageRead(request, allowed);
      return json({ error: 'Not found.' }, 404, origin);
    } catch {
      return json({ error: 'The request failed.' }, 500, origin);
    }
  },
};
