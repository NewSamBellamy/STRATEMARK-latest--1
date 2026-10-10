/**
 * Pure request policy for the hosted API — no Worker globals, so it is unit
 * tested in Node. Every rule here exists to keep a server-held key from
 * becoming an open, unmetered proxy.
 */

/** Gemini model ids the hosted key may call. Anything else is refused. */
export function allowedModel(model: string): boolean {
  return /^gemini-[a-z0-9.-]{1,80}$/.test(model);
}

/**
 * Browser origins allowed to call the API. `ALLOWED_ORIGINS` is a comma list;
 * an entry may be a full origin or a `*.example.com` host wildcard. Local dev
 * origins are allowed only when `ALLOW_LOCALHOST` is "true".
 *
 * Origin is a browser courtesy, not authentication — a script can forge it.
 * The daily caps below are what actually bound spend.
 */
export function allowedOrigin(origin: string | null, allowList: string, allowLocalhost: boolean): boolean {
  if (!origin) return false;
  let url: URL;
  try { url = new URL(origin); } catch { return false; }
  if (allowLocalhost && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return true;
  if (url.protocol !== 'https:') return false;
  return allowList.split(',').map((s) => s.trim()).filter(Boolean).some((entry) => {
    const wildcard = entry.replace(/^https:[/][/]/, '');
    if (wildcard.startsWith('*.')) {
      const base = wildcard.slice(2).toLowerCase();
      return url.hostname.toLowerCase().endsWith(`.${base}`);
    }
    try { return new URL(entry).origin === url.origin; } catch { return false; }
  });
}

/** A URL the page/asset readers may fetch: public https only, no credentials, no odd ports. */
export function safePublicUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || /^\[|^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  if (/(?:^|\.)(?:localhost|local|internal|test|invalid|home|lan|corp)$/.test(host)) return null;
  url.hash = '';
  return url;
}

/** True for IPv4 addresses that are not on the public internet. */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || !parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

export interface Counter {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export interface CapResult { ok: boolean; reason?: 'global' | 'visitor'; used: number }

/**
 * Daily spend caps: one for the whole deployment, one per visitor IP. KV is
 * eventually consistent, so the count is approximate (it can overshoot by a
 * handful under a burst) — fine for a beta budget guard, and it fails closed
 * when the cap is reached. Counters expire on their own after two days.
 */
export async function takeDailyCap(
  kv: Counter, ip: string, globalCap: number, visitorCap: number, now = new Date(),
): Promise<CapResult> {
  const day = now.toISOString().slice(0, 10);
  const gKey = `cap:${day}:all`;
  const vKey = `cap:${day}:ip:${ip}`;
  const [g, v] = await Promise.all([kv.get(gKey), kv.get(vKey)]);
  const used = Number(g ?? 0) || 0;
  const mine = Number(v ?? 0) || 0;
  if (used >= globalCap) return { ok: false, reason: 'global', used };
  if (mine >= visitorCap) return { ok: false, reason: 'visitor', used };
  const ttl = 60 * 60 * 48;
  await Promise.all([
    kv.put(gKey, String(used + 1), { expirationTtl: ttl }),
    kv.put(vKey, String(mine + 1), { expirationTtl: ttl }),
  ]);
  return { ok: true, used: used + 1 };
}
