import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRealCoverCache, getRealCover } from './realCover';
import { LruCache } from './lookupCache';

vi.mock('@/lib/hostedApi', () => ({
  hasHostedApi: () => true,
  hostedUrl: (path: string) => `https://api.test/v1/${path}`,
}));

const preview = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body }) as Response;

describe('real cover lookups', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearRealCoverCache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('bounds every preview request with a timeout signal', async () => {
    fetchMock.mockResolvedValue(preview({ image: 'https://cdn.test/a.jpg', site: 'news.test' }));
    const cover = await getRealCover('https://news.test/story');
    expect(cover).toEqual({ src: expect.stringContaining('image?url='), publisher: 'news.test' });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('remembers settled answers, including pages that publish no image', async () => {
    fetchMock.mockResolvedValue(preview({ image: null, site: null }));
    expect(await getRealCover('https://news.test/plain')).toBeNull();
    expect(await getRealCover('https://news.test/plain')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a failed lookup after the back-off instead of caching the miss', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(preview({}, false));
    expect(await getRealCover('https://news.test/flaky')).toBeNull();

    // Within the back-off the failure is shared, not re-requested.
    expect(await getRealCover('https://news.test/flaky')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(61_000);
    fetchMock.mockResolvedValueOnce(preview({ image: 'https://cdn.test/b.jpg', site: 'news.test' }));
    expect(await getRealCover('https://news.test/flaky')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a network error or timeout as a failure, not an answer', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    expect(await getRealCover('https://news.test/slow')).toBeNull();
    vi.useFakeTimers();
    vi.advanceTimersByTime(61_000);
    fetchMock.mockResolvedValueOnce(preview({ image: 'https://cdn.test/c.jpg', site: null }));
    expect((await getRealCover('https://news.test/slow'))?.publisher).toBe('cdn.test');
  });
});

describe('LruCache', () => {
  it('evicts the least recently used entry past its cap', () => {
    const lru = new LruCache<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.get('a')).toBe(1); // touch a → b is now oldest
    lru.set('c', 3);
    expect(lru.has('b')).toBe(false);
    expect(lru.has('a')).toBe(true);
    expect(lru.size).toBe(2);
  });
});
