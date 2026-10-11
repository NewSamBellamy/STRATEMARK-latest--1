/** web-search — provider adapters, relay validation and the discovery lane. */
import { describe, expect, it, vi } from 'vitest';
import {
  buildSearchRequest,
  huntSearchQueries,
  isPlausibleSearchKey,
  parseSearchRelayRequest,
  parseSearchResponse,
  relayWebSearch,
  runProviderSearch,
  SEARCH_PROVIDERS,
  WebSearchError,
  webSearchLane,
} from './web-search';

const jsonResponse = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('buildSearchRequest', () => {
  it('puts the key in each provider\'s own header and nowhere in the URL', () => {
    for (const provider of SEARCH_PROVIDERS) {
      const req = buildSearchRequest(provider, 'secret-key-123', 'ramp revenue');
      expect(req.url.startsWith('https://')).toBe(true);
      expect(req.url).not.toContain('secret-key-123');
      expect(JSON.stringify(req.init.headers)).toContain('secret-key-123');
      expect(req.init.body ?? '').not.toContain('secret-key-123');
    }
    expect(buildSearchRequest('serper', 'k'.repeat(10), 'q').init.headers['X-API-KEY']).toBe('k'.repeat(10));
    expect(buildSearchRequest('tavily', 'tvly-abcdefgh', 'q').init.headers.Authorization).toBe('Bearer tvly-abcdefgh');
    expect(buildSearchRequest('brave', 'k'.repeat(10), 'a b').url).toContain('q=a%20b');
  });
});

describe('parseSearchResponse', () => {
  it('normalizes every provider shape', () => {
    expect(parseSearchResponse('serper', { organic: [{ link: 'https://a.com/x', title: 'A', snippet: 'Revenue $1B', date: 'Mar 3, 2026' }] }))
      .toEqual([{ url: 'https://a.com/x', title: 'A', snippet: 'Revenue $1B', published: 'Mar 3, 2026' }]);
    expect(parseSearchResponse('tavily', { results: [{ url: 'https://b.com', title: 'B', content: 'c' }] })[0]?.url).toBe('https://b.com/');
    expect(parseSearchResponse('exa', { results: [{ url: 'https://c.com', title: 'C', highlights: ['one', 'two'] }] })[0]?.snippet).toBe('one … two');
    expect(parseSearchResponse('brave', { web: { results: [{ url: 'https://d.com', title: '<strong>D</strong>', description: 'x &amp; y' }] } })[0])
      .toMatchObject({ title: 'D', snippet: 'x & y' });
    expect(parseSearchResponse('jina', { data: [{ url: 'https://e.com', title: 'E', description: 'e' }] })).toHaveLength(1);
  });

  it('keeps only distinct https results, at most eight', () => {
    const organic = [
      { link: 'http://insecure.com', title: 'no' },
      { link: 'not a url', title: 'no' },
      { link: 'https://a.com/p#frag', title: 'A' },
      { link: 'https://a.com/p', title: 'dup' },
      ...Array.from({ length: 12 }, (_, i) => ({ link: `https://s${i}.com`, title: `S${i}` })),
    ];
    const rows = parseSearchResponse('serper', { organic });
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ url: 'https://a.com/p', title: 'A' });
  });

  it('returns nothing for malformed bodies', () => {
    expect(parseSearchResponse('tavily', 'nope')).toEqual([]);
    expect(parseSearchResponse('brave', { web: null })).toEqual([]);
  });
});

describe('runProviderSearch', () => {
  it('turns a rejected key into a plain message without the key', async () => {
    const error = await runProviderSearch('tavily', 'tvly-secretsecret', 'q', vi.fn(() => jsonResponse({ detail: 'bad' }, 401))).catch((e) => e);
    expect(error).toBeInstanceOf(WebSearchError);
    expect(error.message).toBe('Your Tavily key was rejected. Check or replace it in Settings.');
    expect(error.message).not.toContain('secret');
  });

  it('reports an exhausted allowance and network failure plainly', async () => {
    await expect(runProviderSearch('serper', 'k'.repeat(10), 'q', vi.fn(() => jsonResponse({}, 429)))).rejects.toThrow(/allowance is used up/);
    await expect(runProviderSearch('serper', 'k'.repeat(10), 'q', vi.fn(() => Promise.reject(new Error('down'))))).rejects.toThrow(/unavailable/);
  });
});

