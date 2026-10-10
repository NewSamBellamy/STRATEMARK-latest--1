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
  it('accepts a real 32px company mark instead of discarding it for initials', () => {
    expect(isHeroLogoUsable({ width: 32, height: 32, vector: false })).toBe(true);
  });

  it('rejects tiny tab icons but always accepts vector marks', () => {
    expect(isHeroLogoUsable({ width: 16, height: 16, vector: false })).toBe(false);
    expect(isHeroLogoUsable({ width: 1, height: 1, vector: true })).toBe(true);
  });
});
