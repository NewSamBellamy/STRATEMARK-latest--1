import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.doUnmock('./local-source-reader');
});

async function lane(endpoint: { url: string; headers: Record<string, string> } | null) {
  vi.doMock('./local-source-reader', () => ({ relayEndpoint: () => endpoint }));
  return (await import('./news-lane')).currentNewsSearch();
}

describe('news lane', () => {
  it('is off when the build has no relay', async () => {
    expect(await lane(null)).toBeNull();
  });

  it('asks the relay, keeps https results, and caches identical queries', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [
      { url: 'https://techcrunch.com/a', title: 'A', snippet: '' }, { url: 'javascript:alert(1)', title: 'x', snippet: '' }] })));
    vi.stubGlobal('fetch', fetchMock);
    const search = (await lane({ url: '/__stratemark/news', headers: { 'Content-Type': 'application/json' } }))!;
    expect(await search('"Ramp" raises funding')).toEqual([{ url: 'https://techcrunch.com/a', title: 'A', snippet: '' }]);
    await search('"Ramp" raises funding');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ query: '"Ramp" raises funding' });
  });

  it('turns relay failures into no leads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    const search = (await lane({ url: '/__stratemark/news', headers: {} }))!;
    expect(await search('q1')).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await search('q2')).toEqual([]);
  });
});
