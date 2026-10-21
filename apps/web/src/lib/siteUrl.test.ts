import { describe, expect, it } from 'vitest';
import { siteUrl } from './siteUrl';

describe('siteUrl', () => {
  it('makes bare domains absolute and keeps full URLs', () => {
    expect(siteUrl('anthropic.com')).toBe('https://anthropic.com/');
    expect(siteUrl('https://www.openai.com/about')).toBe('https://www.openai.com/about');
  });
  it('returns null for empty or non-web values', () => {
    expect(siteUrl('')).toBeNull();
    expect(siteUrl(null)).toBeNull();
    expect(siteUrl('not a site')).toBeNull();
  });
  it('refuses a value whose real host is hidden behind credentials or a script scheme', () => {
    expect(siteUrl('https://trusted.com@evil.example/x')).toBeNull();
    expect(siteUrl('javascript:alert(1)')).toBeNull();
    expect(siteUrl('javascript://x.com/%0aalert(1)')).toBeNull();
  });
});
