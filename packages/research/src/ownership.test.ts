import { describe, expect, it } from 'vitest';
import { enforceMetricProvenance, type CompanyMetric, type Ownership } from '@mi/contracts';
import {
  acquisitionStatements, dateInSentence, dealPriceInSentence, decideOwnership, findOwnership, gleifOwnership, metricOwnershipEvidence,
  preferOwnership, wikidataParentClaims, type OwnershipEvidenceText,
} from './ownership';
import type { OriginalSourceReceipt } from './original-source';
import type { WebSearchResult } from './web-search';

// Fixtures only: no network. Text is paraphrased deal reporting, not live pages.
const POPPI_SITE = 'https://drinkpoppi.com';
const ANYSPHERE_SITE = 'https://anysphere.inc';
const NOW = Date.parse('2026-10-13T00:00:00.000Z');

const poppiAnnounced: OwnershipEvidenceText = {
  url: 'https://www.cnbc.com/2025/03/17/pepsico-to-buy-poppi.html', title: 'CNBC',
  text: 'Beverage giant PepsiCo said Monday it has agreed to acquire prebiotic soda brand Poppi for $1.95 billion. The deal includes $300 million of anticipated cash tax benefits.',
  date: '2025-03-17',
};
const poppiClosedRelease = 'PURCHASE, N.Y., May 27, 2025 -- PepsiCo, Inc. (Nasdaq: PEP) today announced that it has completed its acquisition of poppi, the modern soda brand. The brand will continue to be led by its co-founders.';

const anysphereNews: OwnershipEvidenceText = {
  url: 'https://www.reuters.com/technology/spacex-anysphere-2026-06-10/', title: 'Reuters',
  text: 'SpaceX has agreed to acquire Cursor maker Anysphere for $60 billion, the companies said on June 10, 2026. Anysphere was valued at $29.3 billion in its last funding round.',
};

const receipt = (url: string, text: string): OriginalSourceReceipt => ({ requestedUrl: url, finalUrl: url, status: 'retrieved', retrievedAt: '2026-10-13T00:00:00.000Z', text });

describe('deal statements', () => {
  it('reads an announced deal with buyer, price and date', () => {
    const [s] = acquisitionStatements('Poppi', poppiAnnounced, { website: POPPI_SITE });
    expect(s).toMatchObject({ phase: 'announced', acquirer: 'PepsiCo', price: { value: 1.95e9, currency: 'USD' }, date: '2025-03-17', primary: false });
  });

  it('reads a press-release close and attributes "it" to the subject', () => {
    const [s] = acquisitionStatements('Poppi', { url: 'https://www.pepsico.com/newsroom/press-releases/2025/poppi', title: 'PepsiCo', text: poppiClosedRelease }, { website: POPPI_SITE });
    expect(s).toMatchObject({ phase: 'completed', acquirer: 'PepsiCo', date: '2025-05-27', primary: true });
  });

  it('reads the passive construction', () => {
    const [s] = acquisitionStatements('Anysphere', { url: 'https://example.com/a', title: 'x', text: 'Cursor maker Anysphere agreed to be acquired by SpaceX in a deal valued at $60 billion.' }, { website: ANYSPHERE_SITE });
    expect(s).toMatchObject({ phase: 'announced', acquirer: 'SpaceX', price: { value: 6e10 } });
  });

  it('ignores hedged reporting, the company buying others, and other companies', () => {
    const hedged = 'SpaceX is reportedly in talks to acquire Anysphere for $60 billion, people familiar said.';
    const buyer = 'Anysphere acquired code-review startup Graphite in December 2025.';
    const other = 'SpaceX has agreed to acquire xAI.';
    for (const text of [hedged, buyer, other, 'SpaceX could buy Anysphere.']) {
      expect(acquisitionStatements('Anysphere', { url: 'https://example.com', title: 'x', text }, { website: ANYSPHERE_SITE })).toEqual([]);
    }
  });

  it('marks a terminated deal', () => {
    const [s] = acquisitionStatements('Figma', { url: 'https://example.com', title: 'x', text: 'Adobe and Figma said the proposed acquisition was terminated in December 2023.' }, { website: 'https://figma.com' });
    expect(s?.phase).toBe('terminated');
  });

  it('dates sentences at the precision they state', () => {
    expect(dateInSentence('Closed on May 27, 2025.')).toBe('2025-05-27');
    expect(dateInSentence('Closed in May 2025.')).toBe('2025-05');
    expect(dateInSentence('Closed in 2025.')).toBe('2025');
    expect(dateInSentence('No date here.')).toBeNull();
  });
});

