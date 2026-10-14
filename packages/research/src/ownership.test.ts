import { describe, expect, it } from 'vitest';
import { enforceMetricProvenance, type CompanyMetric } from '@mi/contracts';
import {
  acquisitionStatements, dateInSentence, decideOwnership, findOwnership, gleifOwnership, metricOwnershipEvidence,
  wikidataParentClaims, type OwnershipEvidenceText,
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
