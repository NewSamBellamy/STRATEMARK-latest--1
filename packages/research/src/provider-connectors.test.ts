import { describe, expect, it, vi } from 'vitest';
import {
  createFirecrawlSearchConnector,
  createPerplexitySearchConnector,
  createSerperSearchConnector,
} from './provider-connectors';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('first-party search connectors', () => {
  it('fails during setup when a required provider key is blank', () => {
    expect(() => createFirecrawlSearchConnector({ apiKey: '  ' })).toThrowError(
      expect.objectContaining({ code: 'CONFIG', provider: 'firecrawl' }),
    );
    expect(() => createPerplexitySearchConnector({ apiKey: '\n' })).toThrowError(
      expect.objectContaining({ code: 'CONFIG', provider: 'perplexity-search' }),
    );
    expect(() => createSerperSearchConnector({ apiKey: '' })).toThrowError(
      expect.objectContaining({ code: 'CONFIG', provider: 'serper' }),
    );
  });

  it('uses Firecrawl v2 search and prefers extracted page markdown', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          web: [
            {
              url: 'https://example.com/company',
              title: 'Company',
              description: 'Search description',
              markdown: 'Extracted page evidence',
            },
          ],
        },
      }),
    );
    const connector = createFirecrawlSearchConnector({ apiKey: 'fc-key', fetchImpl });

    await expect(connector.search('company funding', { limit: 5 })).resolves.toEqual([
      {
        url: 'https://example.com/company',
        title: 'Company',
        snippet: 'Extracted page evidence',
        publishedAt: null,
      },
    ]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.firecrawl.dev/v2/search');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer fc-key');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      query: 'company funding',
      limit: 5,
      sources: [{ type: 'web' }],
      scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
    });
  });

  it('maps Perplexity Search results and sends bounded direct-search options', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        results: [
          {
            title: 'Funding report',
            url: 'https://example.com/report',
            snippet: 'The company raised a round.',
            date: '2026-09-29',
            last_updated: '2026-09-30',
          },
        ],
        id: 'search-id',
      }),
    );
    const connector = createPerplexitySearchConnector({ apiKey: 'pplx-key', fetchImpl });

    await expect(connector.search('company funding', { limit: 50 })).resolves.toEqual([
      {
        url: 'https://example.com/report',
        title: 'Funding report',
        snippet: 'The company raised a round.',
        publishedAt: '2026-09-29',
      },
    ]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.perplexity.ai/search');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer pplx-key');
    expect(JSON.parse(String(init?.body))).toEqual({
      query: 'company funding',
      max_results: 20,
      search_type: 'web',
      search_context_size: 'medium',
    });
  });

  it('maps Serper organic discovery results without treating relative dates as facts', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        organic: [
          {
            title: 'Company profile',
            link: 'https://example.com/profile',
            snippet: 'Company profile result.',
            date: '2 days ago',
          },
        ],
      }),
    );
    const connector = createSerperSearchConnector({ apiKey: 'serper-key', fetchImpl });

    await expect(connector.search('company profile', { limit: 5 })).resolves.toEqual([
      {
        url: 'https://example.com/profile',
        title: 'Company profile',
        snippet: 'Company profile result.',
        publishedAt: null,
      },
    ]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://google.serper.dev/search');
    expect((init?.headers as Record<string, string>)['X-API-KEY']).toBe('serper-key');
    expect(JSON.parse(String(init?.body))).toEqual({ q: 'company profile', num: 5 });
  });

  it('fails closed on an unsupported provider response shape', async () => {
    const connector = createPerplexitySearchConnector({
      apiKey: 'pplx-key',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ results: null })),
    });

    await expect(connector.search('company', { limit: 5 })).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
      provider: 'perplexity-search',
    });
  });
});
