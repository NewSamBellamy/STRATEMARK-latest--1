/**
 * Hosted share links: the pure rules, with no Worker globals so they are unit
 * tested in Node.
 *
 * A share is a read-only snapshot of a card or a deck, made by the browser
 * (compressed, so the Worker never parses research), stored under an
 * unguessable id for a bounded time, and opened through a viewer page that
 * fetches it by id. The Worker serves the link-preview tags a chat app reads
 * (title, line of description, picture) and nothing else about the research.
 *
 * Nothing here trusts the caller: sizes are bounded, text is stripped of control
 * characters and escaped for the one HTML page the Worker writes, and the viewer
 * address must sit on the same allowed origin that made the request, so a share
 * cannot be used to bounce a visitor to an address of the sender's choosing.
 */

/** How long a share lives, in days, unless the Worker is configured otherwise. */
export const SHARE_TTL_DAYS_DEFAULT = 90;
/**
 * Largest compressed snapshot, as base64url characters (about 1.5 MB of bytes). An 18-company deck measures about 180 KB, so
 * this is more than ten times a real deck; it also keeps the Worker's work per request small (a free Workers plan allows 10 ms of CPU).
 */
export const SHARE_MAX_DATA_CHARS = 2_000_000;
/** Largest preview picture, as base64 characters (about 375 KB of PNG; the real one measures about 240 KB). */
export const SHARE_MAX_OG_CHARS = 500_000;
/** Storage is written in pieces this size; one Durable Object value holds at most 128 KiB. */
export const SHARE_CHUNK_CHARS = 100_000;
/** Request body ceiling: the two payloads plus a little JSON around them. */
export const SHARE_MAX_BODY_CHARS = SHARE_MAX_DATA_CHARS + SHARE_MAX_OG_CHARS + 4_096;
export const SHARE_ID_LENGTH = 16;

export interface ShareCreate {
  kind: 'card' | 'deck';
  title: string;
  description: string;
  /** The viewer page (share.html) that opens this share, on the allowed origin that made the request. */
  viewer: string;
  /** The compressed snapshot, base64url. */
  data: string;
  /** The preview picture, base64 of a PNG, or null when the browser could not draw one. */
  og: string | null;
}

export type ShareParse = { ok: true; value: ShareCreate } | { ok: false; error: string; status: 400 | 413 };

