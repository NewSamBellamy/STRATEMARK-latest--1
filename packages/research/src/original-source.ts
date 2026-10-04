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
