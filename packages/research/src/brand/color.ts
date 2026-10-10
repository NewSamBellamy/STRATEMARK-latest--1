/** Pure colour helpers for brand extraction — no DOM, no network. */

export interface Rgb { r: number; g: number; b: number }

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb()/rgba(), and bare "r, g, b" triples
 * (Shopify theme settings). Returns null for anything else (named colours,
 * var(), url(), currentColor, none, transparent). */
export function parseColor(raw: string | null | undefined): Rgb | null {
  if (!raw) return null;
  const v = raw.trim().replace(/!important$/i, '').trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) {
    const [a, b, c] = m[1]!.split('');
    return hexToRgb(`#${a}${a}${b}${b}${c}${c}`);
  }
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(v);
  if (m) return hexToRgb(`#${m[1]}`);
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+[\d.]+%?)?\s*\)$/.exec(v);
  if (!m) m = /^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/.exec(v);
  if (m) {
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return r <= 255 && g <= 255 && b <= 255 ? { r, g, b } : null;
  }
  return null;
}

export function hsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

/** Near-white, near-black, or grey: carries no brand hue. */
export function isNeutral(c: Rgb): boolean {
  const { s, l } = hsl(c);
  return l > 0.92 || l < 0.08 || s < 0.14;
}

/** True when two colours are visually distinct enough to be separate roles. */
export function distinct(a: Rgb, b: Rgb): boolean {
  const d = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  return d > 60;
}

export interface PaletteEntry { hex: string; weight: number }

/** Count-weighted palette from RGBA pixel data (4 bits/channel buckets).
 * Transparent pixels are ignored. Returned sorted by weight, descending. */
export function quantizePixels(data: ArrayLike<number>): PaletteEntry[] {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3]! < 128) continue;
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key);
    if (e) { e.r += r; e.g += g; e.b += b; e.n += 1; } else buckets.set(key, { r, g, b, n: 1 });
  }
  return [...buckets.values()]
    .map((e) => ({ hex: toHex({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }), weight: e.n }))
    .sort((a, b) => b.weight - a.weight);
}

/** Fill/stroke colours of an SVG source, weighted by occurrence. */
export function svgPalette(svg: string): PaletteEntry[] {
  const counts = new Map<string, number>();
  const add = (raw: string) => {
    const c = parseColor(raw);
    if (!c) return;
    const hex = toHex(c);
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  };
  for (const m of svg.matchAll(/\b(?:fill|stroke|stop-color)\s*=\s*"([^"]*)"/gi)) add(m[1]!);
  for (const m of svg.matchAll(/\b(?:fill|stroke|stop-color)\s*:\s*([^;"}]+)/gi)) add(m[1]!);
  return [...counts.entries()].map(([hex, weight]) => ({ hex, weight })).sort((a, b) => b.weight - a.weight);
}

export interface PickedColors { primary: string; secondary: string; accent: string }

/** Choose primary/secondary/accent from ordered palette lists (earlier = more
 * trusted). Non-neutral colours win; a purely neutral palette yields a
 * monochrome primary. Returns null when there is nothing at all. */
export function pickRoles(lists: PaletteEntry[][]): { colors: PickedColors; monochrome: boolean } | null {
  const all = lists.flat().map((e) => ({ rgb: hexToRgb(e.hex)!, hex: e.hex })).filter((e) => e.rgb);
  const chromatic: typeof all = [];
  for (const e of all) {
    if (isNeutral(e.rgb) || chromatic.some((c) => !distinct(c.rgb, e.rgb))) continue;
    chromatic.push(e);
  }
  if (chromatic.length) {
    const primary = chromatic[0]!;
    const secondary = chromatic[1] ?? primary;
    const accent = chromatic[2] ?? chromatic[1] ?? primary;
    return { colors: { primary: primary.hex, secondary: secondary.hex, accent: accent.hex }, monochrome: false };
  }
  // Monochrome logo: primary is the dominant non-white neutral.
  const dark = all.find((e) => hsl(e.rgb).l < 0.92);
  if (!dark) return null;
  return { colors: { primary: dark.hex, secondary: dark.hex, accent: dark.hex }, monochrome: true };
}