describe('decideOwnership', () => {
  it('Poppi → acquired by PepsiCo, closing stated by the primary press release', () => {
    const statements = [
      ...acquisitionStatements('Poppi', poppiAnnounced, { website: POPPI_SITE }),
      ...acquisitionStatements('Poppi', { url: 'https://www.pepsico.com/newsroom/press-releases/2025/poppi', title: 'PepsiCo', text: poppiClosedRelease }, { website: POPPI_SITE }),
    ];
    const o = decideOwnership({ statements, registry: [], checkedAt: '2026-10-13T00:00:00.000Z' });
    expect(o).toMatchObject({ status: 'acquired', acquirer: 'PepsiCo', announcedOn: '2025-03-17', closedOn: '2025-05-27',
      price: { value: 1.95e9, currency: 'USD' }, confidence: 'verified' });
    expect(o!.citations.map((c) => c.url)).toContain('https://www.pepsico.com/newsroom/press-releases/2025/poppi');
  });

  it('Anysphere → acquisition by SpaceX pending: one non-primary "closed" report is not a close', () => {
    const statements = [
      ...acquisitionStatements('Anysphere', anysphereNews, { website: ANYSPHERE_SITE }),
      ...acquisitionStatements('Anysphere', { url: 'https://blog.example.net/x', title: 'blog', text: 'SpaceX completed its acquisition of Anysphere last week.' }, { website: ANYSPHERE_SITE }),
    ];
    const o = decideOwnership({ statements, registry: [] });
    expect(o).toMatchObject({ status: 'acquisition_pending', acquirer: 'SpaceX', announcedOn: '2026-06-10', closedOn: null,
      price: { value: 6e10, currency: 'USD' }, confidence: 'estimated' });
  });

  it('two independent non-primary sources saying it closed: acquired, estimated', () => {
    const closed = (url: string) => acquisitionStatements('Anysphere', { url, title: 'x', text: 'SpaceX completed its acquisition of Anysphere on September 1, 2026.' }, { website: ANYSPHERE_SITE });
    const o = decideOwnership({ statements: [...closed('https://a.example.com/1'), ...closed('https://b.example.org/2')], registry: [] });
    expect(o).toMatchObject({ status: 'acquired', confidence: 'estimated', closedOn: '2026-09-01' });
  });

  it('a reported termination with no proven close means no status', () => {
    const statements = acquisitionStatements('Figma', { url: 'https://example.com', title: 'x',
      text: 'Adobe agreed to acquire Figma for $20 billion in September 2022. Adobe and Figma said the acquisition was terminated in December 2023.' }, { website: 'https://figma.com' });
    expect(decideOwnership({ statements, registry: [] })).toBeNull();
  });

  it('independent company: GLEIF records no consolidating parent', () => {
    const o = decideOwnership({ statements: [], registry: [{ registry: 'gleif', kind: 'independent', citation: { url: 'https://search.gleif.org/#/record/X', title: 'GLEIF' } }] });
    expect(o).toMatchObject({ status: 'independent', confidence: 'verified' });
    expect(o!.acquirer).toBeUndefined();
  });

  it('no evidence is no status, never "independent" by absence', () => {
    expect(decideOwnership({ statements: [], registry: [] })).toBeNull();
  });

  it('a Wikidata parent alone is a subsidiary at most estimated', () => {
    const o = decideOwnership({ statements: [], registry: [{ registry: 'wikidata', kind: 'parent', parent: 'Alphabet Inc.', citation: { url: 'https://www.wikidata.org/wiki/Q1', title: 'Wikidata' } }] });
    expect(o).toMatchObject({ status: 'subsidiary', acquirer: 'Alphabet Inc.', confidence: 'estimated' });
  });
});

