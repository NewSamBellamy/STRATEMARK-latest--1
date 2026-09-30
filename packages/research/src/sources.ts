import type { Citation, ResearchSource, SearchHit } from './types';
import { ResearchProviderError } from './types';

export interface SearchResultGroup {
  provider: string;
  hits: readonly SearchHit[];
}

function compactText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact || null;
}

export function normalizeHttpUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ResearchProviderError('Search provider returned an invalid URL.', {
      code: 'BAD_RESPONSE',
      provider: 'source-normalizer',
    });
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password
  ) {
    throw new ResearchProviderError('Search provider returned an unsafe URL.', {
      code: 'BAD_RESPONSE',
      provider: 'source-normalizer',
    });
  }
  parsed.hash = '';
  return parsed.toString();
}

function isValidDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function normalizePublishedAt(value: string | null | undefined): string | null {
  const compact = compactText(value);
  if (!compact) return null;
  if (isValidDateOnly(compact)) return compact;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(compact)) return null;
  const timestamp = Date.parse(compact);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function normalizeResearchSource(
  provider: string,
  hit: SearchHit,
  retrievedAt = new Date().toISOString(),
): ResearchSource {
  const normalizedProvider = compactText(provider);
  if (!normalizedProvider) {
    throw new ResearchProviderError('Search connector must have a provider identifier.', {
      code: 'CONFIG',
      provider: 'source-normalizer',
    });
  }
  const url = normalizeHttpUrl(hit.url);
  const hostname = new URL(url).hostname;
  const title = compactText(hit.title) ?? hostname;
  const snippet = compactText(hit.snippet)?.slice(0, 2_000) ?? null;
  return {
    url,
    title,
    snippet,
    publishedAt: normalizePublishedAt(hit.publishedAt),
    retrievedAt,
    provider: normalizedProvider,
  };
}

/**
 * Normalizes and selects evidence fairly across connectors. Duplicate URLs are
 * retained when separate providers returned them so provenance is not erased.
 */
export function selectResearchSources(
  groups: readonly SearchResultGroup[],
  limit = 12,
  retrievedAt = new Date().toISOString(),
): ResearchSource[] {
  if (limit <= 0) return [];
  const providerOrder: string[] = [];
  const byProvider = new Map<string, ResearchSource[]>();
  const seen = new Set<string>();

  for (const group of groups) {
    if (!byProvider.has(group.provider)) {
      providerOrder.push(group.provider);
      byProvider.set(group.provider, []);
    }
    const queue = byProvider.get(group.provider)!;
    for (const hit of group.hits) {
      const source = normalizeResearchSource(group.provider, hit, retrievedAt);
      const key = `${source.provider}\u0000${source.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(source);
    }
  }

  const selected: ResearchSource[] = [];
  let cursor = 0;
  while (selected.length < limit) {
    let added = false;
    for (const provider of providerOrder) {
      const source = byProvider.get(provider)?.[cursor];
      if (!source) continue;
      selected.push(source);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
    cursor += 1;
  }
  return selected;
}

/** Public citations collapse duplicate URLs while internal sources retain them. */
export function projectCitations(sources: readonly ResearchSource[]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const source of sources) {
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    citations.push({ title: source.title, url: source.url });
  }
  return citations;
}
