/**
 * Which capture provider last produced a real screenshot of a site, remembered
 * in localStorage so a repeat visit goes straight to the provider that worked
 * instead of re-walking the mShots retry loop (up to ~30 s of "Capturing…")
 * before reaching the second one. Small (one short entry per site, capped) and
 * expiring: capture services change their minds.
 */
export type ShotProvider = 'primary' | 'alt';

const KEY = 'mi.siteShot.v1';
const MAX_ENTRIES = 80;
export const SHOT_MEMORY_TTL_MS = 7 * 86_400_000;

type Memory = Record<string, { p: ShotProvider; t: number }>;

const siteKey = (url: string): string | null => {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
};

function load(): Memory {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Memory : {};
  } catch { return {}; }
}

export function recalledShotProvider(url: string, now = Date.now()): ShotProvider | null {
  const k = siteKey(url);
  const hit = k ? load()[k] : undefined;
  if (!hit || now - hit.t > SHOT_MEMORY_TTL_MS) return null;
  return hit.p === 'alt' || hit.p === 'primary' ? hit.p : null;
}

export function rememberShotProvider(url: string, provider: ShotProvider, now = Date.now()): void {
  const k = siteKey(url);
  if (!k) return;
  try {
    const mem = load();
    mem[k] = { p: provider, t: now };
    const keys = Object.keys(mem);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => mem[a]!.t - mem[b]!.t).slice(0, keys.length - MAX_ENTRIES).forEach((old) => delete mem[old]);
    }
    globalThis.localStorage?.setItem(KEY, JSON.stringify(mem));
  } catch { /* storage full or blocked: the retry loop still works */ }
}

/** The recalled provider no longer works: forget it so the next visit starts from the top. */
export function forgetShotProvider(url: string): void {
  const k = siteKey(url);
  if (!k) return;
  try {
    const mem = load();
    delete mem[k];
    globalThis.localStorage?.setItem(KEY, JSON.stringify(mem));
  } catch { /* ignore */ }
}
