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

/** Models return bare hosts ("rillet.com", "www.x.com"), but every official-host
 * gate parses websiteUrl with `new URL`. A bare host silently failed all of them,
 * so a company's own site never counted as its own site. Full URLs pass through. */
export function websiteUrlOf(input: string | null | undefined): string | null {
  const value = input?.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.includes('://') || /\s/.test(value)) return null;
  try {
    const url = new URL(`https://${value}`);
    return url.hostname.includes('.') ? url.href.replace(/\/$/, '') : null;
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
  /** `urgent`: a call the user is waiting on, served ahead of queued bulk work. */
  acquire(signal?: AbortSignal, priority?: CallPriority): Promise<void>;
  /**
   * How a call this limiter admitted turned out. A limiter built with a `ceiling` learns the key's real rate from it:
   * it speeds up while calls succeed and backs off when one is rate-limited. Without a ceiling this does nothing.
   */
  feedback(outcome: 'ok' | 'rate-limited'): void;
  /** The cap in force right now (it moves only for a limiter with a ceiling). */
  currentLimit(): number;
}

/** A limiter with a ceiling starts at its base rate and may rise by this factor each full minute it is saturated and unthrottled. */
const RAMP_FACTOR = 1.5;
/** After a rate limit the limiter stays at the lowered rate this long before it tries to rise again. */
const RAMP_HOLD_MS = 5 * 60_000;

/**
 * Pacing priority. A deck's bulk work (hydration, face hunts, dashboard
 * warm-up) can queue minutes of calls at the free-tier rate; a handful of
 * calls that would otherwise wait behind all of it — market signals — take
 * `urgent` so they are not starved. Never use it for bulk work.
 */
export type CallPriority = 'normal' | 'urgent';

export function createRateLimiter(requestsPerMinute: number, options: { ceiling?: number } = {}): RateLimiter {
  const windowMs = 60_000;
  const base = Math.max(1, requestsPerMinute);
  const ceiling = Math.max(base, options.ceiling ?? base);
  let limit = base;
  let holdUntil = 0;
  let lastRampAt = Date.now();
  // Headroom only an urgent call may use. Without it a burst of bulk calls fills the whole window and the
  // person's question (a compare) waits for the oldest bulk call to leave it: up to a full minute, however
  // urgent it is. Bulk work gives up about a tenth of the cap; the cap itself is never exceeded.
  const reserveOf = (cap: number) => (cap >= 4 ? Math.max(1, Math.round(cap * 0.1)) : 0);
  const sent: number[] = [];
  // One queue, served in order (urgent first), so N callers never all wake
  // and burst through together.
  const waiting: Array<{ urgent: boolean; grant: () => void }> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function pump(): void {
    if (timer) { clearTimeout(timer); timer = null; }
    const now = Date.now();
    while (sent.length && now - sent[0]! >= windowMs) sent.shift();
    for (;;) {
      const urgent = waiting.findIndex((w) => w.urgent);
      // An urgent call may use the whole cap; bulk calls stop short of the reserve.
      const bulkLimit = limit - reserveOf(limit);
      const at = urgent >= 0 ? (sent.length < limit ? urgent : -1) : (waiting.length && sent.length < bulkLimit ? 0 : -1);
      if (at < 0) break;
      const [next] = waiting.splice(at, 1);
      sent.push(now);
      next!.grant();
    }
    // Full: wake when the oldest call leaves the window (+ a little slack).
    if (waiting.length) timer = setTimeout(pump, windowMs - (now - sent[0]!) + 60);
  }

  return {
    currentLimit: () => limit,
    feedback(outcome) {
      if (ceiling <= base) return;
      const now = Date.now();
      if (outcome === 'rate-limited') {
        limit = Math.max(base, Math.floor(limit * 0.6));
        holdUntil = now + RAMP_HOLD_MS;
        lastRampAt = now;
        return;
      }
      // Rise only after a full minute, outside a hold, and only when the queue is really using the cap:
      // a quiet limiter has learned nothing about what the key allows.
      const saturated = waiting.length > 0 || sent.length >= limit * 0.8;
      if (limit < ceiling && now >= holdUntil && now - lastRampAt >= windowMs && saturated) {
        limit = Math.min(ceiling, Math.ceil(limit * RAMP_FACTOR));
        lastRampAt = now;
        pump();
      }
    },
    acquire(signal, priority = 'normal') {
      throwIfAborted(signal);
      return new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          const at = waiting.indexOf(entry);
          if (at >= 0) waiting.splice(at, 1);
          reject(new AbortError());
        };
        const entry = { urgent: priority === 'urgent', grant: () => { signal?.removeEventListener('abort', onAbort); resolve(); } };
        signal?.addEventListener('abort', onAbort, { once: true });
        waiting.push(entry);
        // A pending timer means the window is full for bulk work until it fires; an urgent call may still fit.
        if (!timer || entry.urgent) pump();
      });
    },
  };
}
