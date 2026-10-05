import { classifySource, isRedirectCitation, usableCitations, type Citation } from '@mi/contracts';

/** Routing priority only, never evidence acceptance. Preserve the two-read budget. */
export function selectOriginalSourceCitations(citations: readonly Citation[], officialWebsite?: string | null): Citation[] {
  const priority = { primary: 4, reputable_secondary: 3, industry: 2, unknown: 1, user_generated: 0 };
  const pages = new Set<string>();
  // Both original readers require public HTTPS on the standard TLS port.
  // Do not promote HTTP to HTTPS: that would invent a different source URL.
  return usableCitations(citations).filter(citation => {
    const url = new URL(citation.url);
    if (url.protocol !== 'https:' || (url.port && url.port !== '443')) return false;
    // Readers strip fragments. URL also normalizes an explicit :443, but query
    // parameters remain part of identity because they may select another report.
    url.hash = '';
    if (pages.has(url.href)) return false;
    pages.add(url.href);
    return true;
  }).map((citation, index) => ({
    citation, index,
    priority: priority[classifySource(citation.url, citation.title, officialWebsite)],
    redirect: Number(isRedirectCitation(citation.url)),
  })).sort((a, b) => b.priority - a.priority || a.redirect - b.redirect || a.index - b.index)
    .slice(0, 2).map(row => row.citation);
}

/** Original page extract; retrieval alone never establishes claim accuracy. */
export interface OriginalSourceScope {
  companyId: string;
  companyName: string;
  metricType?: string;
}

export interface OriginalSourceReceipt {
  requestedUrl: string;
  finalUrl?: string;
  status: 'retrieved' | 'blocked' | 'unavailable';
  retrievedAt: string;
  httpStatus?: number;
  contentHash?: string;
  text?: string;
  truncated?: boolean;
  reason?: string;
}

export interface OriginalSourceAttempt {
  id: string;
  companyId: string;
  metricType: string;
  capturedAt: string;
  receipts: OriginalSourceReceipt[];
}

/** Storage shape/size validation only; never proof of a document's authenticity. */
export function isOriginalSourceAttempt(value: unknown): value is OriginalSourceAttempt {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<OriginalSourceAttempt>;
  const bounded = (text: unknown, max: number) => typeof text === 'string' && text.length > 0 && text.length <= max;
  const date = (text: unknown) => bounded(text, 40) && Number.isFinite(Date.parse(text as string));
  return bounded(row.id, 200) && bounded(row.companyId, 200) && bounded(row.metricType, 80) && date(row.capturedAt) &&
    Array.isArray(row.receipts) && row.receipts.length <= 2 && row.receipts.every(receipt => {
      if (!receipt || typeof receipt !== 'object' || !bounded(receipt.requestedUrl, 2048) || !date(receipt.retrievedAt) ||
        !['retrieved', 'blocked', 'unavailable'].includes(receipt.status) ||
        (receipt.finalUrl !== undefined && !bounded(receipt.finalUrl, 2048)) ||
        (receipt.reason !== undefined && !bounded(receipt.reason, 1000)) ||
        (receipt.truncated !== undefined && typeof receipt.truncated !== 'boolean') ||
        (receipt.httpStatus !== undefined && (!Number.isInteger(receipt.httpStatus) || receipt.httpStatus < 100 || receipt.httpStatus > 599))) return false;
      return receipt.status === 'retrieved'
        ? receipt.httpStatus === 200 && bounded(receipt.finalUrl, 2048) && /^[a-f0-9]{64}$/.test(receipt.contentHash ?? '') && bounded(receipt.text, 4000)
        : receipt.text === undefined && receipt.contentHash === undefined;
    });
}

/** Native host supplies durable storage and network; renderer gets neither. */
export interface OriginalSourceServices {
  retrieve(url: string, scope?: OriginalSourceScope): Promise<OriginalSourceReceipt>;
  save(attempt: OriginalSourceAttempt): Promise<void>;
  list(input: { companyId: string; metricType?: string; limit?: number }): Promise<OriginalSourceAttempt[]>;
}

/** Public-page receipts only. Short reuse never changes their retrieval date. */
export function coalesceOriginalSources(read: (url: string, scope?: OriginalSourceScope) => Promise<OriginalSourceReceipt>, now = Date.now): (url: string, scope?: OriginalSourceScope) => Promise<OriginalSourceReceipt> {
  const cache = new Map<string, { receipt: OriginalSourceReceipt; expires: number }>();
  const pending = new Map<string, Promise<OriginalSourceReceipt>>();
  return async (url, scope) => {
    scope = scope ? { ...scope } : undefined;
    const key = JSON.stringify([url, scope?.companyId ?? null, scope?.companyName ?? null, scope?.metricType ?? null]);
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return { ...hit.receipt };
    cache.delete(key);
    let work = pending.get(key);
    if (!work) {
      if (pending.size >= 32) return { ...await read(url, scope) };
      work = Promise.resolve().then(() => read(url, scope)).then((receipt) => {
        if (receipt.status === 'retrieved') {
          cache.set(key, { receipt: { ...receipt }, expires: now() + 30000 });
          if (cache.size > 32) cache.delete(cache.keys().next().value!);
        }
        return { ...receipt };
      }).finally(() => pending.delete(key));
      pending.set(key, work);
    }
    return { ...await work };
  };
}
