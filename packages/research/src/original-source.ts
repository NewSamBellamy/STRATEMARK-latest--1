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
