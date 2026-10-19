import { describe, expect, it } from 'vitest';
import {
  SHARE_LIMITS_DEFAULT, SHARE_MAX_DATA_CHARS, SHARE_MAX_OG_CHARS, chunkText, cleanText, escapeHtml, goneHtml, isShareId, newShareId,
  parseShareCreate, randomToken, sameSecret, sharePageHtml, takeShareQuota, viewerUrlFor, type QuotaDay,
} from './share-policy';

const ORIGIN = 'https://app.getstratemark.com';
const VIEWER = `${ORIGIN}/share.html`;
const DATA = 'A'.repeat(200);
const PNG = `iVBORw0KGgo${'A'.repeat(40)}`;
const body = (over: Record<string, unknown> = {}) => ({ v: 1, kind: 'deck', title: 'Meal kits', description: 'Ten companies', viewer: VIEWER, data: DATA, og: PNG, ...over });

describe('what a share request may contain', () => {
  it('accepts a well-formed deck or card share', () => {
    const parsed = parseShareCreate(body(), ORIGIN);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toMatchObject({ kind: 'deck', title: 'Meal kits', viewer: VIEWER, og: PNG });
    expect(parseShareCreate(body({ kind: 'card', og: null }), ORIGIN)).toMatchObject({ ok: true });
  });

  it('refuses what is not a share', () => {
    for (const bad of [null, 'x', 7, [], {}, body({ v: 2 }), body({ kind: 'briefing' }), body({ title: '' }), body({ title: '   ' }), body({ data: 'short' }), body({ data: 'has spaces and !' })]) {
      expect(parseShareCreate(bad, ORIGIN)).toMatchObject({ ok: false, status: 400 });
    }
  });

  it('refuses a snapshot or a picture that is too large with a plain 413', () => {
    expect(parseShareCreate(body({ data: 'A'.repeat(SHARE_MAX_DATA_CHARS + 1) }), ORIGIN)).toMatchObject({ ok: false, status: 413 });
    expect(parseShareCreate(body({ og: `iVBORw0KGgo${'A'.repeat(SHARE_MAX_OG_CHARS)}` }), ORIGIN)).toMatchObject({ ok: false, status: 413 });
  });

  it('accepts a PNG picture only', () => {
    expect(parseShareCreate(body({ og: 'R0lGODlhAQABAAAAACw=' }), ORIGIN)).toMatchObject({ ok: false });
    expect(parseShareCreate(body({ og: '<script>alert(1)</script>' }), ORIGIN)).toMatchObject({ ok: false });
    expect(parseShareCreate(body({ og: 42 }), ORIGIN)).toMatchObject({ ok: false });
    expect(parseShareCreate(body({ og: undefined }), ORIGIN)).toMatchObject({ ok: true });
  });

  it('strips control characters and bounds the text that ends up in a page', () => {
    const nasty = `Hello${String.fromCharCode(0)}${String.fromCharCode(10)}World${String.fromCharCode(0x2028)}x`;
    expect(cleanText(nasty, 50)).toBe('Hello World x');
    expect(cleanText('a'.repeat(500), 140)).toHaveLength(140);
    expect(cleanText(undefined, 10)).toBe('');
    const parsed = parseShareCreate(body({ title: `  ${'T'.repeat(300)}  `, description: 'D'.repeat(900) }), ORIGIN);
    expect(parsed.ok && parsed.value.title.length).toBe(140);
    expect(parsed.ok && parsed.value.description.length).toBe(300);
  });
});

describe('the viewer address', () => {
  it('must be a share.html on the same origin that asked, with nothing after it', () => {
    expect(viewerUrlFor(VIEWER, ORIGIN)).toBe(VIEWER);
    expect(viewerUrlFor(`${ORIGIN}/beta/app/share.html`, ORIGIN)).toBe(`${ORIGIN}/beta/app/share.html`);
    // Dot segments are resolved before the check, so the stored address is the normalised one on the same origin.
    expect(viewerUrlFor(`${ORIGIN}/../share.html`, ORIGIN)).toBe(VIEWER);
  });

  it('refuses every way to bounce a visitor somewhere else', () => {
    for (const bad of [
      'https://evil.example/share.html', `${ORIGIN}.evil.example/share.html`, 'http://app.getstratemark.com/share.html',
      `${ORIGIN}/share.html?next=https://evil.example`, `${ORIGIN}/share.html#x`, `${ORIGIN}/index.html`,
      `${ORIGIN}/a b/share.html`, 'https://user:pw@app.getstratemark.com/share.html', 'javascript:alert(1)', `${ORIGIN}/share.html/extra`, '', 7, null,
      `${ORIGIN}/${'a'.repeat(400)}/share.html`,
    ]) {
      expect(viewerUrlFor(bad, ORIGIN), String(bad)).toBeNull();
    }
  });
});

