/** news-search — the free Bing News RSS lane. */
import { describe, expect, it, vi } from 'vitest';
import { bingNewsRssUrl, parseBingNewsRss, parseNewsRelayRequest, runNewsSearch } from './news-search';
import { cachedWebSearch } from './web-search';

const wrap = (url: string) => `http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=x&amp;url=${encodeURIComponent(url)}&amp;c=1&amp;mkt=en-us`;
const item = (title: string, url: string, date: string, description = 'Ramp raised $750 million.') =>
  `<item><title>${title}</title><link>${wrap(url)}</link><description>${description}</description><pubDate>${date}</pubDate></item>`;

describe('parseBingNewsRss', () => {
  it('unwraps the redirect to the publisher URL and keeps the date', () => {
    const xml = `<rss><channel>${item('Ramp raises Series F', 'https://techcrunch.com/2026/06/04/ramp-raises/', 'Thu, 04 Jun 2026 15:08:00 GMT')}</channel></rss>`;
    expect(parseBingNewsRss(xml)).toEqual([{ url: 'https://techcrunch.com/2026/06/04/ramp-raises/', title: 'Ramp raises Series F',
      snippet: 'Ramp raised $750 million.', published: '2026-06-04' }]);
  });

  it('decodes entities and CDATA, drops markup, non-https and duplicates, and caps at twelve', () => {
    const items = [
      item('<![CDATA[Ramp &amp; partners]]>', 'https://a.com/x', 'bad date', '<b>Bold</b> &quot;quote&quot;'),
      item('dup', 'https://a.com/x', 'Thu, 04 Jun 2026 15:08:00 GMT'),
      item('insecure', 'http://b.com/x', 'Thu, 04 Jun 2026 15:08:00 GMT'),
      ...Array.from({ length: 12 }, (_, i) => item(`n${i}`, `https://n${i}.com/`, 'Thu, 04 Jun 2026 15:08:00 GMT')),
    ].join('');
    const rows = parseBingNewsRss(`<rss>${items}</rss>`);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ url: 'https://a.com/x', title: 'Ramp & partners', snippet: 'Bold "quote"' });
    expect(rows.some((r) => r.url.startsWith('http:'))).toBe(false);
  });

  it('returns nothing for junk', () => {
    expect(parseBingNewsRss('not xml')).toEqual([]);
  });
});

describe('runNewsSearch', () => {
  it('queries the RSS endpoint and degrades every failure to no results', async () => {
    const ok = vi.fn(async () => new Response(`<rss>${item('t', 'https://a.com/', 'Thu, 04 Jun 2026 15:08:00 GMT')}</rss>`));
    expect(await runNewsSearch('ramp funding', ok as unknown as typeof fetch)).toHaveLength(1);
    expect(String((ok.mock.calls[0] as unknown[])[0])).toBe(bingNewsRssUrl('ramp funding'));
    expect(await runNewsSearch('ramp', vi.fn(async () => new Response('', { status: 429 })) as unknown as typeof fetch)).toEqual([]);
    expect(await runNewsSearch('ramp', vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch)).toEqual([]);
    expect(await runNewsSearch(' ', vi.fn() as unknown as typeof fetch)).toEqual([]);
  });

  it('validates relay bodies', () => {
    expect(parseNewsRelayRequest({ query: ' ramp funding ' })).toEqual({ query: 'ramp funding' });
    expect(parseNewsRelayRequest({ query: 'x' })).toBeNull();
    expect(parseNewsRelayRequest({ query: 'x'.repeat(301) })).toBeNull();
    expect(parseNewsRelayRequest(null)).toBeNull();
  });
});

describe('cachedWebSearch', () => {
  it('reuses identical queries within the TTL, separates options, and never caches failures', async () => {
    let clock = 0;
    let fail = true;
    const inner = vi.fn(async (q: string) => { if (q === 'flaky' && fail) { fail = false; throw new Error('x'); } return [{ url: `https://${q}.com/`, title: q, snippet: '' }]; });
    const search = cachedWebSearch(inner, 1000, 2, () => clock);
    await search('a'); await search('a');
    await search('a', { news: true });
    expect(inner).toHaveBeenCalledTimes(2);
    clock = 2000;
    await search('a');
    expect(inner).toHaveBeenCalledTimes(3);
    await expect(search('flaky')).rejects.toThrow();
    await search('flaky');
    expect(inner).toHaveBeenCalledTimes(5);
  });
});
