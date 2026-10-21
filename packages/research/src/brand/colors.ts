/**
 * Brand colour signals. Every colour returned came from the company's own
 * markup or logo; nothing is guessed. Callers record which signal won.
 */
import { hexToRgb, parseColor, quantizePixels, svgPalette, toHex, type PaletteEntry } from './color';
import { tagAttr } from './logo-candidates';

export type ColorSignal = 'theme-color' | 'css-vars' | 'inline-svg' | 'logo-svg' | 'logo-raster';

export interface SignalPalette { signal: ColorSignal; palette: PaletteEntry[] }

/** a) <meta name="theme-color"> / msapplication-TileColor. */
export function metaThemeColors(html: string): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (tagAttr(m[0], 'name') ?? '').toLowerCase();
    if (key !== 'theme-color' && key !== 'msapplication-tilecolor') continue;
    const c = parseColor(tagAttr(m[0], 'content'));
    if (c) out.push({ hex: toHex(c), weight: 1 });
  }
  return out;
}

const VAR_PRIORITY: Array<[RegExp, number]> = [
  [/^--(?:color-)?(?:brand|primary)(?:-?(?:color|1|500|base))?$/, 0],
  [/(?:brand|primary)/, 1],
  [/accent/, 2],
  [/secondary/, 3],
  [/^--color-(?:base-)?(?:button|accent)/, 2],
  [/theme/, 4],
];
const VAR_NAME = /^--[\w-]*(?:primary|brand|accent|secondary|theme|color-button|color-base-accent)[\w-]*$/i;
const VAR_EXCLUDE = /text|background|bg|border|font|shadow|hover|foreground|on-|contrast|opacity|overlay|link/i;

/** b) CSS custom properties from inline <style> blocks (first-party CSS files
 * are not fetched — that would cost extra reads). */
export function cssVarColors(html: string): PaletteEntry[] {
  const hits: Array<{ hex: string; prio: number }> = [];
  for (const block of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const m of block[1]!.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
      const name = m[1]!.toLowerCase();
      if (!VAR_NAME.test(name) || VAR_EXCLUDE.test(name)) continue;
      const c = parseColor(m[2]);
      if (!c) continue;
      const prio = VAR_PRIORITY.find(([re]) => re.test(name))?.[1] ?? 5;
      hits.push({ hex: toHex(c), prio });
    }
  }
  return hits.sort((a, b) => a.prio - b.prio).map((h) => ({ hex: h.hex, weight: 1 }));
}

/** All colour signals available from HTML alone, in trust order. */
export function htmlSignals(html: string, inlineSvgs: string[]): SignalPalette[] {
  const signals: SignalPalette[] = [];
  const meta = metaThemeColors(html);
  if (meta.length) signals.push({ signal: 'theme-color', palette: meta });
  const vars = cssVarColors(html);
  if (vars.length) signals.push({ signal: 'css-vars', palette: vars });
  const svg = inlineSvgs.flatMap((s) => svgPalette(s));
  if (svg.length) signals.push({ signal: 'inline-svg', palette: svg });
  return signals;
}

export function svgLogoPalette(svgText: string): SignalPalette | null {
  if (!/<svg\b/i.test(svgText)) return null;
  const palette = svgPalette(svgText);
  return palette.length ? { signal: 'logo-svg', palette } : null;
}

type FetchLike = typeof fetch;

/** c) Raster logo → palette via canvas. Works only where createImageBitmap +
 * a canvas exist AND the image host permits CORS; every failure is an honest
 * null (the caller then keeps whatever other signals produced). */
export async function rasterLogoPalette(url: string, fetchImpl: FetchLike | undefined): Promise<SignalPalette | null> {
  const g = globalThis as unknown as {
    createImageBitmap?: (b: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
    OffscreenCanvas?: new (w: number, h: number) => {
      getContext(t: '2d'): { drawImage(i: unknown, x: number, y: number, w: number, h: number): void;
        getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> } } | null;
    };
  };
  if (!g.createImageBitmap || !g.OffscreenCanvas) return null;
  try {
    const f = fetchImpl ?? fetch;
    const res = await f(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/') || blob.type.includes('svg')) return null;
    const bmp = await g.createImageBitmap(blob);
    const size = 64;
    const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const ctx = new g.OffscreenCanvas(w, h).getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const palette = quantizePixels(ctx.getImageData(0, 0, w, h).data);
    return palette.length ? { signal: 'logo-raster', palette: palette.slice(0, 12) } : null;
  } catch {
    return null;
  }
}

export { hexToRgb };
