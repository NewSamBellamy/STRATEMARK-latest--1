/** brand — ranked logo ladder + real-colour extraction against fixture HTML. */
import { describe, expect, it, vi } from 'vitest';
import type { OriginalSourceReceipt } from '../original-source';
import { resolveBrand } from './index';
import { collectLogoCandidates, upsizeShopify } from './logo-candidates';
import { cssVarColors, metaThemeColors } from './colors';
import { quantizePixels, svgPalette } from './color';

const AT = '2026-10-10T12:00:00.000Z';

function reader(pages: Record<string, string>) {
  return vi.fn(async (url: string): Promise<OriginalSourceReceipt> =>
    pages[url] === undefined
      ? { requestedUrl: url, status: 'unavailable', retrievedAt: AT }
      : { requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200, retrievedAt: AT, contentHash: 'a'.repeat(64), text: pages[url]! });
}
const noFetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;

describe('logo ladder', () => {
  it('prefers JSON-LD Organization.logo (ImageObject and string) over the header logo', async () => {
    const html = `<script type="application/ld+json">{"@type":"Organization","name":"Acme","logo":{"@type":"ImageObject","url":"/brand/acme.svg"}}</script>
      <header><a href="/"><img class="site-logo" src="/img/header-logo.png" width="200" height="60"></a></header>`;
    const res = await resolveBrand('https://acme.example', { read: reader({ 'https://acme.example/': html }), fetchImpl: noFetch, skipWikidata: true });
    expect(res.logo).toMatchObject({ url: 'https://acme.example/brand/acme.svg', via: 'json-ld' });
    const str = `<script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"A","logo":"https://acme.example/l.png"}]}</script>`;
    expect(collectLogoCandidates(str, new URL('https://acme.example/'))[0]).toMatchObject({ url: 'https://acme.example/l.png', via: 'json-ld' });
  });

  it('picks a header <img> logo with a relative URL, SVG before larger raster', () => {
    const html = `<nav><a href="/"><img class="logo" src="logo.png" width="300" height="90"></a>
      <img id="brand-logo" alt="Acme logo" src="/assets/acme.svg"></nav>
      <footer><img class="logo" src="/footer.png"></footer>`;
    const c = collectLogoCandidates(html, new URL('https://acme.example/en/'));
    expect(c.map((x) => x.url)).toEqual(['https://acme.example/assets/acme.svg', 'https://acme.example/en/logo.png']);
    expect(c.every((x) => x.via === 'header-logo')).toBe(true);
  });

  it('rejects tiny non-Shopify favicons and upsizes Shopify crop/height params', () => {
    expect(collectLogoCandidates('<link rel="icon" href="/f.png?height=32" sizes="32x32">', new URL('https://acme.example/'))).toEqual([]);
    const shop = 'https://lyres.com/cdn/shop/files/Flavicon_horatio.png?crop=center&height=32&v=1&width=32';
    expect(upsizeShopify(shop)).toBe('https://lyres.com/cdn/shop/files/Flavicon_horatio.png?v=1&width=512');
    const c = collectLogoCandidates(`<link rel="icon" href="${shop}">`, new URL('https://lyres.com/'));
    expect(c[0]?.url).toBe('https://lyres.com/cdn/shop/files/Flavicon_horatio.png?v=1&width=512');
    const header = `<header><img class="header__logo" src="//lyres.com/cdn/shop/files/logo.png?height=32"></header>`;
    expect(collectLogoCandidates(header, new URL('https://lyres.com/'))[0]?.url).toContain('width=512');
  });

  it('allows the store CDN but rejects unrelated third-party hosts', () => {
    const html = `<header><img class="logo" src="https://cdn.shopify.com/s/files/1/0001/logo.png">
      <img class="logo" src="https://tracker.evil.example/logo.png"></header>`;
    const c = collectLogoCandidates(html, new URL('https://acme.example/'));
    expect(c.map((x) => x.url)).toEqual(['https://cdn.shopify.com/s/files/1/0001/logo.png']);
  });

  it('uses og:image only when its filename looks like a logo', () => {
    const page = new URL('https://acme.example/');
    expect(collectLogoCandidates('<meta property="og:image" content="/img/hero-photo.jpg">', page)).toEqual([]);
    expect(collectLogoCandidates('<meta property="og:image" content="/img/brand-mark.png">', page)[0]?.via).toBe('og:image-logo');
  });
});