describe('relay validation', () => {
  it('accepts only known providers and bounded queries', () => {
    expect(parseSearchRelayRequest({ provider: 'tavily', query: ' ramp ' })).toEqual({ provider: 'tavily', query: 'ramp' });
    expect(parseSearchRelayRequest({ provider: 'google', query: 'ramp' })).toBeNull();
    expect(parseSearchRelayRequest({ provider: 'tavily', query: 'x' })).toBeNull();
    expect(parseSearchRelayRequest({ provider: 'tavily', query: 'x'.repeat(401) })).toBeNull();
    expect(parseSearchRelayRequest(null)).toBeNull();
  });

  it('rejects keys that could break a header', () => {
    expect(isPlausibleSearchKey('tvly-abcdefgh')).toBe(true);
    expect(isPlausibleSearchKey('short')).toBe(false);
    expect(isPlausibleSearchKey('abc def ghi')).toBe(false);
    expect(isPlausibleSearchKey('abcdefgh\r\nX-Evil: 1')).toBe(false);
  });
});

describe('relayWebSearch', () => {
  it('sends the key only as X-Search-Key and keeps https rows', async () => {
    const fetchImpl = vi.fn((_url: string, _init?: RequestInit) => jsonResponse({ results: [
      { url: 'https://a.com', title: 'A', snippet: 's' }, { url: 'javascript:alert(1)', title: 'x', snippet: '' }] }));
    const search = relayWebSearch({ endpoint: '/__stratemark/search', provider: 'tavily', key: 'tvly-abcdefgh', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await search('ramp arr')).toEqual([{ url: 'https://a.com', title: 'A', snippet: 's' }]);
    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['X-Search-Key']).toBe('tvly-abcdefgh');
    expect(String(init.body)).not.toContain('tvly-abcdefgh');
  });

  it('omits the key header for the hosted relay and surfaces its error text', async () => {
    const fetchImpl = vi.fn((_url: string, _init?: RequestInit) => jsonResponse({ error: 'Daily search budget reached.' }, 429));
    const search = relayWebSearch({ endpoint: 'https://w/v1/search', provider: 'serper', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(search('q q')).rejects.toThrow('Daily search budget reached.');
    expect(fetchImpl.mock.calls[0]![1]!.headers).not.toHaveProperty('X-Search-Key');
  });
});

describe('huntSearchQueries', () => {
  it('asks one focused query per missing family, at most three', () => {
    expect(huntSearchQueries('Ramp', ['arr', 'valuation'], { year: 2026 }))
      .toEqual(['"Ramp" annual revenue 2026', '"Ramp" valuation funding round 2026']);
    expect(huntSearchQueries('Ramp', ['arr', 'valuation', 'aum', 'employees'], { year: 2026 })).toHaveLength(3);
  });

  it('leads with filings on escalation and Form ADV for financial firms', () => {
    expect(huntSearchQueries('Acme "Capital"', ['employees'], { escalation: 1, financialFirm: true, year: 2026 })).toEqual([
      '"Acme Capital" annual report filing disclosure',
      '"Acme Capital" assets under management Form ADV',
      '"Acme Capital" employees customers 2026',
    ]);
  });
});

describe('webSearchLane', () => {
  it('merges distinct results across queries and tolerates a failed query', async () => {
    const search = vi.fn(async (q: string) => {
      if (q === 'bad') throw new Error('x');
      return [{ url: 'https://a.com/', title: 'A', snippet: `about ${q}`, published: '2026-03-01' }, { url: `https://${q}.com/`, title: q, snippet: '' }];
    });
    const notes = await webSearchLane(search).discover(['one', 'two', 'bad']);
    expect(notes.citations.map((c) => c.url)).toEqual(['https://a.com/', 'https://one.com/', 'https://two.com/']);
    expect(notes.queries).toEqual(['one', 'two', 'bad']);
    expect(notes.text).toContain('[published 2026-03-01]');
    expect(notes.grounding).toBeUndefined();
  });

  it('says plainly when nothing came back', async () => {
    const notes = await webSearchLane(async () => []).discover(['q']);
    expect(notes.citations).toEqual([]);
    expect(notes.text).toContain('No search results');
  });
});
