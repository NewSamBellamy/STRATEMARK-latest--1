import { createHttpSearchConnector } from './http-search';
import { ResearchProviderError, type SearchConnector, type SearchHit } from './types';

interface KeyedSearchConnectorConfig {
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Injectable only for compatible self-hosted gateways and deterministic tests. */
  endpoint?: string;
}

function cleanRequiredKey(provider: string, value: string): string {
  const key = value.replace(/[^\x20-\x7e]/g, '').trim();
  if (!key) {
    throw new ResearchProviderError(`${provider} requires an API key.`, {
      code: 'CONFIG',
      provider,
    });
  }
  return key;
}

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected an object response.');
  }
  return value as Record<string, unknown>;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function resultArray(value: unknown, field: string): unknown[] {
  const array = recordOf(value)[field];
  if (!Array.isArray(array)) throw new Error(`Expected ${field} results.`);
  return array;
}

/**
 * Firecrawl v2 web search with page extraction enabled. Markdown is preferred
 * over the search description because it gives the evidence synthesizer actual
 * page content; the shared source normalizer bounds it before prompting.
 */
export function createFirecrawlSearchConnector(
  config: KeyedSearchConnectorConfig,
): SearchConnector {
  const provider = 'firecrawl';
  const apiKey = cleanRequiredKey(provider, config.apiKey);
  return createHttpSearchConnector({
    id: provider,
    fetchImpl: config.fetchImpl,
    request: (query, limit) => ({
      url: config.endpoint ?? 'https://api.firecrawl.dev/v2/search',
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          limit,
          sources: [{ type: 'web' }],
          scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
          ignoreInvalidURLs: true,
        }),
      },
    }),
    parse: (body) => {
      const data = recordOf(recordOf(body).data);
      if (!Array.isArray(data.web)) throw new Error('Expected Firecrawl web results.');
      return data.web.map((raw): SearchHit => {
        const item = recordOf(raw);
        return {
          url: stringOrNull(item.url) ?? '',
          title: stringOrNull(item.title),
          snippet: stringOrNull(item.markdown) ?? stringOrNull(item.description),
        };
      });
    },
  });
}

/** Perplexity's direct Search API, not Sonar and not an OpenRouter model call. */
export function createPerplexitySearchConnector(
  config: KeyedSearchConnectorConfig,
): SearchConnector {
  const provider = 'perplexity-search';
  const apiKey = cleanRequiredKey(provider, config.apiKey);
  return createHttpSearchConnector({
    id: provider,
    fetchImpl: config.fetchImpl,
    request: (query, limit) => ({
      url: config.endpoint ?? 'https://api.perplexity.ai/search',
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          max_results: Math.min(limit, 20),
          search_type: 'web',
          search_context_size: 'medium',
        }),
      },
    }),
    parse: (body) =>
      resultArray(body, 'results').map((raw): SearchHit => {
        const item = recordOf(raw);
        return {
          url: stringOrNull(item.url) ?? '',
          title: stringOrNull(item.title),
          snippet: stringOrNull(item.snippet),
          publishedAt: stringOrNull(item.date),
        };
      }),
  });
}

/** Serper discovers Google results; page retrieval remains a separate capability. */
export function createSerperSearchConnector(config: KeyedSearchConnectorConfig): SearchConnector {
  const provider = 'serper';
  const apiKey = cleanRequiredKey(provider, config.apiKey);
  return createHttpSearchConnector({
    id: provider,
    fetchImpl: config.fetchImpl,
    request: (query, limit) => ({
      url: config.endpoint ?? 'https://google.serper.dev/search',
      init: {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: query, num: limit }),
      },
    }),
    parse: (body) =>
      resultArray(body, 'organic').map((raw): SearchHit => {
        const item = recordOf(raw);
        return {
          url: stringOrNull(item.link) ?? '',
          title: stringOrNull(item.title),
          snippet: stringOrNull(item.snippet),
          publishedAt: stringOrNull(item.date),
        };
      }),
  });
}
