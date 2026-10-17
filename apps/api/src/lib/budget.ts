/**
 * A hard ceiling on what the service can spend with ITS OWN credentials.
 *
 * Cloud Run's `--max-instances` bounds concurrency, not money. An open endpoint
 * backed by a shared API key will happily spend an entire credit pool in an
 * afternoon if someone finds the URL, and the first sign of it is the invoice.
 * So the service refuses to exceed a daily allowance and says so plainly.
 *
 * Only calls made on SERVER credentials count. A caller who brings their own
 * key is spending their own quota and is deliberately not metered here — that
 * is the whole point of the bring-your-own-key tier.
 *
 * HONEST LIMITATION: this counter lives in memory, so it is per instance. With
 * `--max-instances N` the true worst case is N × the cap. That is a bounded,
 * known number rather than an unbounded one, which is the property that
 * matters — but a Cloud Billing budget alert is still the backstop, and moving
 * the counter to Firestore is what makes the cap globally exact. See
 * apps/api/README.md.
 */

export interface BudgetState {
  /** UTC day the counters belong to, YYYY-MM-DD. */
  day: string;
  ground: number;
  structure: number;
  vision: number;
  /** Verification-class calls (LLM-as-judge), priced like grounded work. */
  judge: number;
}

export interface BudgetStatus {
  spentUsd: number;
  capUsd: number;
  groundedCalls: number;
  remainingUsd: number;
  exhausted: boolean;
}

/**
 * Per-call estimates from published list prices (2026-08), matching
 * apps/web/src/lib/usage.ts so the client and server agree on what things cost.
 */
export const EST_COST_USD = {
  ground: 0.04,
  structure: 0.002,
  vision: 0.002,
  judge: 0.04,
} as const;

export type SpendKind = keyof typeof EST_COST_USD;

/** Default daily allowance on server credentials, in US dollars. */
export const DEFAULT_DAILY_CAP_USD = 4;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export class DailyBudget {
  private state: BudgetState;

  constructor(private readonly capUsd: number = DEFAULT_DAILY_CAP_USD) {
    this.state = { day: today(), ground: 0, structure: 0, vision: 0, judge: 0 };
  }

  /** Roll the counters when the UTC day changes. */
  private roll(): void {
    const now = today();
    if (this.state.day !== now) {
      this.state = { day: now, ground: 0, structure: 0, vision: 0, judge: 0 };
    }
  }

  private spentUsd(): number {
    return (
      this.state.ground * EST_COST_USD.ground +
      this.state.structure * EST_COST_USD.structure +
      this.state.vision * EST_COST_USD.vision +
      this.state.judge * EST_COST_USD.judge
    );
  }

  status(): BudgetStatus {
    this.roll();
    const spent = this.spentUsd();
    return {
      spentUsd: Number(spent.toFixed(4)),
      capUsd: this.capUsd,
      groundedCalls: this.state.ground,
      remainingUsd: Number(Math.max(0, this.capUsd - spent).toFixed(4)),
      exhausted: spent >= this.capUsd,
    };
  }

  /**
   * Would starting a unit of work of this size stay inside the allowance?
   *
   * Checked BEFORE the work starts, using the estimated cost of the whole
   * operation rather than one call — a deck is ~27 requests, and discovering
   * the cap halfway through leaves the caller with a half-built deck and us
   * with the bill for it.
   */
  canAfford(estimatedUsd: number): boolean {
    this.roll();
    return this.spentUsd() + estimatedUsd <= this.capUsd;
  }

  record(kind: SpendKind, count = 1): void {
    this.roll();
    this.state[kind] += count;
  }

  /** Test seam. */
  reset(): void {
    this.state = { day: today(), ground: 0, structure: 0, vision: 0, judge: 0 };
  }
}

export class BudgetExhaustedError extends Error {
  readonly status = 429;
  constructor(readonly budget: BudgetStatus) {
    super(
      `This service has reached its daily spending limit of $${budget.capUsd.toFixed(2)} ` +
        `(estimated $${budget.spentUsd.toFixed(2)} used). ` +
        'Send your own Gemini key in X-Gemini-Key to continue immediately, or try again tomorrow.',
    );
    this.name = 'BudgetExhaustedError';
  }
}
