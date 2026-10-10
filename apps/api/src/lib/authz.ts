/**
 * Who is allowed to spend the service's money, and how fast.
 *
 * The distinction this module enforces: **browsing is free, spending is not.**
 * Guarding the whole app would make it hostile to try — and for a hackathon
 * submission judges must be able to test "free of charge and without
 * restrictions". Guarding nothing leaves a public endpoint attached to a
 * billable API key. So the app stays open and only the paths that cost money
 * ask who is paying.
 *
 * Three ways a request can be authorised:
 *
 *   1. It brings its own Gemini key   → always allowed. They pay, not us.
 *   2. It presents the app token      → allowed, and metered against the cap.
 *   3. Neither                        → 401, with an explanation of both routes.
 *
 * The app token is a single shared secret, generated at deploy time and handed
 * to the hosted web app and to judges in the testing instructions. It is not an
 * identity system — it is a revocable throttle on spending, which is the actual
 * problem to solve before launch. Real per-user auth is Firebase, post-hackathon.
 */
import type { ServiceEnv } from '../env';
import { sanitizeKey } from './client';

export const APP_TOKEN_HEADER = 'x-stratemark-token';

export type SpendAuthorization =
  /** Caller supplied their own key — their quota, not ours. Unmetered. */
  | { mode: 'caller-key'; metered: false }
  /** Valid app token — our credentials, so metered against the daily cap. */
  | { mode: 'app-token'; metered: true };

export class UnauthorizedSpendError extends Error {
  readonly status = 401;
  constructor(message?: string) {
    super(
      message || 'This endpoint spends real money, so it needs one of two things: ' +
        'your own Gemini key in X-Gemini-Key, or the service access token in X-Stratemark-Token.',
    );
    this.name = 'UnauthorizedSpendError';
  }
}

/**
 * Constant-time comparison. A plain `===` on a secret leaks its length and, in
 * principle, its prefix through timing — cheap to avoid, so avoid it.
 */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function authorizeSpend(input: {
  env: ServiceEnv;
  callerKey?: string | undefined;
  appToken?: string | undefined;
}): SpendAuthorization {
  if (sanitizeKey(input.callerKey)) return { mode: 'caller-key', metered: false };

  const expected = input.env.appToken;
  const presented = input.appToken?.trim();
  if (expected && presented && tokensMatch(expected, presented)) {
    return { mode: 'app-token', metered: true };
  }

  // No token configured is treated as "closed", not "open". Failing shut is the
  // only safe default for something attached to a billing account.
  throw new UnauthorizedSpendError();
}

// ─────────────────────────────────────────────────────────── rate limiting ──

export class RateLimitedError extends Error {
  readonly status = 429;
  constructor(retryAfterSeconds: number) {
    super(`Too many requests. Try again in ${retryAfterSeconds} seconds.`);
    this.name = 'RateLimitedError';
  }
}

interface Window {
  hits: number[];
}

/**
 * A sliding-window limiter keyed by caller.
 *
 * Per instance and in memory, like the budget — the goal is to blunt a script
 * hammering the endpoint, not to be a distributed quota system. Cloud Armor or
 * an API gateway is the real answer at scale.
 */
export class RateLimiter {
  private windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): void {
    const cutoff = now - this.windowMs;
    const w = this.windows.get(key) ?? { hits: [] };
    w.hits = w.hits.filter((t) => t > cutoff);

    if (w.hits.length >= this.limit) {
      const oldest = w.hits[0] ?? now;
      throw new RateLimitedError(Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)));
    }

    w.hits.push(now);
    this.windows.set(key, w);

    // Bound memory: a long-lived instance seeing many distinct callers would
    // otherwise accumulate a window per caller forever.
    if (this.windows.size > 5_000) {
      for (const [k, v] of this.windows) {
        if (v.hits.every((t) => t <= cutoff)) this.windows.delete(k);
      }
    }
  }

  reset(): void {
    this.windows.clear();
  }
}

/** Best-effort caller identity for rate limiting. Spoofable; good enough here. */
export function callerKeyFor(headers: {
  forwardedFor?: string | undefined;
  appToken?: string | undefined;
}): string {
  const ip = headers.forwardedFor?.split(',')[0]?.trim();
  return ip || headers.appToken?.slice(0, 12) || 'anonymous';
}
