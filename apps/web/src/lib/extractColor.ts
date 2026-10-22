/**
 * Reading a logo's pixels (audit Part 1.1): the brand colours on the card's
 * frame and the logo quality gate both work from one small sample of the
 * image. Fetches with CORS and draws a downscaled canvas.
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

/** Sampled logo size: small enough to be cheap, large enough to see a mark's colours and coverage. */
export const SAMPLE_PX = 32;
const pixelCache = new Map<string, Promise<Uint8ClampedArray | null>>();

/**
 * The logo's pixels, drawn at SAMPLE_PX square (RGBA bytes), or null when the
 * image cannot be read (no CORS, not an image). Memoized per URL.
 */
export function readLogoPixels(url: string): Promise<Uint8ClampedArray | null> {
  const hit = pixelCache.get(url);
  if (hit) return hit;
  if (!hasHostedApi() && isCorsOpaqueSource(url)) return Promise.resolve(null);
  const p = sample(url).catch(() => null);
  pixelCache.set(url, p);
  return p;
}

/** The single most present brand colour in a logo (see brandPaletteFrom), or null. */
export function extractDominantColor(url: string): Promise<string | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = readLogoPixels(url).then(async (data) => {
    if (!data) return null;
    const { brandPaletteFrom } = await import('@/features/card/logoQuality');
    return brandPaletteFrom(data, 1)[0] ?? null;
  });
  cache.set(url, p);
  return p;
}

async function drawable(blob: Blob): Promise<CanvasImageSource> {
  try {
    return await createImageBitmap(blob);
  } catch {
    // SVG blobs are not accepted by createImageBitmap in every browser: draw them through an image element instead.
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('not an image'));
        img.src = objectUrl;
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
  }
}

async function sample(url: string): Promise<Uint8ClampedArray | null> {
  const res = await fetch(sampleUrl(url), { mode: 'cors', credentials: 'omit' });
  if (!res.ok) return null;
  const source = await drawable(await res.blob());
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_PX;
  canvas.height = SAMPLE_PX;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, SAMPLE_PX, SAMPLE_PX);
  return ctx.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX).data;
}