describe('price and announcement-date integrity (live Poppi regression)', () => {
  // Paraphrase of a payout-cut news item dated after the deal: its figures are
  // a payout and a distractor, never the purchase price, and its page date is
  // not the announcement date.
  const payoutArticle: OwnershipEvidenceText = {
    url: 'https://www.ad-hoc-news.de/boerse/news/pepsico-cuts-poppi-payout-to-usd-12-million', title: 'ad-hoc-news',
    text: 'PepsiCo agreed to acquire Poppi and has now cut the founders\' payout to $12 million from $40 million after a class-action settlement. ' +
      'PepsiCo agreed to buy Poppi, which had about $40 million in revenue, in a deal that closes later.',
    date: '2025-05-19',
  };

  it('dealPriceInSentence binds only a figure tied to the purchase', () => {
    expect(dealPriceInSentence('PepsiCo agreed to acquire Poppi for $1.95 billion.')).toEqual({ value: 1.95e9, currency: 'USD' });
    expect(dealPriceInSentence('PepsiCo will buy Poppi in a deal valued at approximately $1.95 billion.')).toEqual({ value: 1.95e9, currency: 'USD' });
    expect(dealPriceInSentence('SpaceX will acquire Anysphere at a purchase price of $60 billion.')).toEqual({ value: 6e10, currency: 'USD' });
    expect(dealPriceInSentence('PepsiCo cut the payout for the Poppi acquisition to $12 million from $40 million.')).toBeNull();
    expect(dealPriceInSentence('PepsiCo agreed to buy Poppi, which had $40 million in revenue.')).toBeNull();
    expect(dealPriceInSentence('Poppi raised $40 million before the acquisition.')).toBeNull();
    expect(dealPriceInSentence('The deal includes $300 million of anticipated cash tax benefits.')).toBeNull();
    expect(dealPriceInSentence('PepsiCo will acquire Poppi.')).toBeNull();
  });

  it('a payout article yields no price and no announcement date', () => {
    const statements = acquisitionStatements('Poppi', payoutArticle, { website: POPPI_SITE });
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) {
      expect(s.price).toBeNull();
      expect(s.date).not.toBe('2025-05-19');
    }
  });

  it('with the payout article alongside, the grounded announcement keeps its price and date', () => {
    const statements = [
      ...acquisitionStatements('Poppi', poppiAnnounced, { website: POPPI_SITE }),
      ...acquisitionStatements('Poppi', payoutArticle, { website: POPPI_SITE }),
      ...acquisitionStatements('Poppi', { url: 'https://www.pepsico.com/newsroom/press-releases/2025/poppi', title: 'PepsiCo', text: poppiClosedRelease }, { website: POPPI_SITE }),
    ];
    const o = decideOwnership({ statements, registry: [] });
    expect(o).toMatchObject({ status: 'acquired', announcedOn: '2025-03-17', closedOn: '2025-05-27', price: { value: 1.95e9, currency: 'USD' } });
  });

  it('two disagreeing non-primary prices: price null', () => {
    const one = (url: string, amount: string) => acquisitionStatements('Anysphere', { url, title: 'x',
      text: `SpaceX has agreed to acquire Anysphere for ${amount}.` }, { website: ANYSPHERE_SITE });
    const o = decideOwnership({ statements: [...one('https://a.example.com/1', '$60 billion'), ...one('https://b.example.org/2', '$40 million')], registry: [] });
    expect(o?.price).toBeNull();
  });

  it('completion-only evidence: announcedOn is null, never the completion article date', () => {
    const completion: OwnershipEvidenceText = {
      url: 'https://finance.yahoo.com/news/pepsico-completes-acquisition-poppi.html', title: 'Yahoo Finance',
      text: 'PepsiCo has completed its acquisition of Poppi. PepsiCo agreed to buy Poppi in March, and the deal closed this week.',
      date: '2025-05-27',
    };
    const statements = acquisitionStatements('Poppi', completion, { website: POPPI_SITE });
    expect(statements.filter((s) => s.phase === 'announced').every((s) => s.date !== '2025-05-27')).toBe(true);
    const closes = (url: string) => acquisitionStatements('Poppi', { ...completion, url }, { website: POPPI_SITE });
    const o = decideOwnership({ statements: [...closes('https://a.example.com/1'), ...closes('https://b.example.org/2')], registry: [] });
    expect(o).toMatchObject({ status: 'acquired', announcedOn: null, closedOn: '2025-05-27' });
  });
});

