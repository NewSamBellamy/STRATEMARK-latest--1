/**
 * Dominant brand-color extraction from a logo image (audit Part 1.1).
 * Fetches with CORS, samples a downscaled canvas, and picks the most frequent
 * saturated hue bucket — ignoring near-white/near-black/transparent pixels.
 * Fails silently (null) on CORS-opaque hosts; callers fall back to the LLM
 * palette or the default theme. Results are memoized per URL.
 */
import { hasHostedApi, hostedUrl } from '@/lib/hostedApi';

const cache = new Map<string, Promise<string | null>>();

/** Cross-origin logos go through the hosted image reader (which adds CORS); others load directly. */
function sampleUrl(url: string): string {
  try {
    const target = new URL(url, window.location.href);
    if (target.origin === window.location.origin || target.protocol === 'data:' || target.protocol === 'blob:') return url;
    return hasHostedApi() && target.protocol === 'https:' ? hostedUrl(`image?url=${encodeURIComponent(target.href)}`) : url;
  } catch { return url; }
}

/**
 * Sources that never send CORS headers (Google's favicon service, Wikimedia's
 * Special:FilePath redirect): reading them can only fail, and the failure is
 * printed to the console. Without the hosted reader we do not ask; the logo
 * still shows, it just has no sampled brand color.
 */
export function isCorsOpaqueSource(url: string): boolean {
  try {
    const u = new URL(url, 'https://x.invalid');
    const host = u.hostname.toLowerCase();
    if (host === 'gstatic.com' || host.endsWith('.gstatic.com')) return true;
    if ((host === 'google.com' || host.endsWith('.google.com')) && u.pathname.startsWith('/s2/favicons')) return true;
    if (host.endsWith('wikimedia.org') && u.pathname.includes('Special:FilePath')) return true;
  } catch { /* not a url */ }
  return false;
}

export function extractDominantColor(url: string): Promise<string | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  if (!hasHostedApi() && isCorsOpaqueSource(url)) return Promise.resolve(null);
  const p = compute(url).catch(() => null);
  cache.set(url, p);
  return p;
}

async function compute(url: string): Promise<string | null> {
  const res = await fetch(sampleUrl(url), { mode: 'cors', credentials: 'omit' });
  if (!res.ok) return null;
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const size = 24;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const buckets = new Map<string, { count: number; r: number; g: number; b: number; sat: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const a = data[i + 3]!;
    if (a < 128) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 242 && min > 230) continue; // near-white
    if (max < 28) continue; // near-black
    const sat = max === 0 ? 0 : (max - min) / max;
    // Quantize to 32-step buckets.
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0, sat: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.sat += sat;
    buckets.set(key, bucket);
  }
  let best: { score: number; hex: string } | null = null;
  for (const b of buckets.values()) {
    const avgSat = b.sat / b.count;
    // Weight frequency by saturation so grey backgrounds don't win over the mark.
    const score = b.count * (0.35 + avgSat);
    if (!best || score > best.score) {
      const to = (v: number) => Math.round(v / b.count).toString(16).padStart(2, '0');
      best = { score, hex: `#${to(b.r)}${to(b.g)}${to(b.b)}` };
    }
  }
  return best?.hex ?? null;
}
