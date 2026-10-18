import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentWebSearch, searchUsageThisMonth, spendSearch, useSearchKey } from './searchKey';

vi.mock('@/lib/repository/local-source-reader', () => ({
  hasLocalSourceBridge: () => true,
  relayEndpoint: () => ({ url: '/relay/search', headers: {} }),
}));

describe('monthly search cap', () => {
  beforeEach(() => localStorage.removeItem('mi.searchUsage'));

  it('counts searches and refuses past the cap', () => {
    expect(spendSearch(2)).toBe(true);
    expect(spendSearch(2)).toBe(true);
    expect(spendSearch(2)).toBe(false);
    expect(searchUsageThisMonth()).toBe(2);
  });

  it('starts fresh in a new month', () => {
    localStorage.setItem('mi.searchUsage', JSON.stringify({ month: '2000-01', count: 999 }));
    expect(searchUsageThisMonth()).toBe(0);
    expect(spendSearch(1)).toBe(true);
  });
});

describe('the memoised search lane', () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [{ url: 'https://example.com/a', title: 'a', snippet: 'a' }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }));

  beforeEach(() => {
    localStorage.removeItem('mi.searchUsage');
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    useSearchKey.getState().setSearchKey('serper', 'serper-test-key-0001');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useSearchKey.getState().setSearchKey('tavily', '');
  });

  it('answers a repeated query from memory: one request, one count against the monthly cap', async () => {
    const search = currentWebSearch()!;
    const first = await search('"Zenith" raises funding round valuation', { news: true, sinceDays: 366 });
    const again = await search('"Zenith" raises funding round valuation', { news: true, sinceDays: 366 });
    expect(first).toHaveLength(1);
    expect(again).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(searchUsageThisMonth()).toBe(1);
    // A different query (or option) is a different request.
    await search('"Zenith" raises funding round valuation');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not remember a monthly-cap hit: once the cap is lifted the same query goes through', async () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    localStorage.setItem('mi.searchUsage', JSON.stringify({ month, count: 900 }));
    const search = currentWebSearch()!;
    // At the cap the lane fails (callers treat that as "no leads" and ask Gemini instead) without a request.
    await expect(search('"Zenith" cap probe')).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).not.toHaveBeenCalled();
    localStorage.removeItem('mi.searchUsage');
    await expect(search('"Zenith" cap probe')).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('hands every caller the same lane while the key is unchanged, and a fresh one when it changes', async () => {
    const a = currentWebSearch();
    expect(currentWebSearch()).toBe(a);
    useSearchKey.getState().setSearchKey('serper', 'serper-test-key-0002');
    expect(currentWebSearch()).not.toBe(a);
  });
});
