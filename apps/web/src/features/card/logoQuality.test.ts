import { describe, expect, it, vi } from 'vitest';
import {
  HERO_DISPLAY_PX, brandPaletteFrom, forgetLogoVerdicts, logoVerdict, pixelStatsFrom, rememberLogo, rememberedLogo,
  type LogoPixelStats,
} from './logoQuality';

/** RGBA bytes for `n` pixels of one colour. */
const fill = (n: number, [r, g, b, a = 255]: number[]) => Array.from({ length: n }, () => [r!, g!, b!, a]).flat();
const image = (...parts: number[][]) => Uint8ClampedArray.from(parts.flat());

const goodPixels: LogoPixelStats = { opaqueShare: 0.9, inkShare: 0.4, chromaticShare: 0.8, inkLightness: 0.45, uniqueColors: 14 };
const verdict = (over: Partial<Parameters<typeof logoVerdict>[0]>) =>
  logoVerdict({ width: 256, height: 256, vector: false, displayPx: HERO_DISPLAY_PX, pixels: goodPixels, ...over });

describe('the logo quality gate', () => {
  it('passes a sharp, well-shaped, coloured mark', () => {
    expect(verdict({})).toEqual({ ok: true, reason: 'ok' });
    expect(verdict({ pixels: null })).toEqual({ ok: true, reason: 'ok' });
  });

  it('fails an image that did not load', () => {
    expect(verdict({ failed: true }).reason).toBe('failed');
    expect(verdict({ width: 0, height: 0 }).reason).toBe('failed');
  });

  it('calls a raster too small for the art window blurry, but never a vector', () => {
    expect(verdict({ width: 32, height: 32 }).reason).toBe('blurry');
    expect(verdict({ width: 48, height: 48 }).reason).toBe('blurry');
    expect(verdict({ width: 64, height: 64 }).ok).toBe(true);
    expect(verdict({ width: 16, height: 16, vector: true }).ok).toBe(true);
  });

  it('needs more pixels from a wide wordmark, which is drawn longer', () => {
    expect(verdict({ width: 64, height: 64 }).ok).toBe(true);
    expect(verdict({ width: 96, height: 24 }).reason).toBe('blurry');
    expect(verdict({ width: 400, height: 100 }).ok).toBe(true);
  });

  it('rejects an extreme strip or banner shape', () => {
    expect(verdict({ width: 2400, height: 200 }).reason).toBe('aspect');
    expect(verdict({ width: 1600, height: 200 }).ok).toBe(true);
    expect(verdict({ width: 100, height: 400 }).reason).toBe('aspect');
    expect(verdict({ width: 2400, height: 200, vector: true }).reason).toBe('aspect');
  });

  it('rejects an image that is mostly transparent or empty', () => {
    expect(verdict({ pixels: { ...goodPixels, opaqueShare: 0.01 } }).reason).toBe('empty');
    expect(verdict({ pixels: { ...goodPixels, inkShare: 0.005 } }).reason).toBe('empty');
  });

  it('rejects a small grey placeholder glyph, but not a black logo or a large grey mark', () => {
    const glyph: LogoPixelStats = { opaqueShare: 0.3, inkShare: 0.3, chromaticShare: 0, inkLightness: 0.6, uniqueColors: 2 };
    expect(verdict({ width: 64, height: 64, pixels: glyph }).reason).toBe('generic');
    expect(verdict({ width: 64, height: 64, pixels: { ...glyph, inkLightness: 0.08 } }).ok).toBe(true);
    expect(verdict({ width: 512, height: 512, pixels: glyph }).ok).toBe(true);
    expect(verdict({ width: 64, height: 64, vector: true, pixels: glyph }).ok).toBe(true);
  });
});

describe('pixel statistics', () => {
  it('measures coverage, colour and lightness from RGBA bytes', () => {
    // 4 transparent, 2 white, 2 red, 2 mid-grey.
    const stats = pixelStatsFrom(image(fill(4, [0, 0, 0, 0]), fill(2, [255, 255, 255]), fill(2, [220, 20, 30]), fill(2, [128, 128, 128])));
    expect(stats.opaqueShare).toBeCloseTo(0.6);
    expect(stats.inkShare).toBeCloseTo(0.4);
    expect(stats.chromaticShare).toBeCloseTo(0.5);
    expect(stats.uniqueColors).toBe(2);
  });

  it('reads a blank image as empty', () => {
    const stats = pixelStatsFrom(image(fill(100, [0, 0, 0, 0])));
    expect(stats.opaqueShare).toBe(0);
    expect(logoVerdict({ width: 256, height: 256, vector: false, displayPx: HERO_DISPLAY_PX, pixels: stats }).reason).toBe('empty');
  });
});

describe('brand colours from a logo', () => {
  it('finds a red-and-blue logo\'s two colours, most present first, ignoring white', () => {
    const palette = brandPaletteFrom(image(fill(300, [255, 255, 255]), fill(200, [0, 100, 160]), fill(120, [227, 24, 55])));
    expect(palette).toHaveLength(2);
    expect(palette[0]).toBe('#0064a0');
    expect(palette[1]).toBe('#e31837');
  });

  it('merges shades of one hue and ignores tiny fringes', () => {
    const palette = brandPaletteFrom(image(fill(200, [0, 100, 160]), fill(150, [10, 120, 190]), fill(3, [240, 200, 0])));
    expect(palette).toHaveLength(1);
  });

  it('gives nothing for a black, white or grey logo', () => {
    expect(brandPaletteFrom(image(fill(100, [0, 0, 0]), fill(100, [255, 255, 255]), fill(100, [120, 120, 120])))).toEqual([]);
  });

  it('keeps at most three colours', () => {
    const palette = brandPaletteFrom(image(fill(100, [220, 30, 30]), fill(90, [30, 160, 60]), fill(80, [30, 60, 200]), fill(70, [240, 200, 0])));
    expect(palette).toHaveLength(3);
  });
});

describe('remembered verdicts', () => {
  it('keeps a verdict per logo address, so it is not re-checked', () => {
    forgetLogoVerdicts();
    expect(rememberedLogo('https://example.org/logo.png')).toBeNull();
    rememberLogo('https://example.org/logo.png', { verdict: { ok: false, reason: 'generic' }, palette: [], read: true });
    expect(rememberedLogo('https://example.org/logo.png')?.verdict.reason).toBe('generic');
    forgetLogoVerdicts();
  });

  it('ignores malformed stored entries instead of handing them to the card', async () => {
    window.localStorage.setItem('stratemark.logoGate.v1', JSON.stringify({
      'https://a.test/bad1.png': null,
      'https://a.test/bad2.png': { palette: [] },
      'https://a.test/bad3.png': { verdict: { ok: true, reason: 'ok' }, palette: 'red', read: true },
      'https://a.test/good.png': { verdict: { ok: true, reason: 'ok' }, palette: ['#ff0000'], read: true },
    }));
    vi.resetModules();
    const fresh = await import('./logoQuality');
    expect(fresh.rememberedLogo('https://a.test/bad1.png')).toBeNull();
    expect(fresh.rememberedLogo('https://a.test/bad2.png')).toBeNull();
    expect(fresh.rememberedLogo('https://a.test/bad3.png')).toBeNull();
    expect(fresh.rememberedLogo('https://a.test/good.png')?.palette).toEqual(['#ff0000']);
    fresh.forgetLogoVerdicts();
  });
});
