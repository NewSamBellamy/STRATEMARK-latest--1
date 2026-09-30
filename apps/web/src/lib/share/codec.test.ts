/**
 * Share codec — the whole snapshot travels inside the link.
 *
 * Round-trip fidelity is the contract: what the sender's deck said is exactly
 * what the recipient's preview says. A corrupted or truncated link must decode
 * to null (the friendly error page), never to garbage data.
 */
import { describe, expect, it } from 'vitest';
import type { CardWithCompany } from '@mi/contracts';
import {
  buildReportShare,
  buildCardShare,
  buildBriefingShare,
  buildDeckShare,
  decodeSharePayload,
  encodeSharePayload,
  sharedToCardWithCompany,
} from './codec';

const now = new Date().toISOString();

function liveCard(): CardWithCompany {
  return {
    card: {
      id: 'card_1',
      deckId: 'deck_1',
      companyId: 'cmp_1',
      cardType: 'company',
      title: null,
      summary: null,
      tier: 7,
      tierReason: 'strong signals',
      citations: [{ title: 'reuters.com', url: 'https://reuters.com/a' }],
      keyPoints: ['Ships frontier models', 'Consumer + API revenue mix'],
      createdAt: now,
    },
    company: {
      id: 'cmp_1',
      name: 'OpenAI',
      oneLiner: 'Frontier AI research and deployment company.',
      logoUrl: null,
      hqLocation: 'San Francisco, CA',
      websiteUrl: 'https://openai.com',
      brandTheme: null,
    },
    metrics: [
      {
        id: 'met_1',
        companyId: 'cmp_1',
        metricType: 'arr',
        value: 13_000_000_000,
        confidence: 'verified',
        source: 'https://reuters.com/a',
        citations: [{ title: 'reuters.com', url: 'https://reuters.com/a' }],
        methodNote: 'Reuters, Aug 2026',
        capturedAt: now,
      },
      {
        id: 'met_2',
        companyId: 'cmp_1',
        metricType: 'employees',
        value: null,
        confidence: 'unknown',
        source: null,
        citations: [],
        methodNote: null,
        capturedAt: now,
      },
      {
        id: 'met_3',
        companyId: 'cmp_1',
        metricType: 'users',
        value: 12_000,
        confidence: 'verified',
        source: 'https://github.com/openai',
        citations: [{ title: 'GitHub', url: 'https://github.com/openai' }],
        methodNote: 'Repository stars',
        userBasis: 'github_stars',
        capturedAt: now,
      },
    ],
    viceClaims: [
      {
        id: 'v1',
        cardId: 'card_1',
        claimText: 'Reported governance turbulence in 2023.',
        sourceUrl: 'https://theverge.com/x',
        sourceTitle: 'theverge.com',
        capturedAt: now,
      },
    ],
  } as CardWithCompany;
}

