/** crawl4ai — optional rendering lane, feature-detected and degrade-safe. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crawl4aiCrawlUrl, crawl4aiHealthUrl, crawl4aiRead, DEFAULT_CRAWL4AI_BASE, getCrawl4aiLane, probeCrawl4ai, resetCrawl4aiLaneCache } from './crawl4ai';

const jsonResponse = (body: unknown, status = 200): Promise<Response> => Promise.resolve(new Response(JSON.stringify(body), { status }));

const crawlPayload = {
  success: true,
  server_processing_time_s: 0.4,
  results: [{
    url: 'https://acme.example/about', status_code: 200, success: true,
    markdown: '# About\n\nAcme employs 45 people across three offices.',
    error_message: null,
  }],
};

afterEach(() => resetCrawl4aiLaneCache());

describe('probeCrawl4ai', () => {
  it('accepts a container whose /health answers within the timeout', async () => {
    const fetchImpl = vi.fn((_url: string) => jsonResponse({ status: 'ok' }));
    await expect(probeCrawl4ai(DEFAULT_CRAWL4AI_BASE, fetchImpl as unknown as typeof fetch)).resolves.toBe(true);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://127.0.0.1:11235/health');
  });

  it('rejects unhealthy and unreachable containers', async () => {
    expect(await probeCrawl4ai(DEFAULT_CRAWL4AI_BASE, vi.fn(() => jsonResponse({}, 503)) as unknown as typeof fetch)).toBe(false);
    expect(await probeCrawl4ai(DEFAULT_CRAWL4AI_BASE, vi.fn(() => Promise.reject(new Error('down'))) as unknown as typeof fetch)).toBe(false);
  });
});

describe('crawl4aiRead', () => {
  it('posts {urls, formats} to /crawl and returns the markdown with its status', async () => {
    const fetchImpl = vi.fn((_url: string, _init?: RequestInit) => jsonResponse(crawlPayload));
    const page = await crawl4aiRead('https://acme.example/about', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(page).toEqual({ markdown: expect.stringContaining('45 people'), status: 200 });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://127.0.0.1:11235/crawl');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ urls: ['https://acme.example/about'], formats: ['markdown'] });
  });

  it('accepts the MarkdownGenerationResult shape newer servers return', async () => {
    const payload = { results: [{ status_code: 200, markdown: { raw_markdown: 'Rendered after JS.' } }] };
    expect(await crawl4aiRead('https://acme.example', { fetchImpl: vi.fn(() => jsonResponse(payload)) as unknown as typeof fetch }))
      .toEqual({ markdown: 'Rendered after JS.', status: 200 });
  });

  it('degrades to null on every failure mode', async () => {
    expect(await crawl4aiRead('https://acme.example', { fetchImpl: vi.fn(() => Promise.reject(new Error('down'))) as unknown as typeof fetch })).toBeNull();
    expect(await crawl4aiRead('https://acme.example', { fetchImpl: vi.fn(() => jsonResponse({}, 500)) as unknown as typeof fetch })).toBeNull();
    expect(await crawl4aiRead('https://acme.example', { fetchImpl: vi.fn(() => jsonResponse({ results: [] })) as unknown as typeof fetch })).toBeNull();
    expect(await crawl4aiRead('https://acme.example', { fetchImpl: vi.fn(() => Promise.resolve(new Response('not json', { status: 200 }))) as unknown as typeof fetch })).toBeNull();
    const failed = { results: [{ status_code: 500, success: false, markdown: '' }] };
    expect(await crawl4aiRead('https://acme.example', { fetchImpl: vi.fn(() => jsonResponse(failed)) as unknown as typeof fetch })).toBeNull();
  });
});

describe('getCrawl4aiLane', () => {
  it('memoizes a negative probe so an absent container is not re-probed per call', async () => {
    const fetchImpl = vi.fn((_url: string) => Promise.reject(new Error('down')));
    expect(await getCrawl4aiLane(fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(await getCrawl4aiLane(fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('/health');
  });

  it('exposes a read bound to the lane base on a healthy probe', async () => {
    const fetchImpl = vi.fn((url: string) => String(url).endsWith('/health')
      ? jsonResponse({ status: 'ok' })
      : jsonResponse(crawlPayload));
    const lane = await getCrawl4aiLane(fetchImpl as unknown as typeof fetch, 'http://127.0.0.1:11235/');
    expect(lane).not.toBeNull();
    expect(await lane!.read('https://acme.example/about')).toEqual({ markdown: expect.stringContaining('45 people'), status: 200 });
    expect(fetchImpl.mock.calls.some(([url]) => url === crawl4aiCrawlUrl('http://127.0.0.1:11235/'))).toBe(true);
  });

  it('re-probes after the cache is reset', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('down')));
    await getCrawl4aiLane(fetchImpl as unknown as typeof fetch);
    resetCrawl4aiLaneCache();
    await getCrawl4aiLane(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(crawl4aiHealthUrl('http://127.0.0.1:11235/')).toBe('http://127.0.0.1:11235/health');
  });
});
