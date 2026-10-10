import type { Citation, MetricType } from '@mi/contracts';
import type { OriginalSourceReceipt, OriginalSourceServices } from './original-source';
import { secFilingCik, secRevenueCik, secRevenueObservation } from './sec-revenue';
import { sleep, throwIfAborted } from './util';

/**
 * A hung page read must not stall a hunt or verification indefinitely — every
 * retrieve is raced against this window and degrades to an unavailable
 * receipt, exactly like a blocked or dead host. Verification then proceeds
 * with the sources that did answer.
 */
export const ORIGINAL_RETRIEVE_TIMEOUT_MS = 20_000;

async function retrieveWithTimeout(
  sources: OriginalSourceServices, url: string,
  scope: Parameters<OriginalSourceServices['retrieve']>[1],
  signal: AbortSignal | undefined,
): Promise<OriginalSourceReceipt> {
  const retrieve = sources.retrieve(url, scope);
  // After the timeout abandons this read, a late rejection must not surface
  // as an unhandled rejection; the race below already has its verdict.
  retrieve.catch(() => undefined);
  return Promise.race([
    retrieve,
    sleep(ORIGINAL_RETRIEVE_TIMEOUT_MS, signal).then(() => ({
      requestedUrl: url, status: 'unavailable' as const, retrievedAt: new Date().toISOString(),
      reason: `Original-source retrieval exceeded ${ORIGINAL_RETRIEVE_TIMEOUT_MS / 1000}s and was abandoned.`,
    })),
  ]);
}

/** More disclosure coverage, not more model calls. Keep the durable receipt
 * contract (two per attempt) and the three-company reader pool (six requests)
 * intact. Persist each batch before interpretation or starting the next one. */
export async function readCompanyOriginals(input: {
  sources: OriginalSourceServices; citations: readonly Citation[];
  companyId: string; companyName: string; topic: string;
  maxSources: number; missing?: readonly MetricType[]; signal?: AbortSignal;
  forceRefresh?: boolean;
}): Promise<OriginalSourceReceipt[]> {
  const result: OriginalSourceReceipt[] = [];
  const seen = new Set<string>();
  const candidates = input.citations.filter(citation => {
    if (seen.has(citation.url)) return false;
    seen.add(citation.url);
    return true;
  }).slice(0, Math.max(0, Math.min(4, input.maxSources)));
  const cues: Partial<Record<MetricType, RegExp>> = {
    employees: /employees|headcount|workforce/i, arr: /revenue|earnings|annual|financial/i,
    users: /users|customers|subscriber/i, valuation: /valuation|funding|valued/i,
    market_cap: /market.cap|capitalization/i,
  };
  for (let offset = 0; offset < candidates.length; offset += 2) {
    throwIfAborted(input.signal);
    const receipts = await Promise.all(candidates.slice(offset, offset + 2).map((citation, index) => {
      const label = `${citation.title} ${citation.url}`;
      const focus = input.missing?.find(type => cues[type]?.test(label)) ?? input.missing?.[(offset + index) % (input.missing.length || 1)];
      return retrieveWithTimeout(input.sources, citation.url, { companyId: input.companyId, companyName: input.companyName,
        metricType: secRevenueCik(citation.url) ? 'metrics_hunt' : secFilingCik(citation.url) ? 'employees' : focus ?? input.topic,
        ...(input.forceRefresh ? { forceRefresh: true } : {}) }, input.signal);
    }));
    throwIfAborted(input.signal);
    await input.sources.save({ id: `src_${globalThis.crypto.randomUUID()}`, companyId: input.companyId,
      metricType: input.topic, capturedAt: new Date().toISOString(), receipts });
    result.push(...receipts);
    // The retained XBRL record identifies its actual filing accession. Prefer
    // that disclosure to another navigation hub, without adding model calls or
    // exceeding the caller's source-slot budget. The filing still needs its own
    // retrieval and matching issuer proof before any headcount can be accepted.
    if (offset === 0 && input.maxSources >= 3 &&
      (input.topic === 'company_profile' || input.missing?.includes('employees')) &&
      !candidates.some(citation => secFilingCik(citation.url))) {
      const filing = secRevenueObservation(input.companyName, result)?.citations.find(citation => secFilingCik(citation.url));
      if (filing) candidates.splice(2, 1, filing);
    }
  }
  return result;
}