describe('acquisition-price valuation evidence routes to ownership.price', () => {
  it('the rejected valuation row still yields the deal statement and its price', () => {
    const row: CompanyMetric = {
      id: 'm', companyId: 'cmp_poppi', metricType: 'valuation', value: 1.95e9, confidence: 'estimated', source: null,
      citations: [{ url: poppiAnnounced.url, title: 'CNBC' }], methodNote: null, capturedAt: '2026-10-01T00:00:00.000Z',
      quotedSupport: { sourceUrl: poppiAnnounced.url, quote: 'PepsiCo has agreed to acquire Poppi for $1.95 billion.', asOf: '2025-03-17', value: 1.95e9, unit: 'USD' },
    };
    const gated = enforceMetricProvenance(row);
    expect(gated).toMatchObject({ value: null, confidence: 'unknown' });
    const statements = metricOwnershipEvidence([gated]).flatMap((t) => acquisitionStatements('Poppi', t, { website: POPPI_SITE }));
    expect(statements[0]).toMatchObject({ acquirer: 'PepsiCo', price: { value: 1.95e9 }, date: '2025-03-17' });
  });
});

describe('registries', () => {
  it('Wikidata: a sole controlling parent only; investors listed as owners are not a parent', () => {
    const q = (id: string) => ({ mainsnak: { datavalue: { value: { id } } } });
    expect(wikidataParentClaims({ claims: { P749: [q('Q1')] } })).toEqual([{ qid: 'Q1', since: null, prop: 'P749' }]);
    expect(wikidataParentClaims({ claims: { P127: [q('Q1'), q('Q2')] } })).toEqual([]);
    expect(wikidataParentClaims({ claims: { P127: [{ ...q('Q1'), qualifiers: { P1107: [{ datavalue: { value: { amount: '+0.2' } } }] } }] } })).toEqual([]);
    expect(wikidataParentClaims({ claims: { P749: [{ ...q('Q1'), qualifiers: { P582: [{}] } }] } })).toEqual([]);
  });

  it('GLEIF: a direct parent, or an explicit no-parent exception', async () => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const parentFetch = (async () => json({ data: { attributes: { entity: { legalName: { name: 'PepsiCo, Inc.' } } } } })) as unknown as typeof fetch;
    expect(await gleifOwnership('2549002XU214QREIP986', parentFetch)).toMatchObject({ kind: 'parent', parent: 'PepsiCo, Inc.' });
    const noParent = (async (url: string) => String(url).endsWith('/direct-parent') ? new Response('<html>', { status: 404 })
      : json({ data: { attributes: { reason: 'NON_CONSOLIDATING' } } })) as unknown as typeof fetch;
    expect(await gleifOwnership('FJSUNZKFNQ5YPJ5OT455', noParent)).toMatchObject({ kind: 'independent' });
    expect(await gleifOwnership('not-an-lei', noParent)).toBeNull();
  });
});