describe('ids, tokens and secrets', () => {
  it('makes unguessable 16-character ids from 96 random bits', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newShareId()));
    expect(ids.size).toBe(500);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
      expect(isShareId(id)).toBe(true);
    }
    expect(randomToken(18)).toHaveLength(24);
  });

  it('only accepts a share id of exactly that shape', () => {
    for (const bad of ['', 'short', 'a'.repeat(17), 'a'.repeat(15), `${'a'.repeat(15)}/`, `${'a'.repeat(15)}.`, '../../etc/passwd0000']) expect(isShareId(bad)).toBe(false);
  });

  it('compares secrets without stopping at the first difference', () => {
    expect(sameSecret('abc123', 'abc123')).toBe(true);
    expect(sameSecret('abc123', 'abc124')).toBe(false);
    expect(sameSecret('abc', 'abcd')).toBe(false);
    expect(sameSecret('', '')).toBe(true);
  });

  it('cuts text into pieces that join back exactly', () => {
    const text = 'x'.repeat(250_001);
    const pieces = chunkText(text);
    expect(pieces).toHaveLength(3);
    expect(pieces.join('')).toBe(text);
    expect(Math.max(...pieces.map((p) => p.length))).toBeLessThanOrEqual(100_000);
    expect(chunkText('')).toEqual([]);
  });
});

describe('the page a pasted link opens', () => {
  const page = {
    title: 'Meal kits: a deck of sourced research', description: 'Ten companies, every figure with its source.',
    pageUrl: 'https://api.example.workers.dev/s/abcdefghijklmnop', imageUrl: 'https://api.example.workers.dev/s/abcdefghijklmnop/og.png',
    viewerUrl: `${VIEWER}?s=abcdefghijklmnop`,
  };

  it('carries the preview tags a chat app reads, and a hand-off to the viewer, and no script', () => {
    const html = sharePageHtml(page);
    expect(html).toContain('<meta property="og:title" content="Meal kits: a deck of sourced research" />');
    expect(html).toContain('<meta property="og:image" content="https://api.example.workers.dev/s/abcdefghijklmnop/og.png" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).toContain(`<meta http-equiv="refresh" content="0;url=${VIEWER}?s=abcdefghijklmnop" />`);
    expect(html).toContain(`<a href="${VIEWER}?s=abcdefghijklmnop">`);
    expect(html.toLowerCase()).not.toContain('<script');
  });

  it('uses the small card when there is no picture', () => {
    const html = sharePageHtml({ ...page, imageUrl: null });
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
    expect(html).not.toContain('og:image');
  });

  it('escapes everything a sender typed, so a title cannot add tags or break out of an attribute', () => {
    const html = sharePageHtml({ ...page, title: '"><script>alert(1)</script><b onmouseover=x>', description: `it's <img src=x onerror=alert(1)> & more` });
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('"><');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
    expect(html).toContain('it&#39;s &lt;img');
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
  });

  it('has a plain gone page that does not reveal whether a link ever existed', () => {
    const html = goneHtml();
    expect(html).toContain('no longer available');
    expect(html).toContain('noindex');
    expect(html.toLowerCase()).not.toContain('<script');
  });
});

describe('daily share limits', () => {
  const limits = { ...SHARE_LIMITS_DEFAULT, visitorCount: 2, visitorBytes: 1_000, globalCount: 4, globalBytes: 10_000, maxVisitors: 3 };
  const day = '2026-10-19';

  it('lets a visitor make a few shares a day, then says visitor', () => {
    let ledger: QuotaDay | undefined;
    for (let i = 0; i < 2; i++) {
      const r = takeShareQuota(ledger, day, 'v1', 100, limits);
      expect(r.ok).toBe(true);
      ledger = r.ledger;
    }
    expect(takeShareQuota(ledger, day, 'v1', 100, limits)).toMatchObject({ ok: false, reason: 'visitor' });
    expect(takeShareQuota(ledger, day, 'v2', 100, limits).ok).toBe(true);
  });

  it('limits what one visitor may store, and what everyone may', () => {
    expect(takeShareQuota(undefined, day, 'v1', 1_001, limits)).toMatchObject({ ok: false, reason: 'visitor' });
    expect(takeShareQuota(undefined, day, 'v1', 20_000, { ...limits, visitorBytes: 50_000 })).toMatchObject({ ok: false, reason: 'global' });
    let ledger: QuotaDay | undefined;
    for (const v of ['a', 'b', 'c']) ledger = takeShareQuota(ledger, day, v, 10, { ...limits, maxVisitors: 10 }).ledger;
    ledger = takeShareQuota(ledger, day, 'd', 10, { ...limits, maxVisitors: 10 }).ledger;
    expect(takeShareQuota(ledger, day, 'e', 10, { ...limits, maxVisitors: 10 })).toMatchObject({ ok: false, reason: 'global' });
  });

  it('stops tracking new visitors past a ceiling instead of growing without bound', () => {
    let ledger: QuotaDay | undefined;
    for (const v of ['a', 'b', 'c']) ledger = takeShareQuota(ledger, day, v, 10, limits).ledger;
    expect(takeShareQuota(ledger, day, 'new', 10, limits)).toMatchObject({ ok: false, reason: 'global' });
    expect(takeShareQuota(ledger, day, 'a', 10, limits).ok).toBe(true);
  });

  it('starts a clean count each UTC day, and a refused request changes nothing', () => {
    const full = takeShareQuota(takeShareQuota(undefined, day, 'v1', 100, limits).ledger, day, 'v1', 100, limits).ledger;
    expect(takeShareQuota(full, '2026-10-20', 'v1', 100, limits).ok).toBe(true);
    const refused = takeShareQuota(full, day, 'v1', 100, limits);
    expect(refused.ok).toBe(false);
    expect(refused.ledger).toEqual(full);
  });
});
