/**
 * Brand triad engine (design system §2).
 *
 * Derives the three color roles a card wears — primary (frame/header),
 * secondary (stat-container tint), accent (bars/stamp) — from whatever brand
 * evidence exists, in trust order:
 *
 *   extracted-from-real-logo  >  researched brandTheme  >  deterministic default
 *
 * It also solves the two traps that silently break brand-colored chrome:
 *   1. Hostile brands (near-white, near-black, neon) get chroma-clamped so the
 *      frame is always visible on the oatmeal canvas.
 *   2. Header ink is chosen — and the band nudged if necessary — until it
 *      clears WCAG AA (4.5:1). Volt yellow gets dark ink, navy gets white.
 */
import type { BrandTheme } from '@mi/contracts';

export interface BrandTriad {
  /** Frame + header band fill (clamped for visibility/contrast). */
  primary: string;
  /** Stat-container tint base. */
  secondary: string;
  /** Metric bars, tier stamp, vivid notes. */
  accent: string;
  /** Text color guaranteed AA on `primary`. */
  headerInk: '#FFFFFF' | '#14181F';
  /** True when the header band is light (dark ink chosen). */
  lightHeader: boolean;
}

// ---- color math -------------------------------------------------------------

type RGB = { r: number; g: number; b: number };
type HSL = { h: number; s: number; l: number };

function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }: RGB): string {
  const to = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToHsl({ r, g, b }: RGB): HSL {
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

function hslToRgb({ h, s, l }: HSL): RGB {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return { r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255 };
}

function relLum({ r, g, b }: RGB): number {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

/** WCAG contrast ratio between two colors. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  if (!a || !b) return 1;
  const la = relLum(a), lb = relLum(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function adjust(hex: string, fn: (hsl: HSL) => HSL): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(hslToRgb(fn(rgbToHsl(rgb))));
}

// ---- the triad --------------------------------------------------------------

const WHITE = '#FFFFFF';
const INK = '#14181F';
const FALLBACK: BrandTriad = {
  primary: '#F15A24',
  secondary: '#B4552E',
  accent: '#D97706',
  headerInk: WHITE,
  lightHeader: false,
};

/**
 * Clamp a brand color so it can serve as visible chrome on a light canvas:
 * near-white brands darken, near-black brands lift slightly, neon tempers.
 * Hue is always preserved — identity survives, hostility doesn't.
 */
export function clampForChrome(hex: string): string {
  return adjust(hex, ({ h, s, l }) => ({
    h,
    s: Math.min(s, 0.92),
    l: l > 0.72 ? 0.5 : l < 0.14 ? 0.2 : l,
  }));
}

/** Pick AA-safe ink for a band; nudge the band's lightness if neither ink clears 4.5. */
function resolveHeader(bandHex: string): { band: string; ink: '#FFFFFF' | '#14181F' } {
  let band = bandHex;
  for (let i = 0; i < 6; i++) {
    const cWhite = contrastRatio(band, WHITE);
    const cInk = contrastRatio(band, INK);
    if (cWhite >= 4.5 || cInk >= 4.5) {
      return { band, ink: cWhite >= cInk ? WHITE : INK };
    }
    // Mid-tones where neither clears AA: push toward whichever side is closer.
    band = adjust(band, ({ h, s, l }) => ({ h, s, l: cWhite >= cInk ? l - 0.07 : l + 0.07 }));
  }
  return { band, ink: contrastRatio(band, WHITE) >= contrastRatio(band, INK) ? WHITE : INK };
}

/**
 * Derive the card's brand triad.
 * @param theme   researched BrandTheme (may be null / partially trustworthy)
 * @param extracted dominant color pulled from the real logo at runtime (most trusted)
 */
export function deriveTriad(theme: BrandTheme | null, extracted: string | null): BrandTriad {
  const base = extracted ?? theme?.primary ?? null;
  if (!base || !hexToRgb(base)) return FALLBACK;

  const { band: primary, ink: headerInk } = resolveHeader(clampForChrome(base));

  // Secondary: researched value if it's a real, distinct color; else a hue-shifted sibling.
  const themedSecondary =
    theme?.secondary && hexToRgb(theme.secondary) && theme.secondary.toLowerCase() !== base.toLowerCase()
      ? clampForChrome(theme.secondary)
      : null;
  const secondary =
    themedSecondary ??
    adjust(primary, ({ h, s, l }) => ({ h: (h + 0.94) % 1, s: Math.max(0.18, s * 0.75), l: Math.min(0.62, Math.max(0.4, l)) }));

  // Accent: researched accent, else a warmer/brighter note of the primary.
  const themedAccent = theme?.accent && hexToRgb(theme.accent) ? clampForChrome(theme.accent) : null;
  const accent =
    themedAccent && themedAccent.toLowerCase() !== primary.toLowerCase()
      ? themedAccent
      : adjust(primary, ({ h, s, l }) => ({ h: (h + 0.07) % 1, s: Math.max(0.55, s), l: Math.min(0.58, l + 0.08) }));

  return { primary, secondary, accent, headerInk, lightHeader: headerInk === INK };
}

/** Card material by size-signal band — rarity is earned (design system §3). */
export function tierMaterial(tier: number | null | undefined): 'matte' | 'metal' | 'foil' {
  if (tier == null) return 'matte';
  if (tier >= 7) return 'foil';
  if (tier >= 4) return 'metal';
  return 'matte';
}
