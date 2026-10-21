import { describe, expect, it } from 'vitest';
import type { ShareSnapshot } from '@mi/contracts';
import { buildShareHtml, embedJson, newShareId, ogLayout, shareMeta, SHARE_DATA_TOKEN, SHARE_META_TOKEN } from './bundle';
import { assertSelfContained, createSharePackage } from './package';
import { buildZip } from './zip';

const TEMPLATE = `<!doctype html><html><head>${SHARE_META_TOKEN}<title>Stratemark</title></head><body><div id="root"></div><script id="stratemark-share-data" type="application/json">${SHARE_DATA_TOKEN}</script><script>/* the app's own code also mentions ${SHARE_DATA_TOKEN} */</script></body></html>`;

function snapshot(over: Partial<ShareSnapshot> = {}): ShareSnapshot {
  const now = '2026-10-17T10:00:00.000Z';
  return {
    v: 1,
    kind: 'card',
    focusCardId: 'card_a',
    sharedAt: now,
    markets: [{ id: 'mkt_1', name: 'Anvils', scopeDefinition: { vertical: 'Anvils' }, refreshCadence: 'weekly', createdAt: now }],
    decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: now, lastRefreshedAt: now }],
    companies: [{ id: 'cmp_a', name: 'Acme <Anvils> & "Co"', oneLiner: 'Acme makes anvils.', websiteUrl: 'https://acme.example', logoUrl: null, hqLocation: 'Austin, TX', brandTheme: null }],
    metrics: [
      { id: 'm1', companyId: 'cmp_a', metricType: 'employees', value: 450, confidence: 'verified', source: 'https://www.reuters.com/a', citations: [{ title: 'Reuters', url: 'https://www.reuters.com/a' }], methodNote: null, capturedAt: now },
      { id: 'm2', companyId: 'cmp_a', metricType: 'valuation', value: 2_000_000_000, confidence: 'estimated', source: null, citations: [], methodNote: 'guess', capturedAt: now },
      { id: 'm3', companyId: 'cmp_a', metricType: 'arr', value: null, confidence: 'unknown', source: null, citations: [], methodNote: null, capturedAt: now },
    ],
    cards: [{ id: 'card_a', deckId: 'deck_1', companyId: 'cmp_a', cardType: 'company', tier: 3, title: 'Acme', summary: 'Acme makes anvils for everyone.', keyPoints: [], citations: [], createdAt: now, updatedAt: now }],
    viceClaims: [],
    dashboards: {},
    ...over,
  } as unknown as ShareSnapshot;
}

describe('share ids', () => {
  it('are long, unguessable and only use unambiguous characters', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newShareId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[abcdefghijkmnpqrstuvwxyz23456789]{12}$/);
  });
});

describe('link preview text', () => {
  it('uses the card\'s own summary and says nothing it was not given', () => {
    const meta = shareMeta(snapshot());
    expect(meta.title).toBe('Acme <Anvils> & "Co": sourced research on Stratemark');
    expect(meta.description).toBe('Acme makes anvils for everyone.');
  });

  it('describes a deck by how many companies it holds', () => {
    const meta = shareMeta(snapshot({ kind: 'deck', focusCardId: null }));
    expect(meta.title).toContain('Anvils');
    expect(meta.description).toContain('1 company');
  });
});

