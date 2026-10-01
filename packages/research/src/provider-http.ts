import {
  ResearchProviderError,
  type ResearchProviderErrorCode,
  type UsageMeter,
  type UsageReport,
} from './types';
import { ResearchUsageLimitError } from './usage-meter';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 30_000;

export interface ProviderHttpUsage<T> {
  kind: 'model' | 'search';
  estimatedInputTokens: number;
  maxOutputTokens: number;
  bodyWithOutputLimit?: (maxOutputTokens: number) => NonNullable<RequestInit['body']>;
  report?: (body: T) => UsageReport | undefined;
}

export interface ProviderHttpOptions<T = unknown> {
  provider: string;
  url: string;
  init?: Omit<RequestInit, 'signal'>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  attempts?: number;
  usageMeter?: UsageMeter;
  usage?: ProviderHttpUsage<T>;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { name?: unknown }).name === 'AbortError' ||
      (error as { code?: unknown }).code === 'ABORT_ERR')
  );
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS);
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_AFTER_MS);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function codeForStatus(status: number): ResearchProviderErrorCode {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 402) return 'QUOTA';
  if (status === 429) return 'RATE_LIMIT';
  if (status === 408 || status === 504) return 'TIMEOUT';
  if (status === 451) return 'BLOCKED';
  if (status >= 500) return 'UPSTREAM';
  return 'BAD_RESPONSE';
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Small safe HTTP boundary shared by new provider adapters. It deliberately
 * omits response bodies, URLs, and headers from public failures.
 */
export async function fetchProviderJson<T = unknown>(
  options: ProviderHttpOptions<T>,
): Promise<T> {
  const doFetch = options.fetchImpl ?? fetch;
  const attempts = Math.max(1, Math.min(options.attempts ?? DEFAULT_ATTEMPTS, DEFAULT_ATTEMPTS));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) throw abortReason(options.signal);
    const usageAttempt = options.usageMeter?.beginAttempt({
      kind: options.usage?.kind ?? 'search',
      estimatedInputTokens: options.usage?.estimatedInputTokens ?? 0,
      maxOutputTokens: options.usage?.maxOutputTokens ?? 0,
    });
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const init =
        usageAttempt && options.usage?.bodyWithOutputLimit
          ? {
              ...options.init,
              body: options.usage.bodyWithOutputLimit(usageAttempt.maxOutputTokens),
            }
          : options.init;
      const response = await doFetch(options.url, { ...init, signal });
      if (!response.ok) {
        const code = codeForStatus(response.status);
        const retryable = retryableStatus(response.status);
        const error = new ResearchProviderError(`${options.provider} request failed.`, {
          code,
          provider: options.provider,
          status: response.status,
          retryable,
        });
        if (retryable && attempt < attempts) {
          const delay = retryAfterMs(response.headers.get('retry-after')) ?? attempt * 1_000;
          await wait(delay, options.signal);
          continue;
        }
        throw error;
      }
      try {
        const body = (await response.json()) as T;
        if (usageAttempt) {
          options.usageMeter?.settleAttempt(
            usageAttempt.id,
            options.usage?.report?.(body) ??
              (options.usage?.kind === 'model' ? undefined : { inputTokens: 0, outputTokens: 0 }),
          );
        }
        return body;
      } catch (cause) {
        if (cause instanceof ResearchUsageLimitError) throw cause;
        throw new ResearchProviderError(`${options.provider} returned invalid JSON.`, {
          code: 'BAD_RESPONSE',
          provider: options.provider,
          status: response.status,
          cause,
        });
      }
    } catch (cause) {
      if (options.signal?.aborted) throw abortReason(options.signal);
      if (cause instanceof ResearchUsageLimitError) throw cause;
      if (cause instanceof ResearchProviderError) throw cause;

      const timedOut = timeoutController.signal.aborted;
      const error = new ResearchProviderError(
        timedOut ? `${options.provider} request timed out.` : `${options.provider} request failed.`,
        {
          code: timedOut ? 'TIMEOUT' : 'UPSTREAM',
          provider: options.provider,
          retryable: true,
          cause: isAbortError(cause) || cause instanceof Error ? cause : undefined,
        },
      );
      if (attempt >= attempts) throw error;
      await wait(attempt * 1_000, options.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new ResearchProviderError(`${options.provider} request failed.`, {
    code: 'UPSTREAM',
    provider: options.provider,
    retryable: true,
  });
}