function rawJsonShare(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `j${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

async function compressedJsonShare(value: unknown): Promise<string> {
  const compressor = new CompressionStream('deflate-raw');
  const compressedPromise = new Response(compressor.readable).arrayBuffer();
  const writer = compressor.writable.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify(value)));
  await writer.close();
  const compressed = new Uint8Array(await compressedPromise);
  let binary = '';
  for (const byte of compressed) binary += String.fromCharCode(byte);
  return `z${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

describe('share codec round-trip', () => {
  it('a shared card decodes to exactly what was shared', async () => {
    const payload = buildCardShare(liveCard(), 'Frontier AI');
    const blob = await encodeSharePayload(payload);
    // URL-safe: no characters that need escaping in a hash route.
    expect(blob).toMatch(/^[zj][A-Za-z0-9_-]+$/);

    const decoded = await decodeSharePayload(blob);
    expect(decoded).not.toBeNull();
    expect(decoded!.kind).toBe('card');
    expect(decoded!.market).toBe('Frontier AI');
    const sc = decoded!.cards[0]!;
    expect(sc.company?.name).toBe('OpenAI');
    expect(sc.metrics.find((m) => m.t === 'arr')?.v).toBe(13_000_000_000);
    expect(sc.metrics.find((m) => m.t === 'arr')?.c).toBe('verified');
    expect(sc.metrics.find((m) => m.t === 'users')?.b).toBe('github_stars');
    expect(sc.claims[0]?.text).toContain('governance');

    // …and inflates back into the shape the card components render.
    const cwc = sharedToCardWithCompany(sc, 0, decoded!.sharedAt);
    expect(cwc.company?.name).toBe('OpenAI');
    expect(cwc.card.tier).toBe(7);
    expect(cwc.metrics.find((m) => m.metricType === 'arr')?.confidence).toBe('verified');
    expect(cwc.metrics.find((m) => m.metricType === 'users')?.userBasis).toBe('github_stars');
    expect(cwc.viceClaims[0]?.sourceUrl).toBe('https://theverge.com/x');
  });

  it('round-trips claim-specific citations and reported periods for market findings', async () => {
    const finding = {
      ...liveCard(),
      company: null,
      card: {
        ...liveCard().card,
        cardType: 'insight' as const,
        companyId: null,
        title: 'Inference pricing shift',
        evidencePoints: [
          {
            text: 'Hosted inference prices fell during the second quarter.',
            timeWindow: 'Q2 2026',
            citations: [{ title: 'provider.example', url: 'https://provider.example/pricing' }],
          },
        ],
      },
    } as CardWithCompany;
    const decoded = await decodeSharePayload(
      await encodeSharePayload(buildCardShare(finding, 'Frontier AI')),
    );

    expect(decoded?.cards[0]?.evidencePoints).toEqual([
      {
        text: 'Hosted inference prices fell during the second quarter.',
        timeWindow: 'Q2 2026',
        citations: [{ t: 'provider.example', u: 'https://provider.example/pricing' }],
      },
    ]);
    expect(decoded?.cards[0]?.keyPoints).toEqual([]);
    const inflated = sharedToCardWithCompany(decoded!.cards[0]!, 0, decoded!.sharedAt);
    expect(inflated.card.evidencePoints?.[0]).toMatchObject({
      text: 'Hosted inference prices fell during the second quarter.',
      timeWindow: 'Q2 2026',
      citations: [{ title: 'provider.example', url: 'https://provider.example/pricing' }],
    });
  });

  it('a 10-company deck stays link-sized (compressed)', async () => {
    const cards = Array.from({ length: 10 }, () => liveCard());
    const blob = await encodeSharePayload(buildDeckShare(cards, 'Frontier AI'));
    const decoded = await decodeSharePayload(blob);
    expect(decoded!.cards).toHaveLength(10);
    // Repetitive JSON compresses hard; a real mixed deck lands well under
    // practical URL limits. This guards against a regression that stops
    // compressing (raw JSON here would be ~8KB+).
    expect(blob.length).toBeLessThan(4_000);
  });

  it('a Daily Briefing round-trips: report payload + cards intact', async () => {
    const briefing = {
      marketName: 'Frontier AI',
      generatedAt: '2026-08-26T14:00:00.000Z',
      windowHours: 24,
      headline: 'Capital and capability both moved today',
      insights: ['Funding is consolidating around two poles.'],
      updates: [
        {
          companyName: 'OpenAI',
          signal: 'high' as const,
          oneLiner: 'OpenAI raised $10B at a $500B valuation.',
          detail: 'The round tightens the compute arms race.',
          publishedDate: '2026-08-26',
          citations: [{ title: 'Reuters', url: 'https://reuters.com/x' }],
        },
        {
          companyName: 'Anthropic',
          signal: 'notable' as const,
          oneLiner: 'Anthropic shipped a new agentic surface.',
          detail: 'Broadens the developer wedge.',
          publishedDate: null,
          citations: [],
        },
      ],
    };
    const blob = await encodeSharePayload(buildBriefingShare(briefing, [liveCard()]));
    const decoded = await decodeSharePayload(blob);
    expect(decoded?.kind).toBe('briefing');
    expect(decoded?.briefing?.h).toBe('Capital and capability both moved today');
    expect(decoded?.briefing?.u).toHaveLength(2);
    expect(decoded?.briefing?.u[0]?.s).toBe('h');
    expect(decoded?.briefing?.u[0]?.c[0]?.u).toBe('https://reuters.com/x');
    expect(decoded?.briefing?.i).toHaveLength(1);
    expect(decoded?.cards).toHaveLength(1); // the evidence rides along
  });

  it('a report share round-trips with the full markdown and stands alone (no cards)', async () => {
    const md = `## Executive summary\n\n${'Sourced paragraph. '.repeat(120)}\n\n- point one\n- point two`;
    const blob = await encodeSharePayload(
      buildReportShare(
        {
          title: 'OpenAI — Company Report',
          kind: 'company',
          markdown: md,
          citations: [{ title: 'Reuters', url: 'https://reuters.com/openai' }],
          createdAt: '2026-08-26T12:00:00.000Z',
        },
        'Frontier AI Model Developers',
      ),
    );
    const decoded = await decodeSharePayload(blob);
    expect(decoded?.kind).toBe('report');
    expect(decoded?.report?.t).toBe('OpenAI — Company Report');
    expect(decoded?.report?.md).toBe(md);
    expect(decoded?.report?.c[0]?.u).toBe('https://reuters.com/openai');
    expect(decoded?.cards).toHaveLength(0); // a report can stand alone
  });

  it('old deck links (no briefing field) still decode', async () => {
    const blob = await encodeSharePayload(buildDeckShare([liveCard()], 'Frontier AI'));
    const decoded = await decodeSharePayload(blob);
    expect(decoded?.kind).toBe('deck');
    expect(decoded?.briefing).toBeUndefined();
  });

  it('truncated and tampered links decode to null, never garbage', async () => {
    const blob = await encodeSharePayload(buildCardShare(liveCard(), null));
    expect(await decodeSharePayload(blob.slice(0, Math.floor(blob.length / 2)))).toBeNull();
    expect(await decodeSharePayload(`x${blob.slice(1)}`)).toBeNull();
    expect(await decodeSharePayload('')).toBeNull();
    expect(await decodeSharePayload('jnot-base64!!!')).toBeNull();
  });

  it('rejects malformed claim evidence and non-web citation URLs at the share boundary', async () => {
    const base = buildCardShare(
      {
        ...liveCard(),
        company: null,
        card: {
          ...liveCard().card,
          cardType: 'insight',
          companyId: null,
          evidencePoints: [
            {
              text: 'A market detail.',
              timeWindow: null,
              citations: [{ title: 'Example', url: 'https://example.com/source' }],
            },
          ],
        },
      } as CardWithCompany,
      'Frontier AI',
    );
    const unsafeUrl = structuredClone(base);
    unsafeUrl.cards[0]!.evidencePoints![0]!.citations[0]!.u = 'javascript:alert(1)';
    const malformed = structuredClone(base);
    malformed.cards[0]!.evidencePoints = [{ text: 'No citation', timeWindow: null, citations: [] }];

    expect(await decodeSharePayload(rawJsonShare(unsafeUrl))).toBeNull();
    expect(await decodeSharePayload(rawJsonShare(malformed))).toBeNull();
  });

  it('rejects shares beyond the encoded-link size limit', async () => {
    const cardPayload = buildCardShare(liveCard(), null);
    const oversized = {
      ...cardPayload,
      kind: 'deck' as const,
      cards: Array.from({ length: 100 }, () => ({
        ...cardPayload.cards[0]!,
        summary: 'x'.repeat(5000),
      })),
    };
    await expect(encodeSharePayload(oversized)).rejects.toThrow(/too large to package/i);
    expect(await decodeSharePayload(`j${'A'.repeat(60_001)}`)).toBeNull();
  });

  it.skipIf(typeof CompressionStream === 'undefined')(
    'rejects a small compressed link that expands beyond the decoded-size limit',
    async () => {
      const base = buildCardShare(liveCard(), 'Frontier AI');
      const expanded = {
        ...base,
        kind: 'deck' as const,
        cards: Array.from({ length: 100 }, () => ({
          ...base.cards[0]!,
          summary: 'x'.repeat(5000),
        })),
      };
      const blob = await compressedJsonShare(expanded);

      expect(blob.length).toBeLessThan(60_000);
      expect(await decodeSharePayload(blob)).toBeNull();
    },
  );
});
