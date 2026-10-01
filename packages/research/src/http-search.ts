import { fetchProviderJson } from './provider-http';
import { normalizeResearchSource } from './sources';
import { ResearchProviderError, type SearchConnector, type SearchHit } from './types';

export interface HttpSearchConnectorConfig {
  id: string;
  request(
    query: string,
    limit: number,
  ): {
    url: string;
    init?: Omit<RequestInit, 'signal'>;
  };
  parse(body: unknown): readonly SearchHit[];
  fetchImpl?: typeof fetch;
}

export function createHttpSearchConnector(config: HttpSearchConnectorConfig): SearchConnector {
  const id = config.id.trim();
  if (!id) {
    throw new ResearchProviderError('Search connector requires an identifier.', {
      code: 'CONFIG',
      provider: 'http-search',
    });
  }

  return {
    id,
    async search(query, opts) {
      let request: ReturnType<HttpSearchConnectorConfig['request']>;
      try {
        request = config.request(query, opts.limit);
      } catch {
        throw new ResearchProviderError(`${id} request configuration failed.`, {
          code: 'CONFIG',
          provider: id,
        });
      }

      const body = await fetchProviderJson({
        provider: id,
        url: request.url,
        init: request.init,
        fetchImpl: config.fetchImpl,
        signal: opts.signal,
        usageMeter: opts.usageMeter,
      });

      let hits: readonly SearchHit[];
      try {
        hits = config.parse(body);
        if (!Array.isArray(hits)) throw new Error('Search parser must return an array.');
      } catch {
        throw new ResearchProviderError(`${id} returned an unsupported response.`, {
          code: 'BAD_RESPONSE',
          provider: id,
        });
      }

      const retrievedAt = new Date().toISOString();
      return hits.map((hit) => {
        const source = normalizeResearchSource(id, hit, retrievedAt);
        return {
          url: source.url,
          title: source.title,
          snippet: source.snippet,
          publishedAt: source.publishedAt,
        };
      });
    },
  };
}