/** Control characters and the two Unicode line separators, built from code points so no source line carries them. */
const CONTROL = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}-${String.fromCharCode(159)}${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]+`, 'g');

/**
 * Characters that draw nothing or reorder what is around them: every Unicode default-ignorable code point (the soft hyphen,
 * the combining grapheme joiner, the Arabic letter mark, the Hangul and Khmer fillers, the Mongolian vowel separator,
 * zero-width, word-joiner and direction marks, overrides and isolates, variation selectors, the byte-order mark, and the tag
 * characters U+E0000 to U+E007F that spell ASCII nobody can see), every other format character, and the braille blank. A
 * title that carries them can read as something it is not (a right-to-left override flips a name), and a chat app's link
 * unfurler, often a language model, reads hidden text the reader never sees in og:title and og:description (red team R2-S1).
 * They are removed, not replaced by a space. The zero-width joiner and variation selector 16 go with them, so an emoji
 * sequence falls back to its parts (it already did for the joiner); the emoji themselves stay.
 */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}\u2800]+/gu;

/** Printable text only: no control or invisible characters, one line, bounded. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const flat = value.replace(INVISIBLE, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** Largest preview picture, in pixels on a side: the drawn picture is 1200 x 630, so this leaves room and nothing silly. */
const OG_MAX_SIDE = 2400;

/**
 * A PNG's size from the start of its base64: the 8-byte signature, then the IHDR chunk (length 13, name, width, height).
 * Null when those 24 bytes are not a PNG header, so arbitrary bytes cannot be served as an image.
 */
export function pngDimensions(base64: string): { width: number; height: number } | null {
  if (base64.length < 32) return null;
  let bin: string;
  try { bin = atob(base64.slice(0, 32)); } catch { return null; }
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, i) => bytes[i] === byte)) return null;
  if (!(bytes[8] === 0 && bytes[9] === 0 && bytes[10] === 0 && bytes[11] === 13)) return null;
  if (String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) !== 'IHDR') return null;
  const be = (at: number) => (((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0);
  return { width: be(16), height: be(20) };
}

/** The viewer is a static page named share.html, with no query or hash, on the origin that asked. */
export function viewerUrlFor(raw: unknown, requestOrigin: string): string | null {
  if (typeof raw !== 'string' || raw.length > 300) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.origin !== requestOrigin || url.username || url.password || url.search || url.hash) return null;
  if (!/^\/(?:[A-Za-z0-9._-]+\/)*share\.html$/.test(url.pathname)) return null;
  return url.href;
}

export function parseShareCreate(body: unknown, requestOrigin: string): ShareParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Bad share request.', status: 400 };
  const b = body as Record<string, unknown>;
  if (b.v !== 1 || (b.kind !== 'card' && b.kind !== 'deck')) return { ok: false, error: 'Bad share request.', status: 400 };
  const title = cleanText(b.title, 140);
  if (!title) return { ok: false, error: 'A share needs a title.', status: 400 };
  const viewer = viewerUrlFor(b.viewer, requestOrigin);
  if (!viewer) return { ok: false, error: 'The viewer address is not allowed.', status: 400 };
  const data = b.data;
  if (typeof data !== 'string' || data.length < 64) return { ok: false, error: 'The share has no research in it.', status: 400 };
  if (data.length > SHARE_MAX_DATA_CHARS) return { ok: false, error: 'This share is too large to host. Share a single card, or use a private link.', status: 413 };
  if (!/^[A-Za-z0-9_-]+$/.test(data)) return { ok: false, error: 'Bad share request.', status: 400 };
  let og: string | null = null;
  if (b.og !== null && b.og !== undefined) {
    if (typeof b.og !== 'string' || b.og.length > SHARE_MAX_OG_CHARS) return { ok: false, error: 'The preview picture is too large.', status: 413 };
    // Refuse anything that is not a PNG with a real header and a sane size.
    const size = /^[A-Za-z0-9+/]+={0,2}$/.test(b.og) ? pngDimensions(b.og) : null;
    if (!size || size.width < 1 || size.height < 1 || size.width > OG_MAX_SIDE || size.height > OG_MAX_SIDE) {
      return { ok: false, error: 'The preview picture must be a PNG.', status: 400 };
    }
    og = b.og;
  }
  return { ok: true, value: { kind: b.kind, title, description: cleanText(b.description, 300), viewer, data, og } };
}

/** An unguessable URL-safe name: `bytes` random bytes as base64url. */
export function randomToken(bytes: number, random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let bin = '';
  for (const byte of random(bytes)) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 12 random bytes: 96 bits, 16 characters. */
export function newShareId(random?: (n: number) => Uint8Array): string {
  return randomToken(12, random);
}

export function isShareId(value: string): boolean {
  return /^[A-Za-z0-9_-]{16}$/.test(value);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Equal-length comparison that does not stop at the first difference. */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Split text into storage pieces. */
export function chunkText(text: string, size = SHARE_CHUNK_CHARS): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface SharePageInput {
  title: string;
  description: string;
  /** Absolute https address of this page (the link people paste). */
  pageUrl: string;
  /** Absolute address of the preview picture, or null when there is none. */
  imageUrl: string | null;
  /** Where the viewer opens this share. */
  viewerUrl: string;
}

/**
 * The only HTML the Worker writes: the tags a chat app reads to build the
 * preview, and a hand-off to the viewer. No script: a visitor is sent on by a
 * refresh tag (and a visible link), a crawler reads the tags and stops.
 */
export function sharePageHtml(input: SharePageInput): string {
  const t = escapeHtml(input.title);
  const d = escapeHtml(input.description);
  const page = escapeHtml(input.pageUrl);
  const viewer = escapeHtml(input.viewerUrl);
  const image = input.imageUrl ? escapeHtml(input.imageUrl) : null;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${t}</title>
<meta name="description" content="${d}" />
<meta name="robots" content="noindex, nofollow" />
<meta name="referrer" content="no-referrer" />
<link rel="canonical" href="${page}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Stratemark" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:url" content="${page}" />
${image
    ? `<meta property="og:image" content="${image}" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${image}" />`
    : '<meta name="twitter:card" content="summary" />'}
