import { describe, expect, it } from 'vitest';
import { companyLogoSchema } from '../assets';
import { inlineLogoSvg, sanitizeInlineSvg } from './logo-candidates';

describe('inline header svg logo', () => {
  const page = new URL('https://acme.com/');
  const html = `<header><a href="/"><svg viewBox="0 0 10 10" aria-label="Acme logo" onclick="x()"><script>alert(1)</script><path fill="currentColor" d="M0 0h10v10z"/></svg></a></header>
    <meta property="og:image" content="https://acme.com/share.jpg">`;
  it('serializes a sanitized data URI that the schema accepts', () => {
    const r = inlineLogoSvg(html, page, 'Acme')!;
    expect(r.dataUri.startsWith('data:image/svg+xml,')).toBe(true);
    expect(r.svg).not.toMatch(/script|onclick/i);
    expect(r.svg).toContain('xmlns=');
    expect(companyLogoSchema.safeParse({ kind: 'logo', url: r.dataUri, sourceUrl: 'https://acme.com/', retrievedAt: 'x' }).success).toBe(true);
  });
  it('rejects sprite references, oversize svgs, and never treats og:image as a logo', () => {
    expect(sanitizeInlineSvg('<svg viewBox="0 0 1 1"><use href="#a"/></svg>')).toBeNull();
    expect(sanitizeInlineSvg(`<svg viewBox="0 0 1 1"><path d="${'M0 0'.repeat(9000)}"/></svg>`)).toBeNull();
    expect(inlineLogoSvg('<meta property="og:image" content="https://acme.com/share.jpg">', page, 'Acme')).toBeNull();
  });
});