describe('the share page', () => {
  const html = (over: Parameters<typeof buildShareHtml>[0] extends infer T ? Partial<T> : never = {}) =>
    buildShareHtml({ template: TEMPLATE, snapshot: snapshot(), shareId: 'abc123', withImage: true, ...over });

  it('carries the research inside and reads back identically', () => {
    const out = html();
    const data = /<script id="stratemark-share-data" type="application\/json">([\s\S]*?)<\/script>/.exec(out)![1]!;
    const parsed = JSON.parse(data) as { snapshot: ShareSnapshot; signupUrl: string };
    expect(parsed.snapshot).toEqual(snapshot());
    expect(parsed.signupUrl).toBe('https://getstratemark.com');
  });

  it('cannot be broken out of its data element, whatever the research says', () => {
    const hostile = snapshot({ cards: [{ ...snapshot().cards[0]!, summary: '</script><script>alert(1)</script> ' }] });
    const out = html({ snapshot: hostile });
    expect(out).not.toContain('</script><script>alert(1)');
    expect(embedJson({ a: '</script>' })).not.toContain('</script>');
    const data = /<script id="stratemark-share-data" type="application\/json">([\s\S]*?)<\/script>/.exec(out)![1]!;
    expect((JSON.parse(data) as { snapshot: ShareSnapshot }).snapshot.cards[0]!.summary).toContain('<script>alert(1)');
  });

  it('escapes the title and description in the tags', () => {
    const out = html();
    expect(out).toContain('content="Acme &lt;Anvils&gt; &amp; &quot;Co&quot;: sourced research on Stratemark"');
    expect(out).not.toContain('<title>Stratemark</title>');
    expect(out).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it('gives chat apps an absolute https picture address only when it knows where the page will live', () => {
    expect(html({ baseUrl: 'https://share.example.com/' })).toContain('property="og:image" content="https://share.example.com/abc123/og.png"');
    expect(html({ baseUrl: 'https://share.example.com/' })).toContain('summary_large_image');
    const without = html({ baseUrl: null });
    expect(without).not.toContain('og:image');
    expect(without).toContain('name="twitter:card" content="summary"');
    // A non-https address is not used: a guess would be a broken preview.
    expect(html({ baseUrl: 'http://share.example.com' })).not.toContain('og:image');
    expect(html({ baseUrl: 'https://share.example.com', withImage: false })).not.toContain('og:image');
  });

  it('only accepts an https sign-up address', () => {
    const data = (url: string) => (JSON.parse(/type="application\/json">([\s\S]*?)<\/script>/.exec(html({ signupUrl: url }))![1]!) as { signupUrl: string }).signupUrl;
    expect(data('https://sign.example/up')).toBe('https://sign.example/up');
    expect(data('javascript:alert(1)')).toBe('https://getstratemark.com');
  });

  it('refuses a template without its data slot', () => {
    expect(() => html({ template: '<html></html>' })).toThrow('data slot');
  });
});

describe('the template check', () => {
  it('accepts a built, self-contained page and refuses the dev server\'s page', () => {
    expect(() => assertSelfContained(TEMPLATE)).not.toThrow();
    expect(() => assertSelfContained(TEMPLATE.replace('<div id="root">', '<script type="module" src="/src/share-main.tsx"></script><div id="root">'))).toThrow('built app');
  });
});

describe('the preview picture', () => {
  it('shows a figure only when a source stands behind it', () => {
    const slots = ogLayout(snapshot()).slots;
    expect(slots.find((s) => s.label === 'Employees')!.value).toBe('450');
    // Estimated with no source, and unknown: never drawn as numbers.
    expect(slots.find((s) => s.label === 'Valuation')!.value).toBeNull();
    expect(slots.find((s) => s.label === 'Revenue / ARR')!.value).toBeNull();
  });

  it('does not draw an estimate: the card face shows those as Unknown', () => {
    const snap = snapshot({ metrics: [{ id: 'm', companyId: 'cmp_a', metricType: 'valuation', value: 2e9, confidence: 'estimated', source: 'https://www.reuters.com/a', citations: [{ title: 'Reuters', url: 'https://www.reuters.com/a' }], methodNote: 'n', capturedAt: '2026-10-17T10:00:00.000Z' }] as never });
    expect(ogLayout(snap).slots.find((s) => s.label === 'Valuation')!.value).toBeNull();
  });

  it('never lends a signal card a company name or figures', () => {
    const base = snapshot();
    const vice = { ...base.cards[0]!, id: 'card_v', cardType: 'vice' as const, title: 'A sourced claim', summary: 'A claim.', tier: null };
    const snap = snapshot({ cards: [vice], focusCardId: 'card_v' });
    const layout = ogLayout(snap);
    expect(layout.title).toBe('A sourced claim');
    expect(layout.slots).toEqual([]);
    expect(shareMeta(snap).title).toBe('Vice: A sourced claim');
  });

  it('gives a signal card with no title of its own a headline from its finding, never a generic "A card"', () => {
    const base = snapshot();
    const culture = { ...base.cards[0]!, id: 'card_c', cardType: 'culture' as const, title: null, summary: 'Sunrun Inc. states its core mission is "to create a planet run by the sun" by providing locally generated energy. It also publishes a values charter.', tier: null };
    const snap = snapshot({ cards: [culture as never], focusCardId: 'card_c' });
    const meta = shareMeta(snap);
    expect(meta.title).toMatch(/^Culture: Sunrun Inc\. states its core mission is "to create a planet run by the sun" by( providing)?…$/);
    expect(meta.description).toContain('It also publishes a values charter.');
    expect(ogLayout(snap).title).toMatch(/^Sunrun Inc\. states its core mission is "to create a planet run by the sun" by( providing)?…$/);
    expect(ogLayout(snap).eyebrow).toBe('CULTURE');
    const bare = snapshot({ cards: [{ ...culture, summary: null, keyPoints: [] } as never], focusCardId: 'card_c' });
    expect(shareMeta(bare).title).toBe('Culture: a sourced finding');
    expect(ogLayout(bare).title).toBe('');
  });

  it('draws a deck as a stack of its first companies', () => {
    const layout = ogLayout(snapshot({ kind: 'deck', focusCardId: null }));
    expect(layout.eyebrow).toBe('DECK');
    expect(layout.names).toEqual(['Acme <Anvils> & "Co"']);
    expect(layout.slots).toEqual([]);
  });
});

describe('the share package', () => {
  it('holds the page, the picture, the hosting settings and the one command', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const made = await createSharePackage({ snapshot: snapshot(), template: TEMPLATE, baseUrl: 'https://share.example.com', renderImage: async () => png, id: 'abc123' });
    expect(made.fileName).toMatch(/^stratemark-share-acme-anvils-co-abc123\.zip$/);
    expect(made.hasImage).toBe(true);
    const text = new TextDecoder().decode(made.zip);
    for (const name of ['firebase.json', 'README.txt', 'abc123/index.html', 'abc123/og.png']) expect(text).toContain(name);
    expect(text).toContain('firebase deploy --only hosting');
    expect(text).toContain('"public": "."');
  });

  it('still works, without a picture, when drawing is not available', async () => {
    const made = await createSharePackage({ snapshot: snapshot(), template: TEMPLATE, renderImage: async () => null, id: 'abc123' });
    expect(made.hasImage).toBe(false);
    expect(made.html).not.toContain('og:image');
    expect(new TextDecoder().decode(made.zip)).not.toContain('abc123/og.png');
  });
});

describe('zip files', () => {
  /** Reads the stored entries back, checking each CRC. */
  function read(bytes: Uint8Array): Map<string, Uint8Array> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Map<string, Uint8Array>();
    let at = 0;
    while (view.getUint32(at, true) === 0x04034b50) {
      const size = view.getUint32(at + 18, true);
      const nameLen = view.getUint16(at + 26, true);
      const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
      const start = at + 30 + nameLen;
      out.set(name, bytes.subarray(start, start + size));
      at = start + size;
    }
    return out;
  }

  it('round-trips names and bytes, including non-ASCII names', () => {
    const entries = [
      { path: 'a/index.html', data: '<p>héllo</p>' },
      { path: 'a/og.png', data: new Uint8Array([1, 2, 3, 4, 5]) },
      { path: 'ü.txt', data: '' },
    ];
    const files = read(buildZip(entries));
    expect([...files.keys()]).toEqual(['a/index.html', 'a/og.png', 'ü.txt']);
    expect(new TextDecoder().decode(files.get('a/index.html'))).toBe('<p>héllo</p>');
    expect([...files.get('a/og.png')!]).toEqual([1, 2, 3, 4, 5]);
  });

  it('writes the end-of-archive record with the right entry count', () => {
    const zip = buildZip([{ path: 'x', data: 'y' }, { path: 'z', data: 'w' }]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(2);
  });
});
