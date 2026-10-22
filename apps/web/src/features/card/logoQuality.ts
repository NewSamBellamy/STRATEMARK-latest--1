/**
 * The logo quality gate. Logo sources hand back all sorts of things for the
 * same company: a crisp vector mark, a 32px tab icon that blurs when it fills
 * the card's art window, a near-empty transparent square, a grey "play" glyph
 * a site uses as its favicon, or nothing at all. Each candidate gets a verdict
 * before it is shown; a candidate that fails is passed over for the next one
 * the logo chain knows, and if none pass the card shows a monogram tile.
 *
 * Pure: the pixel statistics are computed from raw RGBA data (see
 * `pixelStatsFrom`), so the rules are unit-tested without a browser canvas.
 */

export type LogoVerdictReason = 'ok' | 'failed' | 'blurry' | 'aspect' | 'empty' | 'generic';

export interface LogoVerdict {
  ok: boolean;
  reason: LogoVerdictReason;
}

/** What the pixels of a logo look like, sampled small. Shares are 0..1 of all sampled pixels unless said otherwise. */
export interface LogoPixelStats {
  /** Pixels that are at least half opaque. */
  opaqueShare: number;
  /** Opaque pixels that are not near-white: the mark itself (a white background does not count). */
  inkShare: number;
  /** Of the ink, the share with a real hue (not black, grey or white). */
  chromaticShare: number;
  /** Mean lightness of the ink, 0 (black) to 1 (white). */
  inkLightness: number;
  /** Distinct colours in the ink at a coarse quantisation. */
  uniqueColors: number;
}

export interface LogoVerdictInput {
  /** Natural size of the image in pixels. */
  width: number;
  height: number;
  /** SVG art: sharp at any size. */
  vector: boolean;
  /** The side, in CSS pixels, a square mark is drawn at. Wider or taller marks are drawn at the same area, so their long side is longer. */
  displayPx: number;
  /** Pixel statistics, when the image could be read (cross-origin images often cannot). */
  pixels?: LogoPixelStats | null;
  /** The image did not load. */
  failed?: boolean;
}

/** The card's art window draws a square mark at about this size (CSS pixels). */
export const HERO_DISPLAY_PX = 110;
/** Past this much upscaling, a raster mark is visibly soft. */
export const MAX_SHARP_UPSCALE = 2;
/** Wider than 10:1 or taller than 1:3 is a banner or a cropped strip, not a mark (long wordmarks run to about 8:1). */
const MAX_WIDE = 10;
const MAX_TALL = 3;
/** Below this the image is effectively blank. */
const MIN_OPAQUE = 0.03;
const MIN_INK = 0.015;
/** A placeholder glyph: a small, grey, few-colour raster. */
const GENERIC_MAX_PX = 128;
const GENERIC_MAX_COLORS = 6;
const GENERIC_MAX_CHROMA = 0.05;

export function logoVerdict(input: LogoVerdictInput): LogoVerdict {
  const { width, height, vector, displayPx, pixels, failed } = input;
  if (failed || !(width > 0) || !(height > 0)) return { ok: false, reason: 'failed' };
  const ratio = width / height;
  if (ratio > MAX_WIDE || ratio < 1 / MAX_TALL) return { ok: false, reason: 'aspect' };
  const long = Math.max(width, height);
  // Marks are fitted to equal AREA (Logo.tsx), so a 4:1 wordmark's long side is drawn twice as long as a square mark's.
  const drawnLong = displayPx * Math.min(2.4, Math.sqrt(Math.max(ratio, 1 / ratio)));
  if (!vector && long * MAX_SHARP_UPSCALE < drawnLong) return { ok: false, reason: 'blurry' };
  if (pixels) {
    if (pixels.opaqueShare < MIN_OPAQUE || pixels.inkShare < MIN_INK) return { ok: false, reason: 'empty' };
    const grey = pixels.chromaticShare <= GENERIC_MAX_CHROMA;
    const midGrey = pixels.inkLightness >= 0.3 && pixels.inkLightness <= 0.85;
    if (!vector && long <= GENERIC_MAX_PX && grey && midGrey && pixels.uniqueColors <= GENERIC_MAX_COLORS) {
      return { ok: false, reason: 'generic' };
    }
  }
  return { ok: true, reason: 'ok' };
}

const isNearWhite = (r: number, g: number, b: number) => Math.max(r, g, b) > 242 && Math.min(r, g, b) > 230;
const isNearBlack = (r: number, g: number, b: number) => Math.max(r, g, b) < 28;
/** Chroma below this reads as grey to the eye. */
const GREY_CHROMA = 30;

