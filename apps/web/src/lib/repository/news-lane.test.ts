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

async function movesLane(endpoint: { url: string; headers: Record<string, string> } | null) {
  vi.doMock('./local-source-reader', () => ({ relayEndpoint: () => endpoint }));
  return (await import('./news-lane')).currentMovesNewsSearch();
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

  it('Today lane throws on a refusing, failing or unreadable relay, and a failure is not cached', async () => {
    const endpoint = { url: '/__stratemark/news', headers: {} };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('{"error":"x"}'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] })));
    vi.stubGlobal('fetch', fetchMock);
    const search = (await movesLane(endpoint))!;
    await expect(search('q')).rejects.toThrow('429');
    await expect(search('q')).rejects.toThrow('offline');
    await expect(search('q')).rejects.toThrow('unreadable');
    // An honest empty answer is still an answer (and is cached).
    expect(await search('q')).toEqual([]);
    expect(await search('q')).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('Today lane is off when the build has no relay', async () => {
    expect(await movesLane(null)).toBeNull();
  });

  it('a failed hunt query is retried next time, not remembered as no leads', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ url: 'https://a.com/x', title: 'A', snippet: '' }] })));
    vi.stubGlobal('fetch', fetchMock);
    const search = (await lane({ url: '/__stratemark/news', headers: {} }))!;
    expect(await search('q')).toEqual([]);
    expect(await search('q')).toHaveLength(1);
  });
});
