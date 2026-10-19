/**
 * Share codec — the whole snapshot travels inside the link.
 *
 * Round-trip fidelity is the contract: what the sender's deck said is exactly
 * what the recipient's preview says. A corrupted or truncated link must decode
 * to null (the friendly error page), never to garbage data.
 */
import { describe, expect, it } from 'vitest';
import type { CardWithCompany } from '@mi/contracts';
import { buildCardView } from '@/features/card/card-view';
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
    expect(sc.claims[0]?.text).toContain('governance');

    // …and inflates back into the shape the card components render.
    const cwc = sharedToCardWithCompany(sc, 0, decoded!.sharedAt);
    expect(cwc.company?.name).toBe('OpenAI');
    expect(cwc.card.tier).toBe(7);
    expect(cwc.metrics.find((m) => m.metricType === 'arr')?.confidence).toBe('verified');
    expect(cwc.viceClaims[0]?.sourceUrl).toBe('https://theverge.com/x');
  });

  it('a source-reported figure still shows on the card face after sharing (the face re-checks its proof)', async () => {
    // A search-reported figure sits on the face only while the sentence that supports it is on the row. A share that
    // dropped the sentence showed "Not found yet" for every figure the app itself showed.
    const live = liveCard();
    live.company = { ...live.company!, name: 'HelloFresh', websiteUrl: 'https://www.hellofresh.com' };
    const citation = { title: 'sec.gov', url: 'https://www.sec.gov/hf' };
    live.metrics = [{
      id: 'met_r', companyId: 'cmp_1', metricType: 'employees', value: 18_000, confidence: 'estimated', source: citation.url,
      citations: [citation], methodNote: 'Reported by Google Search', capturedAt: '2026-09-01T10:00:00.000Z',
      reportedSupport: { provider: 'google-search', companyName: 'HelloFresh', basis: 'employees', value: 18_000, unit: 'count',
        asOf: '2026-03-01', definition: 'employees',
        support: { supportIndex: 3, text: 'HelloFresh employed about 18,000 people as of March 2026.', startIndex: 10, endIndex: 70,
          sources: [{ chunkIndex: 1, url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/' + 'A'.repeat(200), title: 'sec.gov' }] } },
    } as CardWithCompany['metrics'][number]];
    const onFace = (cwc: CardWithCompany) => buildCardView(cwc).faceMetrics.filter((f) => f.metric?.value != null).map((f) => f.display);
    expect(onFace(live)).toEqual(['18K']);

    const decoded = (await decodeSharePayload(await encodeSharePayload(buildCardShare(live, 'Meal kits'))))!;
    const shared = sharedToCardWithCompany(decoded.cards[0]!, 0, decoded.sharedAt);
    expect(onFace(shared)).toEqual(['18K']);
    // The long provider redirect is not carried, and the capture date is, so "over a month old" stays true.
    expect(JSON.stringify(decoded)).not.toContain('grounding-api-redirect/AAAA');
    expect(shared.metrics[0]!.capturedAt.slice(0, 10)).toBe('2026-09-01');
    // The proof must still be the company's: a share cannot make another company's sentence count.
    const tampered = structuredClone(decoded.cards[0]!);
    tampered.metrics[0]!.rs!.n = 'Someone Else';
    expect(onFace(sharedToCardWithCompany(tampered, 0, decoded.sharedAt))).toEqual([]);
  });

  it('a headcount band and an ownership line survive a share', async () => {
    const live = liveCard();
    live.company = { ...live.company!, name: 'Gobble', websiteUrl: 'https://www.gobble.com',
      ownership: { status: 'acquisition_pending', acquirer: 'Forbes Intelligent Foods', closedOn: null, price: null, confidence: 'verified',
        citations: [{ title: 'reuters.com', url: 'https://reuters.com/gobble' }, { title: 'x.com', url: 'https://x.com/y' }], methodNote: 'long note' } } as CardWithCompany['company'];
    const decoded = (await decodeSharePayload(await encodeSharePayload(buildCardShare(live, null))))!;
    const shared = sharedToCardWithCompany(decoded.cards[0]!, 0, decoded.sharedAt);
    expect(buildCardView(shared).ownershipLabel ?? shared.company?.ownership?.acquirer).toContain('Forbes Intelligent Foods');
    expect(shared.company?.ownership?.citations).toHaveLength(1);
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

  it('a Daily Briefing round-trips: unboxing payload + cards intact', async () => {
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
});