/** Pixel statistics from RGBA bytes (as `getImageData` returns them). */
export function pixelStatsFrom(data: ArrayLike<number>): LogoPixelStats {
  const total = Math.floor(data.length / 4);
  if (total === 0) return { opaqueShare: 0, inkShare: 0, chromaticShare: 0, inkLightness: 0, uniqueColors: 0 };
  let opaque = 0;
  let ink = 0;
  let chromatic = 0;
  let light = 0;
  const colors = new Set<number>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, a = data[i + 3]!;
    if (a < 128) continue;
    opaque += 1;
    if (isNearWhite(r, g, b)) continue;
    ink += 1;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min >= GREY_CHROMA) chromatic += 1;
    light += (max + min) / 510;
    colors.add(((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5));
  }
  return {
    opaqueShare: opaque / total,
    inkShare: ink / total,
    chromaticShare: ink ? chromatic / ink : 0,
    inkLightness: ink ? light / ink : 0,
    uniqueColors: colors.size,
  };
}

type Rgb = { r: number; g: number; b: number };

function hueOf({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
}

const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const toHex = ({ r, g, b }: Rgb) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * A brand's own colours from its logo: up to `max` distinct hues, most present
 * first. White, black and greys are left out (they are the paper, not the
 * brand), and a hue has to cover a real share of the mark to count, so
 * anti-aliasing fringes never become a brand colour. A monochrome logo gives
 * an empty list, and the card keeps its standard frame.
 */
export function brandPaletteFrom(data: ArrayLike<number>, max = 3): string[] {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number; sat: number }>();
  let chromaticTotal = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, a = data[i + 3]!;
    if (a < 128 || isNearWhite(r, g, b) || isNearBlack(r, g, b)) continue;
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi - lo < GREY_CHROMA) continue;
    chromaticTotal += 1;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0, sat: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.sat += (hi - lo) / hi;
    buckets.set(key, bucket);
  }
  if (chromaticTotal === 0) return [];
  // Neighbouring buckets of one hue (a gradient, a shadow) are one brand colour: merge them before ranking.
  const ranked = [...buckets.values()]
    .map((b) => ({ rgb: { r: b.r / b.count, g: b.g / b.count, b: b.b / b.count }, count: b.count, score: b.count * (0.35 + b.sat / b.count) }))
    .sort((a, b) => b.score - a.score);
  const groups: { rgb: Rgb; hue: number; count: number }[] = [];
  for (const bucket of ranked) {
    const hue = hueOf(bucket.rgb);
    const group = groups.find((g) => hueGap(g.hue, hue) < 28);
    if (group) group.count += bucket.count;
    else groups.push({ rgb: bucket.rgb, hue, count: bucket.count });
  }
  const minShare = Math.max(2, chromaticTotal * 0.08);
  return groups
    .filter((g) => g.count >= minShare)
    .sort((a, b) => b.count - a.count)
    .slice(0, max)
    .map((g) => toHex(g.rgb));
}

// ---- remembered verdicts ---------------------------------------------------------------------------------------------

/** What the gate found for one logo address, kept so a card does not re-check it on every render or visit. */
export interface RememberedLogo {
  verdict: LogoVerdict;
  /** Brand colours read from this logo; empty when it is monochrome or could not be read. */
  palette: string[];
  /** Whether the pixels were actually read (cross-origin images often cannot be). */
  read: boolean;
}

const STORE_KEY = 'stratemark.logoGate.v1';
const STORE_MAX = 400;
let memory: Map<string, RememberedLogo> | null = null;

/** Stored JSON can be hand-edited or from an older build: only well-formed entries are trusted. */
function isRemembered(v: unknown): v is RememberedLogo {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<RememberedLogo>;
  return !!e.verdict && typeof e.verdict.ok === 'boolean' && typeof e.verdict.reason === 'string'
    && Array.isArray(e.palette) && e.palette.every((c) => typeof c === 'string') && typeof e.read === 'boolean';
}

function load(): Map<string, RememberedLogo> {
  if (memory) return memory;
  memory = new Map();
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) if (isRemembered(v)) memory.set(k, v);
    }
  } catch { /* no storage: verdicts last for this visit only */ }
  return memory;
}

export function rememberedLogo(src: string): RememberedLogo | null {
  return load().get(src) ?? null;
}

export function rememberLogo(src: string, entry: RememberedLogo): void {
  // Inline images are their own address and can be large: they are cheap to re-check, so they are not stored.
  if (src.startsWith('data:')) return;
  const map = load();
  map.delete(src);
  map.set(src, entry);
  while (map.size > STORE_MAX) map.delete(map.keys().next().value!);
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(map))); } catch { /* best effort */ }
}

/** Test seam: forget every remembered verdict. */
export function forgetLogoVerdicts(): void {
  memory = new Map();
  try { window.localStorage.removeItem(STORE_KEY); } catch { /* nothing to clear */ }
}
