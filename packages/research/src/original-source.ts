/** Original page extract; retrieval alone never establishes claim accuracy. */
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
  retrieve(url: string): Promise<OriginalSourceReceipt>;
  save(attempt: OriginalSourceAttempt): Promise<void>;
  list(input: { companyId: string; metricType?: string; limit?: number }): Promise<OriginalSourceAttempt[]>;
}

/** Public-page receipts only. Short reuse never changes their retrieval date. */
export function coalesceOriginalSources(read: (url: string) => Promise<OriginalSourceReceipt>, now = Date.now): (url: string) => Promise<OriginalSourceReceipt> {
  const cache = new Map<string, { receipt: OriginalSourceReceipt; expires: number }>();
  const pending = new Map<string, Promise<OriginalSourceReceipt>>();
  return async (url) => {
    const hit = cache.get(url);
    if (hit && hit.expires > now()) return { ...hit.receipt };
    cache.delete(url);
    let work = pending.get(url);
    if (!work) {
      if (pending.size >= 32) return { ...await read(url) };
      work = Promise.resolve().then(() => read(url)).then((receipt) => {
        if (receipt.status === 'retrieved') {
          cache.set(url, { receipt: { ...receipt }, expires: now() + 30000 });
          if (cache.size > 32) cache.delete(cache.keys().next().value!);
        }
        return { ...receipt };
      }).finally(() => pending.delete(url));
      pending.set(url, work);
    }
    return { ...await work };
  };
}