<meta name="twitter:title" content="${t}" />
<meta name="twitter:description" content="${d}" />
<meta http-equiv="refresh" content="0;url=${viewer}" />
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#171a19;background:#f7f8f6;display:grid;place-items:center;min-height:100vh}main{max-width:32rem;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:.25rem 0;color:#4e5b55}a{color:#0f766e}</style>
</head>
<body>
<main>
<h1>${t}</h1>
<p>${d}</p>
<p><a href="${viewer}">Open the shared research</a></p>
</main>
</body>
</html>
`;
}

/** The page a visitor sees when a link has expired or its owner stopped sharing it. */
export function goneHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>This link is no longer available</title>
<meta name="robots" content="noindex, nofollow" />
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#171a19;background:#f7f8f6;display:grid;place-items:center;min-height:100vh}main{max-width:32rem;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:.25rem 0;color:#4e5b55}</style>
</head>
<body>
<main>
<h1>This link is no longer available</h1>
<p>Shared research on Stratemark expires after a while, and its owner can stop sharing it at any time. Ask whoever sent it for a fresh link.</p>
</main>
</body>
</html>
`;
}

// ---- Daily creation limits ---------------------------------------------------

export interface QuotaDay {
  day: string;
  global: { n: number; bytes: number };
  visitors: Record<string, { n: number; bytes: number }>;
}

export interface QuotaLimits {
  /** Shares one visitor may make per UTC day. */
  visitorCount: number;
  /** Bytes (as sent) one visitor may store per UTC day. */
  visitorBytes: number;
  /** Shares all visitors together may make per UTC day. */
  globalCount: number;
  globalBytes: number;
  /** Distinct visitors tracked per day; past this the day is treated as full. */
  maxVisitors: number;
}

export const SHARE_LIMITS_DEFAULT: QuotaLimits = {
  visitorCount: 20,
  visitorBytes: 40_000_000,
  globalCount: 3_000,
  globalBytes: 3_000_000_000,
  maxVisitors: 20_000,
};

export type QuotaResult = { ok: true; ledger: QuotaDay } | { ok: false; reason: 'visitor' | 'global'; ledger: QuotaDay };

/** Pure ledger step: may this visitor store `bytes` more today? */
export function takeShareQuota(ledger: QuotaDay | undefined, day: string, visitor: string, bytes: number, limits: QuotaLimits = SHARE_LIMITS_DEFAULT): QuotaResult {
  const current: QuotaDay = ledger && ledger.day === day ? ledger : { day, global: { n: 0, bytes: 0 }, visitors: {} };
  const mine = current.visitors[visitor] ?? { n: 0, bytes: 0 };
  const known = visitor in current.visitors;
  if (current.global.n + 1 > limits.globalCount || current.global.bytes + bytes > limits.globalBytes
    || (!known && Object.keys(current.visitors).length >= limits.maxVisitors)) {
    return { ok: false, reason: 'global', ledger: current };
  }
  if (mine.n + 1 > limits.visitorCount || mine.bytes + bytes > limits.visitorBytes) return { ok: false, reason: 'visitor', ledger: current };
  return {
    ok: true,
    ledger: {
      day,
      global: { n: current.global.n + 1, bytes: current.global.bytes + bytes },
      visitors: { ...current.visitors, [visitor]: { n: mine.n + 1, bytes: mine.bytes + bytes } },
    },
  };
}
