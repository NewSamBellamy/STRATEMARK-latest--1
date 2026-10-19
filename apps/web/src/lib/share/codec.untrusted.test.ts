/**
 * A share link is data from a stranger: anyone can type `#/share/<blob>` by hand. These tests forge links the way a
 * hostile sender would and check what the recipient is shown. Red-team findings against the private (in-the-address)
 * share path: a forged "user verified" figure, unsourced allegations, a made-up capture date, a link that inflates
 * without limit, and a payload of the wrong shape that crashed the page instead of being refused.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifiedAtMs, type CardWithCompany } from '@mi/contracts';
import { buildCardView } from '@/features/card/card-view';
import {
  MAX_INFLATED_BYTES,
  SHARE_LIMITS,
  buildCardShare,
  decodeSharePayload,
  encodeSharePayload,
  sharedToCardWithCompany,
  type SharePayload,
} from './codec';

const SHARED_AT = '2026-10-01T09:00:00.000Z';

/** A card as it travels on the wire (the short-key shape the codec reads), with anything overridden. */
function wireCard(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'company', title: null, summary: null, tier: 7, keyPoints: ['A point'], citations: [], claims: [],
    company: { name: 'Acme', oneLiner: 'Makes things.', website: 'https://acme.example', hq: null, logo: null },
    metrics: [], ...over,
  };
}

