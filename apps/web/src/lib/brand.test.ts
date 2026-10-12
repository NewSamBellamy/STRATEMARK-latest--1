import { describe, expect, it } from 'vitest';
import type { BrandTheme } from '@mi/contracts';
import { brandHueSource, deriveTriad } from './brand';

const theme = (o: Partial<BrandTheme>): BrandTheme => ({
  primary: '#000000', secondary: '#FFFFFF', accent: '#10A37F', text: '#14181F', background: '#FFFFFF',
  fontFamily: null, source: 'scraped', ...o,
});

describe('card brand colour', () => {
  it('uses the accent when the declared primary is black (OpenAI-style theme)', () => {
    expect(brandHueSource(theme({}), null)).toBe('#10A37F');
    expect(deriveTriad(theme({}), null).primary.toLowerCase()).not.toBe('#808080');
  });

  it('uses the accent when the declared primary is off-white (Anthropic-style theme)', () => {
    const t = theme({ primary: '#faf9f5', secondary: '#141413', accent: '#d97757' });
    expect(brandHueSource(t, null)).toBe('#d97757');
  });

  it('keeps a chromatic primary and lets a logo-extracted colour win', () => {
    expect(brandHueSource(theme({ primary: '#FA520F' }), null)).toBe('#FA520F');
    expect(brandHueSource(theme({ primary: '#FA520F' }), '#2741E7')).toBe('#2741E7');
  });

  it('stays neutral only when the whole palette is neutral', () => {
    const grey = theme({ primary: '#000000', secondary: '#FFFFFF', accent: '#808080' });
    expect(brandHueSource(grey, null)).toBe('#000000');
  });
});