describe('findOwnership (fixtures, no network)', () => {
  it('Poppi: grounded text announces, the acquirer press release found via news closes it', async () => {
    const releaseUrl = 'https://www.pepsico.com/newsroom/press-releases/2025/pepsico-completes-acquisition-of-poppi';
    const news = async (): Promise<WebSearchResult[]> => [
      { url: releaseUrl, title: 'PepsiCo completes acquisition of poppi', snippet: 'PepsiCo completed its acquisition of poppi.', publisher: 'PepsiCo' },
      { url: 'https://example.com/unrelated', title: 'Soda sales', snippet: 'Soda market grows.' },
    ];
    const read = async (url: string) => url === releaseUrl ? receipt(url, poppiClosedRelease) : receipt(url, '');
    const found = await findOwnership({ companyId: 'cmp_poppi', companyName: 'Poppi', websiteUrl: POPPI_SITE, texts: [poppiAnnounced] },
      { read, newsSearch: news, nowMs: NOW });
    expect(found.ownership).toMatchObject({ status: 'acquired', acquirer: 'PepsiCo', closedOn: '2025-05-27', confidence: 'verified' });
    expect(found.receipts.map((r) => r.finalUrl)).toEqual([releaseUrl]);
  });

  it('Anysphere: an announced deal with no close stays pending, and a failing lane is only missing evidence', async () => {
    const read = async (): Promise<OriginalSourceReceipt> => { throw new Error('offline'); };
    const fetchImpl = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const found = await findOwnership({ companyId: 'cmp_any', companyName: 'Anysphere', websiteUrl: ANYSPHERE_SITE, texts: [anysphereNews] },
      { read, fetchImpl, newsSearch: async () => { throw new Error('offline'); }, nowMs: NOW });
    expect(found.ownership).toMatchObject({ status: 'acquisition_pending', acquirer: 'SpaceX' });
  });

  it('independent company: domain-matched Wikidata item, LEI, GLEIF no-parent exception', async () => {
    const lei = 'ABCDEFGHIJKLMNOPQRST';
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    const fetchImpl = (async (input: string) => {
      const url = String(input);
      if (url.includes('wbsearchentities')) return json({ search: [{ id: 'Q10' }, { id: 'Q11' }] });
      if (url.includes('wbgetentities')) return json({ entities: {
        Q10: { claims: { P856: [{ mainsnak: { datavalue: { value: 'https://www.acme-robotics.com/' } } }], P1278: [{ mainsnak: { datavalue: { value: lei } } }] } },
        Q11: { claims: { P856: [{ mainsnak: { datavalue: { value: 'https://acme.org' } } }] } },
      } });
      if (url.endsWith('/direct-parent')) return new Response('<html>', { status: 404 });
      if (url.endsWith('/direct-parent-reporting-exception')) return json({ data: { attributes: { reason: 'NATURAL_PERSONS' } } });
      return new Response('', { status: 500 });
    }) as unknown as typeof fetch;
    const found = await findOwnership({ companyId: 'cmp_acme', companyName: 'Acme Robotics', websiteUrl: 'https://acme-robotics.com', texts: [] },
      { fetchImpl, nowMs: NOW });
    expect(found.ownership).toMatchObject({ status: 'independent', confidence: 'verified' });
    expect(found.ownership!.citations[0]!.url).toBe(`https://search.gleif.org/#/record/${lei}`);
  });
});

