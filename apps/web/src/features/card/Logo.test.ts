import { describe, expect, it, vi } from 'vitest';
import { isHeroLogoUsable, probe } from './Logo';

describe('hero logo quality floor', () => {
  it('times out a stalled logo so fallback discovery can continue', async () => {
    vi.useFakeTimers();
    try {
      const pending = probe('https://example.invalid/stalled.svg');
      await vi.advanceTimersByTimeAsync(4000);
      expect(await pending).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it('passes a mark sharp enough for the art window, and sends a 32px icon to the monogram instead of blurring it', () => {
    expect(isHeroLogoUsable({ width: 180, height: 180, vector: false })).toBe(true);
    expect(isHeroLogoUsable({ width: 32, height: 32, vector: false })).toBe(false);
  });

  it('rejects tiny tab icons but always accepts vector marks', () => {
    expect(isHeroLogoUsable({ width: 16, height: 16, vector: false })).toBe(false);
    expect(isHeroLogoUsable({ width: 1, height: 1, vector: true })).toBe(true);
  });
});

describe('logo candidate ranking', () => {
  it('prefers vector, then the larger raster', async () => {
    const { isBetterLogo } = await import('./Logo');
    const raster = (n: number) => ({ src: 'a', width: n, height: n, vector: false });
    expect(isBetterLogo(raster(180), raster(16))).toBe(true);
    expect(isBetterLogo(raster(16), raster(180))).toBe(false);
    expect(isBetterLogo({ ...raster(1), vector: true }, raster(512))).toBe(true);
    expect(isBetterLogo(raster(512), { ...raster(1), vector: true })).toBe(false);
  });
});
