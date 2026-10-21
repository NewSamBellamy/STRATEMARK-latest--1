/** web-search — provider adapters, relay validation and the discovery lane. */
import { describe, expect, it, vi } from 'vitest';
import {
  buildSearchRequest,
  cappedWebSearch,
  huntSearchQueries,
  isPlausibleSearchKey,
  parseSearchRelayRequest,
  parseSearchResponse,
  publishedAtMs,
  relayWebSearch,
  relevantSearchResults,
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

  it('maps news mode and recency onto each provider', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    const body = (p: Parameters<typeof buildSearchRequest>[0]) => JSON.parse(buildSearchRequest(p, 'k'.repeat(10), 'q', { news: true, sinceDays: 730 }, now).init.body ?? '{}');
    expect(body('tavily')).toMatchObject({ topic: 'news', start_date: '2024-10-10' });
    expect(body('exa')).toMatchObject({ category: 'news', startPublishedDate: '2024-10-10T00:00:00.000Z' });
    expect(buildSearchRequest('serper', 'k'.repeat(10), 'q', { news: true }, now).url).toBe('https://google.serper.dev/news');
    expect(JSON.parse(buildSearchRequest('serper', 'k'.repeat(10), 'q', { sinceDays: 365 }, now).init.body!)).toMatchObject({ tbs: 'qdr:y' });
    expect(buildSearchRequest('brave', 'k'.repeat(10), 'q', { sinceDays: 730 }, now).url).toContain('freshness=2024-10-10to2026-10-10');
    expect(JSON.parse(buildSearchRequest('tavily', 'k'.repeat(10), 'q', {}, now).init.body!)).not.toHaveProperty('topic');
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
    expect(parseSearchRelayRequest({ provider: 'tavily', query: 'ramp', news: true, sinceDays: 730 }))
      .toEqual({ provider: 'tavily', query: 'ramp', news: true, sinceDays: 730 });
    expect(parseSearchRelayRequest({ provider: 'tavily', query: 'ramp', news: 'yes', sinceDays: -1 }))
      .toEqual({ provider: 'tavily', query: 'ramp' });
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
    expect(huntSearchQueries('Ramp', ['arr', 'valuation'], { year: 2026 })).toEqual([
      { query: '"Ramp" raises funding round valuation', news: true },
      { query: '"Ramp" revenue ARR million announced', news: true },
    ]);
    expect(huntSearchQueries('Ramp', ['arr', 'valuation', 'aum', 'employees'], { year: 2026 })).toHaveLength(3);
  });

  it('puts no year token or "latest" in any family query (a live measurement showed they pull in other companies and undated aggregators)', () => {
    const queries = huntSearchQueries('Ramp', ['arr', 'valuation', 'employees'], { year: 2026 });
    for (const q of queries) expect(q.query).not.toMatch(/\b(19|20)\d{2}\b|latest/i);
  });

  it('leads with filings on escalation and Form ADV for financial firms', () => {
    expect(huntSearchQueries('Acme "Capital"', ['employees'], { escalation: 1, financialFirm: true, year: 2026 })).toEqual([
      { query: '"Acme Capital" annual report filing disclosure', news: false },
      { query: '"Acme Capital" assets under management Form ADV', news: false },
      { query: '"Acme Capital" employees customers stores countries company says', news: true },
    ]);
  });
});

describe('relevantSearchResults', () => {
  const row = (url: string, title: string, snippet = '') => ({ url, title, snippet });

  it('keeps the company newsroom but not its content about other companies', () => {
    const kept = relevantSearchResults([
      row('https://carta.com/data/state-of-private-markets-q1-2026/', 'State of Private Markets'),
      row('https://carta.com/learn/startups/financial-reporting/', 'Financial reporting'),
      row('https://carta.com/newsroom/carta-raises-series-h/', 'Carta raises Series H'),
      row('https://carta.com/about/', 'About Carta'),
      row('https://ir.carta.com/', 'Investors'),
    ], 'Carta', 'https://carta.com').map((r) => r.url);
    expect(kept).toEqual(['https://carta.com/newsroom/carta-raises-series-h/', 'https://carta.com/about/', 'https://ir.carta.com/']);
  });

  it('keeps third-party pages only when they name the company', () => {
    const kept = relevantSearchResults([
      row('https://techcrunch.com/a', 'Carta raises $500M at a $7.4B valuation'),
      row('https://example.com/b', 'Top 10 cap table tools', 'Pulley, Ledgy and more'),
      row('https://news.com/c', 'Fintech roundup', 'Ramp, Inc. said its revenue doubled'),
    ], 'Ramp, Inc.', 'https://ramp.com').map((r) => r.url);
    expect(kept).toEqual(['https://news.com/c']);
  });
});

describe('cappedWebSearch', () => {
  it('stops calling the provider at the cap', async () => {
    const inner = vi.fn(async () => [{ url: 'https://a.com/', title: 'A', snippet: '' }]);
    const spent: number[] = [];
    const search = cappedWebSearch(inner, 2, (n) => spent.push(n));
    await search('a'); await search('b');
    expect(await search('c')).toEqual([]);
    expect(inner).toHaveBeenCalledTimes(2);
    expect(search.used()).toBe(2);
    expect(spent).toEqual([1, 2]);
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

  it('orders results newest first by published date, undated last, keeping provider order for ties', async () => {
    const search = async () => [
      { url: 'https://undated-1.com/', title: 'U1', snippet: '' },
      { url: 'https://old.com/', title: 'Old', snippet: '', published: '2024-01-05' },
      { url: 'https://new.com/', title: 'New', snippet: '', published: '2026-10-01' },
      { url: 'https://undated-2.com/', title: 'U2', snippet: '' },
      { url: 'https://recent.com/', title: 'Recent', snippet: '', published: '2026-10-15' },
    ];
    const notes = await webSearchLane(search).discover(['q']);
    expect(notes.citations.map((c) => c.url)).toEqual([
      'https://recent.com/', 'https://new.com/', 'https://old.com/', 'https://undated-1.com/', 'https://undated-2.com/']);
  });

  it('reads relative ages against an injected clock and never treats a future date as a publication date', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    expect(publishedAtMs('2 days ago', now)).toBe(Date.parse('2026-10-18T12:00:00Z'));
    expect(publishedAtMs('2027-05-01', now)).toBeNull();
    expect(publishedAtMs('yesterday-ish', now)).toBeNull();
    expect(publishedAtMs(undefined, now)).toBeNull();
  });

  it('says plainly when nothing came back', async () => {
    const notes = await webSearchLane(async () => []).discover(['q']);
    expect(notes.citations).toEqual([]);
    expect(notes.text).toContain('No search results');
  });
});