describe('announcement date, close date and price from news phrasing (Poppi/PepsiCo pattern)', () => {
  // Synthetic sentences in the style of deal reporting; no network.
  const site = { website: POPPI_SITE };
  const src = (url: string, text: string, date: string | null = null): OwnershipEvidenceText => ({ url, title: 'x', text, date });

  it('a later article merely naming the deal does not date the announcement', () => {
    const later = src('https://news.example.com/poppi-shelves', 'PepsiCo\'s acquisition of Poppi gives it a foothold in prebiotic soda.', '2025-05-19');
    const [s] = acquisitionStatements('Poppi', later, site);
    expect(s).toMatchObject({ phase: 'announced', announcedExplicitly: false });
    const closes = (url: string) => acquisitionStatements('Poppi', src(url, 'PepsiCo completed its acquisition of Poppi in May 2025.'), site);
    const o = decideOwnership({ statements: [s!, ...closes('https://a.example.com/1'), ...closes('https://b.example.org/2')], registry: [] });
    expect(o).toMatchObject({ status: 'acquired', announcedOn: null, closedOn: '2025-05' });
  });

  it('"said it will acquire" is the announcement; its page date dates it', () => {
    const [s] = acquisitionStatements('Poppi', src('https://news.example.com/a', 'PepsiCo on Monday said it will acquire prebiotic soda brand Poppi for $1.95 billion.', '2025-03-17'), site);
    expect(s).toMatchObject({ phase: 'announced', announcedExplicitly: true, date: '2025-03-17', price: { value: 1.95e9 } });
  });

  it('one sentence stating both phases dates each phase by its own wording', () => {
    const text = 'PepsiCo has completed its acquisition of Poppi on May 27, 2025, after it announced the deal on March 17, 2025.';
    const [s] = acquisitionStatements('Poppi', src('https://news.example.com/b', text, '2025-05-28'), site);
    expect(s).toMatchObject({ phase: 'completed', date: '2025-05-27' });
    const recalledOnly = 'PepsiCo has completed its acquisition of Poppi, a deal it first announced on March 17, 2025.';
    const [r] = acquisitionStatements('Poppi', src('https://news.example.com/c', recalledOnly, '2025-05-28'), site);
    // The only date is the announcement's: the close is not dated by it, nor by the page.
    expect(r).toMatchObject({ phase: 'completed', date: null });
  });

  it('prices: "in a deal valued at", "for", and the follow-on "The deal is valued at" sentence', () => {
    const one = (text: string) => acquisitionStatements('Poppi', src('https://news.example.com/d', text, '2025-03-17'), site)[0];
    expect(one('PepsiCo agreed to acquire Poppi in a deal valued at $1.95 billion.')?.price).toEqual({ value: 1.95e9, currency: 'USD' });
    expect(one('PepsiCo has agreed to buy Poppi for $1.95 billion.')?.price).toEqual({ value: 1.95e9, currency: 'USD' });
    expect(one('PepsiCo has agreed to buy Poppi in a transaction worth $1.95bn.')?.price).toEqual({ value: 1.95e9, currency: 'USD' });
    expect(one('PepsiCo has agreed to acquire Poppi. The deal is valued at $1.95 billion, including tax benefits.')?.price).toEqual({ value: 1.95e9, currency: 'USD' });
    // A follow-on sentence that is not about the deal, or a tax figure, binds nothing.
    expect(one('PepsiCo has agreed to acquire Poppi. Poppi raised $40 million last year.')?.price).toBeNull();
    expect(one('PepsiCo has agreed to acquire Poppi. The deal includes $300 million of anticipated cash tax benefits.')?.price).toBeNull();
  });

  it('a hedged "nearly $2 billion" never becomes the price but does not block the exact one', () => {
    const exact = acquisitionStatements('Poppi', src('https://a.example.com/1', 'PepsiCo agreed to acquire Poppi for $1.95 billion.', '2025-03-17'), site);
    const hedged = acquisitionStatements('Poppi', src('https://b.example.org/2', 'PepsiCo agreed to buy Poppi for nearly $2 billion.', '2025-03-18'), site);
    expect(hedged[0]).toMatchObject({ priceApproximate: true });
    expect(decideOwnership({ statements: [...exact, ...hedged], registry: [] })?.price).toEqual({ value: 1.95e9, currency: 'USD' });
    expect(decideOwnership({ statements: hedged, registry: [] })?.price).toBeNull();
    const contradicting = acquisitionStatements('Poppi', src('https://c.example.net/3', 'PepsiCo agreed to buy Poppi for about $3 billion.'), site);
    expect(decideOwnership({ statements: [...exact, ...contradicting], registry: [] })?.price).toBeNull();
  });

  it('the full Poppi set: announced 2025-03-17, closed 2025-05-27, price $1.95B', () => {
    const statements = [
      ...acquisitionStatements('Poppi', src('https://news.example.com/later', 'PepsiCo\'s acquisition of Poppi gives it a foothold in prebiotic soda.', '2025-05-19'), site),
      ...acquisitionStatements('Poppi', src('https://news.example.com/a', 'PepsiCo said Monday it has agreed to acquire Poppi. The deal is valued at $1.95 billion.', '2025-03-17'), site),
      ...acquisitionStatements('Poppi', { url: 'https://www.pepsico.com/newsroom/press-releases/2025/poppi', title: 'PepsiCo', text: poppiClosedRelease }, site),
    ];
    expect(decideOwnership({ statements, registry: [] })).toMatchObject({ status: 'acquired', announcedOn: '2025-03-17', closedOn: '2025-05-27',
      price: { value: 1.95e9, currency: 'USD' }, confidence: 'verified' });
  });
});

