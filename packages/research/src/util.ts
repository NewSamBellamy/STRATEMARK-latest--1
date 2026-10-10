/** Small dependency-free orchestration helpers for the pipeline. */

export class AbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortError();
}

/**
 * Abortable delay.
 *
 * The abort listener is removed on BOTH exit paths. It previously leaked one
 * listener per call — invisible in a short run, unbounded in a long-lived
 * "keep researching" loop that sleeps between passes, which is exactly the
 * workload this engine is built for.
 */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export interface RetryableError extends Error {
  status?: number;
}

/**
 * Upper bound on a single honored `Retry-After`. The header is server-supplied
 * and occasionally enormous (a `Retry-After: 300` is 5 minutes); honoring it
 * verbatim silently parks a research run for longer than any user will wait.
 * We respect the server's intent up to a ceiling, then fail fast instead.
 */
export const MAX_RETRY_AFTER_MS = 90_000;

/**
 * Retry with exponential backoff + jitter. Retries on 429 (rate limit) and 5xx,
 * respecting an optional Retry-After (ms) carried on the error.
 *
 * Two bounds, both deliberate: `retries` caps the number of attempts, and
 * `maxTotalMs` caps total wall time. Attempt-count alone is not enough — four
 * retries behind a large Retry-After can still burn minutes.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    retries?: number;
    baseDelayMs?: number;
    signal?: AbortSignal;
    /** Total wall-clock budget across all attempts. Default 120s. */
    maxTotalMs?: number;
    /** Observes every retry sleep (Retry-After / backoff) as it starts. */
    onRetryWait?: (waitMs: number) => void;
  } = {},
): Promise<T> {
  const retries = opts.retries ?? 4;
  const base = opts.baseDelayMs ?? 1200;
  const maxTotalMs = opts.maxTotalMs ?? 120_000;
  const startedAt = Date.now();
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as RetryableError).status;
      const retryable = status === 429 || (status !== undefined && status >= 500);
      if (!retryable || attempt >= retries) throw err;

      const retryAfter = (err as RetryableError & { retryAfterMs?: number }).retryAfterMs;
      const delay =
        retryAfter !== undefined
          ? Math.min(retryAfter, MAX_RETRY_AFTER_MS)
          : base * 2 ** attempt + Math.random() * 400;

      // Don't start a wait we know will blow the budget.
      if (Date.now() - startedAt + delay > maxTotalMs) throw err;

      attempt += 1;
      opts.onRetryWait?.(delay);
      await sleep(delay, opts.signal);
    }
  }
}

/** Run `fn` over `items` with bounded concurrency, preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      throwIfAborted(signal);
      const index = cursor++;
      results[index] = await fn(items[index] as T, index);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/** Extract a clean root domain from a URL or bare host. */
export function rootDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const host = input.includes('://') ? new URL(input).hostname : input.trim();
    return host.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Best-effort JSON extraction from a model response that may wrap JSON in prose/fences. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  // Try direct parse, then the first {...} / [...] block.
  try {
    return JSON.parse(candidate);
  } catch {
    const match = candidate.match(/[{[][\s\S]*[}\]]/);
    if (match) return JSON.parse(match[0]);
    throw new Error('No JSON found in model response');
  }
}

/**
 * Proactive rate limiter (sliding window) — the difference between "rate limited
 * right away" and a run that just works.
 *
 * The Gemini free tier caps requests per MINUTE (measured 2026-07: 15 RPM on the
 * flash line, 30 on flash-lite) far more tightly than per day (1,500 RPD). A
 * 10-company deck is ~27 calls, so daily volume is never the problem — bursting
 * is. With fan-out concurrency we would fire a dozen calls in a second, eat a
 * wall of 429s, and then sit in exponential backoff, which reads to the user as
 * "slow and flaky".
 *
 * So we pace *before* sending rather than apologising afterwards. Reactive
 * `withRetry` stays as the safety net for genuine spikes.
 */
export interface RateLimiter {
  acquire(signal?: AbortSignal): Promise<void>;
}

export function createRateLimiter(requestsPerMinute: number): RateLimiter {
  const windowMs = 60_000;
  const limit = Math.max(1, requestsPerMinute);
  const sent: number[] = [];
  // Serialize waiters so N callers don't all wake and burst through together.
  let chain: Promise<void> = Promise.resolve();

  async function reserve(signal?: AbortSignal): Promise<void> {
    for (;;) {
      throwIfAborted(signal);
      const now = Date.now();
      while (sent.length && now - sent[0]! >= windowMs) sent.shift();
      if (sent.length < limit) {
        sent.push(now);
        return;
      }
      // Wait until the oldest call leaves the window (+ a little slack).
      await sleep(windowMs - (now - sent[0]!) + 60, signal);
    }
  }

  return {
    acquire(signal) {
      const next = chain.then(() => reserve(signal));
      // Keep the chain alive even if one waiter aborts.
      chain = next.catch(() => undefined);
      return next;
    },
  };
}
