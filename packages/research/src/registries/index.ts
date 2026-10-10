/**
 * Free keyless registry lane. `lookupRegistryFacts` runs every applicable
 * adapter in parallel, each under its own timeout, and NEVER throws: failures
 * surface as per-adapter status.
 */
import { brregSource } from './brreg';
import { frEntreprisesSource } from './fr-entreprises';
import type {
  AdapterStatus,
  EntityIdentity,
  IdentityEnrichment,
  RegistryFact,
  RegistryLookupResult,
  RegistrySource,
} from './types';
import { wikidataSource } from './wikidata';

export * from './types';
export { extractOrganizationJsonLd, wikidataQidFromUrl } from './jsonld';
export type { OrganizationJsonLd } from './jsonld';
export { wikidataSource } from './wikidata';
export { brregSource } from './brreg';
export { frEntreprisesSource, INSEE_BANDS } from './fr-entreprises';

export const REGISTRY_SOURCES: RegistrySource[] = [wikidataSource, brregSource, frEntreprisesSource];
export const REGISTRY_ADAPTER_TIMEOUT_MS = 4000;

export interface LookupRegistryOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Test seam; defaults to REGISTRY_SOURCES. */
  sources?: RegistrySource[];
}

export async function lookupRegistryFacts(
  identity: EntityIdentity,
  opts: LookupRegistryOptions = {},
): Promise<RegistryLookupResult> {
  const fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = opts.timeoutMs ?? REGISTRY_ADAPTER_TIMEOUT_MS;
  const sources = opts.sources ?? REGISTRY_SOURCES;
  const facts: RegistryFact[] = [];
  const enrichment: IdentityEnrichment = {};

  const runOne = async (source: RegistrySource): Promise<AdapterStatus> => {
    const started = Date.now();
    let applies = false;
    try {
      applies = source.applies(identity);
    } catch {
      applies = false;
    }
    if (!applies) return { registry: source.id, status: 'skipped', reason: 'not applicable' };
    if (opts.signal?.aborted) return { registry: source.id, status: 'error', reason: 'aborted' };

    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve('timeout');
      }, timeoutMs);
    });
    try {
      const outcome = await Promise.race([
        source.lookup(identity, { fetchImpl, signal: controller.signal }),
        timeout,
      ]);
      if (outcome === 'timeout') {
        return { registry: source.id, status: 'error', reason: `timeout after ${timeoutMs}ms`, ms: Date.now() - started };
      }
      if (outcome.status === 'matched') {
        facts.push(...outcome.facts);
        Object.assign(enrichment, outcome.enrichment);
      }
      return { registry: source.id, status: outcome.status, reason: outcome.reason, ms: Date.now() - started };
    } catch (err) {
      return {
        registry: source.id,
        status: 'error',
        reason: err instanceof Error ? err.message : String(err),
        ms: Date.now() - started,
      };
    } finally {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  };

  const statuses = await Promise.all(sources.map(runOne));
  return { facts, enrichment, statuses };
}