describe('preferOwnership: a fresh run vs the stored record', () => {
  const cite = (url: string) => ({ url, title: 'x' });
  const stale: Ownership = { status: 'acquired', acquirer: 'PepsiCo', announcedOn: '2025-05-19', closedOn: '2025-05', price: null,
    citations: [cite('https://a.example.com/1')], confidence: 'estimated', methodNote: 'old' };

  it('a fresh record at least as well evidenced replaces the stale one', () => {
    const fresh: Ownership = { ...stale, announcedOn: '2025-03-17', price: { value: 1.95e9, currency: 'USD' }, citations: [cite('https://b.example.org/2')] };
    expect(preferOwnership(stale, fresh)).toMatchObject({ announcedOn: '2025-03-17', price: { value: 1.95e9 } });
    expect(preferOwnership(stale, { ...fresh, confidence: 'verified', closedOn: '2025-05-27' })).toMatchObject({ confidence: 'verified', closedOn: '2025-05-27' });
  });

  it('a weaker fresh run keeps the stored status but takes its evidenced date and price', () => {
    const weaker: Ownership = { status: 'acquisition_pending', acquirer: 'PepsiCo', announcedOn: '2025-03-17', closedOn: null,
      price: { value: 1.95e9, currency: 'USD' }, citations: [cite('https://cnbc.example.com/p')], confidence: 'verified', methodNote: 'new' };
    const kept = preferOwnership(stale, weaker)!;
    expect(kept).toMatchObject({ status: 'acquired', closedOn: '2025-05', announcedOn: '2025-03-17', price: { value: 1.95e9 } });
    expect(kept.citations.map((c) => c.url)).toEqual(['https://a.example.com/1', 'https://cnbc.example.com/p']);
    // A different buyer's weaker record changes nothing.
    expect(preferOwnership(stale, { ...weaker, acquirer: 'Coca-Cola' })).toBe(stale);
  });

  it('nothing found keeps the stored record; a human-verified record is never replaced', () => {
    expect(preferOwnership(stale, null)).toBe(stale);
    const human: Ownership = { ...stale, confidence: 'user_verified' };
    expect(preferOwnership(human, { ...stale, confidence: 'verified', announcedOn: '2025-03-17' })).toBe(human);
    expect(preferOwnership(null, stale)).toMatchObject({ status: 'acquired' });
  });
});