describe('Wikidata fallback', () => {
  const html = '<html><body>no logo here</body></html>';
  it('is used only when the page has no JSON-LD/header logo, and passes the domain for verification', async () => {
    const wikidataLogo = vi.fn(async () => 'https://upload.wikimedia.org/x/Acme.svg');
    const res = await resolveBrand('https://acme.example', { read: reader({ 'https://acme.example/': html }), fetchImpl: noFetch, name: 'Acme', wikidataLogo });
    expect(res.logo).toMatchObject({ url: 'https://upload.wikimedia.org/x/Acme.svg', via: 'wikidata' });
    expect(wikidataLogo).toHaveBeenCalledWith({ name: 'Acme', domain: 'acme.example', qid: null });
  });
  it('is skipped when a first-party logo exists', async () => {
    const wikidataLogo = vi.fn(async () => 'https://upload.wikimedia.org/x/Acme.svg');
    await resolveBrand('https://acme.example', { read: reader({ 'https://acme.example/': '<header><img class="logo" src="/l.png"></header>' }), fetchImpl: noFetch, wikidataLogo });
    expect(wikidataLogo).not.toHaveBeenCalled();
  });

  function wdFetch(website: string) {
    return vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('wbsearchentities')) return new Response(JSON.stringify({ search: [{ id: 'Q1' }] }));
      return new Response(JSON.stringify({ entities: { Q1: { claims: {
        P856: [{ mainsnak: { datavalue: { value: website } } }],
        P154: [{ mainsnak: { datavalue: { value: 'Acme logo.svg' } } }],
      } } } }));
    }) as unknown as typeof fetch;
  }
  it('default adapter yields nothing when the candidate website does not match the domain', async () => {
    const res = await resolveBrand('https://acme.example', { read: reader({ 'https://acme.example/': html }), fetchImpl: wdFetch('https://other-company.example'), name: 'Acme' });
    expect(res.logo).toBeNull();
  });
  it('default adapter returns the Commons logo when the website matches the domain', async () => {
    const res = await resolveBrand('https://acme.example', { read: reader({ 'https://acme.example/': html }), fetchImpl: wdFetch('https://www.acme.example/'), name: 'Acme' });
    expect(res.logo?.via).toBe('wikidata');
    expect(res.logo?.url).toContain('Acme_logo.svg');
  });
});

describe('brand colours', () => {
  it('reads theme-color and msapplication-TileColor', () => {
    expect(metaThemeColors('<meta name="theme-color" content="#E4572E"><meta name="msapplication-TileColor" content="#003366">').map((e) => e.hex))
      .toEqual(['#e4572e', '#003366']);
  });
  it('reads CSS brand variables, including Shopify rgb triples', () => {
    const html = '<style>:root{--color-primary:#1a73e8;--color-text:#111111;--color-base-accent-1: 200, 30, 60;}</style>';
    expect(cssVarColors(html).map((e) => e.hex)).toEqual(['#1a73e8', '#c81e3c']);
  });
  it('extracts fill/stroke colours from SVG text', () => {
    const svg = '<svg><path fill="#FF5500"/><path fill="#ff5500"/><rect style="fill:#003366"/><path fill="none"/><path stroke="currentColor"/></svg>';
    expect(svgPalette(svg)).toEqual([{ hex: '#ff5500', weight: 2 }, { hex: '#003366', weight: 1 }]);
  });
  it('quantizes raster pixels and ignores transparent ones', () => {
    const px = [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 9, 9, 9, 0];
    expect(quantizePixels(px)).toEqual([{ hex: '#ff0000', weight: 2 }, { hex: '#0000ff', weight: 1 }]);
  });

  it('builds scraped colours from an SVG logo, recording the signal', async () => {
    const html = '<header><img class="logo" src="/logo.svg"></header>';
    const read = reader({
      'https://acme.example/': html,
      'https://acme.example/logo.svg': '<svg><path fill="#0A6E4F"/><path fill="#F2B705"/><path fill="#ffffff"/></svg>',
    });
    const res = await resolveBrand('https://acme.example', { read, fetchImpl: noFetch, skipWikidata: true });
    expect(res.colors).toEqual({ primary: '#0a6e4f', secondary: '#f2b705', accent: '#f2b705', signal: 'logo-svg' });
  });

  it('prefers theme-color over logo colours and records it', async () => {
    const html = '<meta name="theme-color" content="#E4572E"><header><img class="logo" src="/logo.svg"></header>';
    const read = reader({ 'https://acme.example/': html, 'https://acme.example/logo.svg': '<svg><path fill="#0A6E4F"/></svg>' });
    const res = await resolveBrand('https://acme.example', { read, fetchImpl: noFetch, skipWikidata: true });
    expect(res.colors).toMatchObject({ primary: '#e4572e', secondary: '#0a6e4f', signal: 'theme-color' });
  });

  it('treats a purely neutral logo as a monochrome primary', async () => {
    const read = reader({ 'https://acme.example/': '<header><img class="logo" src="/logo.svg"></header>', 'https://acme.example/logo.svg': '<svg><path fill="#111111"/></svg>' });
    const res = await resolveBrand('https://acme.example', { read, fetchImpl: noFetch, skipWikidata: true });
    expect(res.colors?.primary).toBe('#111111');
  });

  it('returns null colours (caller keeps default) and no logo when nothing is found', async () => {
    const res = await resolveBrand('https://acme.example', { read: reader({ 'https://acme.example/': '<html><body>hi</body></html>' }), fetchImpl: noFetch, skipWikidata: true });
    expect(res).toEqual({ logo: null, colors: null });
    expect(await resolveBrand('https://acme.example', { read: reader({}), fetchImpl: noFetch, skipWikidata: true })).toEqual({ logo: null, colors: null });
  });
});