function wirePayload(cards: unknown[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return { v: 1, kind: 'deck', market: 'Things', sharedAt: SHARED_AT, cards, ...over };
}

/** A link a stranger could have made: the codec's own compressor, but nothing checked on the way in. */
async function forgedLink(payload: unknown): Promise<string> {
  const blob = await encodeSharePayload(payload as SharePayload);
  expect(blob.charAt(0)).toBe('z'); // the compressed path, the one a real link takes
  return blob;
}

/** The same, for JSON text `JSON.stringify` cannot produce (1e999 parses to Infinity). */
function plainLink(jsonText: string): string {
  const bin = Array.from(new TextEncoder().encode(jsonText), (b) => String.fromCharCode(b)).join('');
  return `j${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/** Open a forged link the way the share page does: decode, then render each card. */
async function open(payload: unknown): Promise<{ payload: SharePayload; cards: CardWithCompany[] } | null> {
  const decoded = await decodeSharePayload(await forgedLink(payload));
  if (!decoded) return null;
  return { payload: decoded, cards: decoded.cards.map((c, i) => sharedToCardWithCompany(c, i, decoded.sharedAt)) };
}

const noCitation = { t: 'valuation', v: 9_000_000_000_000, c: 'user_verified' };

describe('a link cannot claim a human checked a figure', () => {
  it('"user verified" with no source is shown as an estimate, never as user verified (finding 1)', async () => {
    const opened = await open(wirePayload([wireCard({ metrics: [noCitation] })]));
    expect(opened).not.toBeNull();
    const metric = opened!.cards[0]!.metrics[0]!;
    expect(metric.confidence).not.toBe('user_verified');
    expect(metric.confidence).toBe('estimated'); // demoted to verified, which no source then earns
    expect(opened!.payload.cards[0]!.metrics[0]!.c).toBe('estimated');
    const face = buildCardView(opened!.cards[0]!).faceMetrics;
    expect(face.some((f) => f.metric?.confidence === 'user_verified')).toBe(false);
  });

  it('even a source does not make it user verified: it is shown as verified at most', async () => {
    const sourced = { ...noCitation, s: { t: 'sec.gov', u: 'https://www.sec.gov/acme' } };
    const opened = (await open(wirePayload([wireCard({ metrics: [sourced] })])))!;
    expect(opened.cards[0]!.metrics[0]!.confidence).toBe('verified');
    expect(opened.cards[0]!.metrics[0]!.value).toBe(9_000_000_000_000);
  });

  it('an unsourced "verified" figure is an estimate; a source that is not a web page earns nothing', async () => {
    const forged = [
      { t: 'arr', v: 5, c: 'verified' },
      { t: 'users', v: 6, c: 'verified', s: { t: 'x', u: 'javascript:alert(1)' } },
      { t: 'employees', v: 7, c: 'verified', s: { t: 'x', u: 'https://name:secret@evil.example/a' } },
    ];
    const opened = (await open(wirePayload([wireCard({ metrics: forged })])))!;
    expect(opened.cards[0]!.metrics.map((m) => m.confidence)).toEqual(['estimated', 'estimated', 'estimated']);
    expect(opened.cards[0]!.metrics.every((m) => m.citations.length === 0 && m.source === null)).toBe(true);
  });

  it('the rule holds for a card handed straight to the renderer, not only through decode', () => {
    const card = wireCard({ metrics: [noCitation] }) as unknown as Parameters<typeof sharedToCardWithCompany>[0];
    expect(sharedToCardWithCompany(card, 0, SHARED_AT).metrics[0]!.confidence).toBe('estimated');
  });

  it('an unsourced ownership claim a link carries is not shown', async () => {
    const ow = { status: 'acquired', acquirer: 'MegaCorp', closedOn: '2025-01-01', confidence: 'user_verified', citations: [] };
    const company = { name: 'Acme', oneLiner: 'Makes things.', website: null, hq: null, logo: null, ow };
    const opened = (await open(wirePayload([wireCard({ company })])))!;
    expect(opened.cards[0]!.company?.ownership).toBeUndefined();
  });

  it('a signal card carries no figures, whatever the link attaches to it (Rule 9)', async () => {
    const opened = (await open(wirePayload([
      wireCard({ type: 'vice', company: null, metrics: [{ t: 'valuation', v: 1, c: 'verified', s: { t: 'x', u: 'https://reuters.com/a' } }] }),
      wireCard({ type: 'insight', metrics: [{ t: 'arr', v: 2, c: 'verified', s: { t: 'x', u: 'https://reuters.com/a' } }] }),
    ])))!;
    expect(opened.cards.map((c) => c.metrics.length)).toEqual([0, 0]);
  });

  it('a figure the sender\'s app verified on a later source is still verified after a round trip', async () => {
    // The recipient re-checks "verified" against the one source a link carries, so the sender must send the source that
    // earned it, not whichever was listed first.
    const citations = [
      { title: 'some-blog.example', url: 'https://some-blog.example/post' },
      { title: 'sec.gov', url: 'https://www.sec.gov/cgi-bin/acme-10k' },
    ];
    const live = {
      card: { id: 'c', deckId: 'd', companyId: 'cmp', cardType: 'company', title: null, summary: null, tier: 5, tierReason: null, citations: [], keyPoints: [], createdAt: SHARED_AT },
      company: { id: 'cmp', name: 'Acme', oneLiner: 'Makes things.', logoUrl: null, hqLocation: null, websiteUrl: 'https://acme.example', brandTheme: null },
      metrics: [{ id: 'm', companyId: 'cmp', metricType: 'arr', value: 4_000_000, confidence: 'verified', source: citations[0]!.url, citations, methodNote: null, capturedAt: SHARED_AT }],
      viceClaims: [],
    } as unknown as CardWithCompany;
    const blob = await encodeSharePayload(buildCardShare(live, null));
    const decoded = (await decodeSharePayload(blob))!;
    expect(decoded.cards[0]!.metrics[0]!.c).toBe('verified');
    expect(decoded.cards[0]!.metrics[0]!.s?.u).toBe('https://www.sec.gov/cgi-bin/acme-10k');
  });
});

describe('allegations and links a link carries (Rule 9)', () => {
  it('a risk claim with no usable http(s) source is dropped, not displayed (finding 2)', async () => {
    const claims = [
      { text: 'Alleged fraud.', t: null, u: '' },
      { text: 'Alleged cartel.', t: 'x', u: 'javascript:alert(1)' },
      { text: 'Alleged bribery.', t: 'x', u: 'https://name:secret@evil.example/a' },
      { text: 'Alleged leak.', t: 'x', u: 'ftp://files.example/a' },
      { text: 'Reported governance turbulence.', t: 'theverge.com', u: 'https://theverge.com/x' },
    ];
    const opened = (await open(wirePayload([wireCard({ type: 'vice', company: null, claims })])))!;
    expect(opened.cards[0]!.viceClaims.map((c) => c.claimText)).toEqual(['Reported governance turbulence.']);
    expect(opened.payload.cards[0]!.claims).toHaveLength(1);
    expect(opened.cards[0]!.viceClaims[0]!.sourceUrl).toBe('https://theverge.com/x');
  });

  it('a card with only unsourced claims shows none', async () => {
    const opened = (await open(wirePayload([wireCard({ type: 'vice', company: null, claims: [{ text: 'Alleged fraud.', t: null, u: 'not a link' }] })])))!;
    expect(opened.cards[0]!.viceClaims).toEqual([]);
  });

  it('every link must be a plain http(s) page: card sources, company site, logo, briefing and report sources', async () => {
    const bad = 'javascript:alert(document.cookie)';
    const good = 'https://reuters.com/a';
    const company = { name: 'Acme', oneLiner: 'Makes things.', website: bad, hq: null, logo: 'data:image/svg+xml,<svg/>' };
    const opened = (await open(wirePayload([wireCard({ company, citations: [{ t: 'bad', u: bad }, { t: 'good', u: good }] })], {
      kind: 'briefing',
      briefing: { h: 'Headline', at: SHARED_AT, w: 24, i: [], u: [{ n: 'Acme', s: 'h', o: 'one', d: 'detail', p: null, c: [{ t: 'bad', u: bad }, { t: 'good', u: good }] }] },
    })))!;
    expect(opened.cards[0]!.company?.websiteUrl).toBeNull();
    expect(opened.cards[0]!.company?.logoUrl).toBeNull();
    expect(opened.cards[0]!.card.citations.map((c) => c.url)).toEqual([good]);
    expect(opened.payload.briefing!.u[0]!.c.map((c) => c.u)).toEqual([good]);

    const report = (await open(wirePayload([], {
      kind: 'report', report: { t: 'R', k: 'company', at: SHARED_AT, md: '# R', c: [{ t: 'bad', u: bad }, { t: 'good', u: good }] },
    })))!;
    expect(report.payload.report!.c.map((c) => c.u)).toEqual([good]);
  });
});

describe('a link cannot make up a capture date', () => {
  it('a figure with no date has no date: the share time is not substituted (finding 3)', async () => {
    const opened = (await open(wirePayload([wireCard({ metrics: [{ t: 'arr', v: 5, c: 'estimated' }] })])))!;
    const metric = opened.cards[0]!.metrics[0]!;
    expect(metric.capturedAt).not.toBe(SHARED_AT);
    expect(metric.capturedAt).toBe('');
    // Nothing downstream can read a share-time stamp as "just captured": an undated figure has no age to vouch for.
    expect(verifiedAtMs(metric)).toBeNull();
    // Nor does an allegation get the share time as the day it was captured.
    const claim = (await open(wirePayload([wireCard({ type: 'vice', company: null, claims: [{ text: 'A', t: null, u: 'https://x.example/a' }] })])))!;
    expect(claim.cards[0]!.viceClaims[0]!.capturedAt).toBe('');
  });

  it('a malformed date is treated as no date; a real one is kept as the day it was captured', async () => {
    const metrics = [
      { t: 'arr', v: 1, c: 'estimated', at: '2026-02-31' },
      { t: 'users', v: 2, c: 'estimated', at: 'yesterday' },
      { t: 'employees', v: 3, c: 'estimated', at: '2026-09-01' },
    ];
    const opened = (await open(wirePayload([wireCard({ metrics })])))!;
    expect(opened.cards[0]!.metrics.map((m) => m.capturedAt)).toEqual(['', '', '2026-09-01T00:00:00.000Z']);
  });
});

describe('a link cannot inflate without limit (finding 4)', () => {
  const realDecompression = globalThis.DecompressionStream;
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a payload that inflates past the cap is refused, even though it is otherwise a valid share', async () => {
    // A valid payload carrying 25 MB of padding in a field the viewer ignores: it deflates to a few kilobytes.
    const blob = await forgedLink(wirePayload([wireCard()], { pad: 'a'.repeat(MAX_INFLATED_BYTES + 1_000_000) }));
    expect(blob.length).toBeLessThan(200_000);
    expect(await decodeSharePayload(blob)).toBeNull();
  });

  it('stops inflating at the cap rather than inflating it all and then discarding the result', async () => {
    let produced = 0;
    class CountingDecompression {
      readonly readable: ReadableStream<Uint8Array>;
      readonly writable: WritableStream<BufferSource>;
      constructor(format: CompressionFormat) {
        const inner = new realDecompression(format);
        this.writable = inner.writable;
        this.readable = inner.readable.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            produced += chunk.byteLength;
            controller.enqueue(chunk);
          },
        }));
      }
    }
    vi.stubGlobal('DecompressionStream', CountingDecompression);
    const total = MAX_INFLATED_BYTES * 2;
    const blob = await forgedLink(wirePayload([wireCard()], { pad: 'a'.repeat(total) }));
    expect(await decodeSharePayload(blob)).toBeNull();
    expect(produced).toBeGreaterThan(MAX_INFLATED_BYTES);
    expect(produced).toBeLessThan(MAX_INFLATED_BYTES * 1.25); // it read a little past the cap, never the whole thing
  }, 60_000);

  it('a payload under the cap still opens', async () => {
    const blob = await forgedLink(wirePayload([wireCard()], { pad: 'a'.repeat(2_000_000) }));
    expect(await decodeSharePayload(blob)).not.toBeNull();
  });

  it('plain-JSON links are held to the same cap', async () => {
    const text = JSON.stringify(wirePayload([wireCard()], { pad: 'a'.repeat(MAX_INFLATED_BYTES + 10) }));
    expect(await decodeSharePayload(plainLink(text))).toBeNull();
  });
});

describe('a payload with an absurd number of rows is refused (finding 4)', () => {
  const withCompany = () => wireCard();
  const signal = () => wireCard({ type: 'vice', company: null });

  it('too many cards', async () => {
    const cards = Array.from({ length: SHARE_LIMITS.cards + 1 }, signal);
    expect(await decodeSharePayload(await forgedLink(wirePayload(cards)))).toBeNull();
    expect(await decodeSharePayload(await forgedLink(wirePayload(cards.slice(1))))).not.toBeNull();
  });

  it('too many companies', async () => {
    const cards = Array.from({ length: SHARE_LIMITS.companies + 1 }, withCompany);
    expect(await decodeSharePayload(await forgedLink(wirePayload(cards)))).toBeNull();
    expect(await decodeSharePayload(await forgedLink(wirePayload(cards.slice(1))))).not.toBeNull();
  });

  it('too many figures, counted across cards', async () => {
    const metric = { t: 'arr', v: 1, c: 'estimated' };
    const per = 100;
    const cards = Array.from({ length: SHARE_LIMITS.metrics / per + 1 }, () => wireCard({ metrics: Array.from({ length: per }, () => metric) }));
    expect(await decodeSharePayload(await forgedLink(wirePayload(cards)))).toBeNull();
    expect(await decodeSharePayload(await forgedLink(wirePayload(cards.slice(1))))).not.toBeNull();
  });

  it('too many risk claims, counted across cards', async () => {
    const claim = { text: 'A', t: null, u: 'https://x.example/a' };
    const per = 100;
    const cards = Array.from({ length: SHARE_LIMITS.viceClaims / per + 1 }, () => wireCard({ type: 'vice', company: null, claims: Array.from({ length: per }, () => claim) }));
    expect(await decodeSharePayload(await forgedLink(wirePayload(cards)))).toBeNull();
    expect(await decodeSharePayload(await forgedLink(wirePayload(cards.slice(1))))).not.toBeNull();
  });
});

describe('a payload of the wrong shape is refused or emptied, never a crash (finding 5)', () => {
  const refused: Array<[string, unknown]> = [
    ['not an object', 'a string'],
    ['a list', [1, 2, 3]],
    ['the wrong version', wirePayload([wireCard()], { v: 2 })],
    ['cards is not a list', wirePayload('nope' as unknown as unknown[])],
    ['a card that is null', wirePayload([null])],
    ['a card that is a number', wirePayload([7])],
    ['an unknown card type', wirePayload([wireCard({ type: 'wizard' })])],
    ['metrics is not a list', wirePayload([wireCard({ metrics: 'many' })])],
    ['a metric that is null', wirePayload([wireCard({ metrics: [null] })])],
    ['an unknown metric type', wirePayload([wireCard({ metrics: [{ t: 'vibes', v: 1, c: 'estimated' }] })])],
    ['an unknown confidence', wirePayload([wireCard({ metrics: [{ t: 'arr', v: 1, c: 'gold_standard' }] })])],
    ['claims is not a list', wirePayload([wireCard({ claims: 5 })])],
    ['a claim whose source is not text', wirePayload([wireCard({ claims: [{ text: 'A', t: null, u: { href: 'x' } }] })])],
    ['keyPoints holds non-text', wirePayload([wireCard({ keyPoints: [{ nested: true }] })])],
    ['a tier that is not a tier', wirePayload([wireCard({ tier: 99 })])],
    ['a company with no name', wirePayload([wireCard({ company: { oneLiner: 'x' } })])],
    ['no share time', wirePayload([wireCard()], { sharedAt: undefined })],
    ['a share time that is not a date', wirePayload([wireCard()], { sharedAt: 'whenever' })],
    ['an unknown kind', wirePayload([wireCard()], { kind: 'trojan' })],
    ['a briefing of the wrong shape', wirePayload([], { kind: 'briefing', briefing: { h: 1 } })],
    ['a report of the wrong shape', wirePayload([], { kind: 'report', report: { t: 'R', md: 5 } })],
    ['nothing to show', wirePayload([])],
  ];
  it.each(refused)('%s', async (_name, payload) => {
    expect(await decodeSharePayload(await forgedLink(payload))).toBeNull();
  });

  it('a card with its lists left out renders as empty lists instead of crashing', async () => {
    const bare = { type: 'company', company: { name: 'Acme', oneLiner: 'Makes things.' } };
    const opened = await open(wirePayload([bare]));
    expect(opened).not.toBeNull();
    const card = opened!.cards[0]!;
    expect([card.metrics, card.viceClaims, card.card.keyPoints, card.card.citations]).toEqual([[], [], [], []]);
    expect(card.company?.websiteUrl).toBeNull();
  });

  it('a figure whose value is not a finite, non-negative number is dropped, and its siblings are kept', async () => {
    const text = JSON.stringify(wirePayload([wireCard({
      metrics: [
        { t: 'arr', v: -5, c: 'estimated' },
        { t: 'users', v: '9T', c: 'estimated' },
        { t: 'employees', v: 'INFINITY', c: 'estimated' },
        { t: 'valuation', v: true, c: 'estimated' },
        { t: 'revenue', v: 12_000, c: 'estimated' },
        { t: 'market_cap', v: null, c: 'unknown' },
      ],
    })])).replace('"INFINITY"', '1e999');
    const decoded = (await decodeSharePayload(plainLink(text)))!;
    expect(decoded.cards[0]!.metrics.map((m) => m.t)).toEqual(['revenue', 'market_cap']);
    expect(sharedToCardWithCompany(decoded.cards[0]!, 0, decoded.sharedAt).metrics.map((m) => m.value)).toEqual([12_000, null]);
  });

  it('an unknown figure never carries a number, and extra fields on the wire are ignored', async () => {
    const opened = (await open(wirePayload([wireCard({ metrics: [{ t: 'arr', v: 77, c: 'unknown', surprise: { deep: 1 } }], onclick: 'alert(1)' })], { extra: 1 })))!;
    expect(opened.cards[0]!.metrics[0]!.value).toBeNull();
    expect(JSON.stringify(opened.payload)).not.toContain('onclick');
    expect(JSON.stringify(opened.payload)).not.toContain('surprise');
  });

  it('a real share still opens: figures, claims and dates survive untouched', async () => {
    const good = wirePayload([wireCard({
      metrics: [{ t: 'arr', v: 13_000_000_000, c: 'verified', s: { t: 'reuters.com', u: 'https://reuters.com/a' }, at: '2026-09-01' }],
      claims: [{ text: 'Reported turbulence.', t: 'theverge.com', u: 'https://theverge.com/x' }],
    })]);
    const opened = (await open(good))!;
    const metric = opened.cards[0]!.metrics[0]!;
    expect([metric.value, metric.confidence, metric.source, metric.capturedAt]).toEqual([13_000_000_000, 'verified', 'https://reuters.com/a', '2026-09-01T00:00:00.000Z']);
    expect(opened.cards[0]!.viceClaims).toHaveLength(1);
  });
});
