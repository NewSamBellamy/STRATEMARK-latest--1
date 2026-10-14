/**
 * Dashboard warm-up — every company in a deck gets its research tabs
 * (Overview, History, Team, Products, News) researched and cached in the
 * background, so opening a dashboard is instant.
 *
 * The scheduler owns ORDER and RESTRAINT only. The research itself is the
 * caller's `research` function, which in the repository is getDashboardTab —
 * the exact path a tab takes when a user opens it, with the same integrity
 * gates and the same in-flight dedupe. There is no second research path.
 *
 * Restraint:
 *  - bounded concurrency (companies in flight); each company's tabs run one
 *    at a time, and every call still goes through the client's rate limiter;
 *  - `canRun` gates every tab (spending cap, user pause, a deck being built);
 *  - priority: creation > deck open > startup backfill, then highest tier
 *    first, then the order the company was queued;
 *  - resumable: a cached tab is never redone, and every attempt is recorded
 *    (persisted by the caller) with a timestamp, so a reload mid-warm-up picks
 *    up where it stopped;
 *  - no loops: a failed or empty attempt backs off exponentially and stops
 *    after a few tries. Nothing re-queues itself; only an explicit enqueue
 *    (deck created, deck opened, app start) re-evaluates a company.
 */
import type { DashboardTab } from '@mi/contracts';

/** Tabs worth warming, in reading order. 'metrics' is a free local projection
 * (never cached), 'research' reads local evidence, 'live_landing' is local. */
export const WARM_TABS = ['overview', 'history', 'team_org', 'products_roadmap', 'live_intel'] as const satisfies readonly DashboardTab[];
export type WarmTab = (typeof WARM_TABS)[number];

export type WarmPriority = 'creation' | 'open' | 'backfill';
const PRIORITY_RANK: Record<WarmPriority, number> = { creation: 0, open: 1, backfill: 2 };

export interface WarmAttempt {
  /** ISO time of the latest attempt. */
  at: string;
  outcome: 'filled' | 'empty' | 'failed';
  /** Attempts so far that did not fill the tab. */
  count: number;
}
export type WarmAttempts = Record<string, Partial<Record<WarmTab, WarmAttempt>>>;

/** A failure (timeout, provider error) retries sooner than a tab that came back empty. */
export const WARM_FAILED_BACKOFF_MS = 15 * 60_000;
export const WARM_EMPTY_BACKOFF_MS = 3 * 24 * 60 * 60_000;
/** After this many unfilled attempts the warm-up leaves the tab to the user. */
export const WARM_MAX_ATTEMPTS = 3;

export type CachedTabState = 'missing' | 'filled' | 'empty';

export interface DashboardWarmupDeps {
  /** What the cache holds for this tab right now. */
  cached(companyId: string, tab: WarmTab): { state: CachedTabState; at?: string | null };
  /** Research one tab (the on-open path). `force` re-researches an empty cache. */
  research(companyId: string, tab: WarmTab, force: boolean): Promise<unknown>;
  attempts(): WarmAttempts;
  recordAttempt(companyId: string, tab: WarmTab, attempt: WarmAttempt): Promise<void> | void;
  /** Quota / pause / busy gate, checked before every tab. */
  canRun(): boolean;
  /** Called after a company's tabs were walked (e.g. to store the founded year). */
  afterCompany?(companyId: string): Promise<void>;
  /** Companies in flight at once. */
  concurrency: number;
  now?: () => number;
  /** When `canRun` says no, look again after this long (0 = only on the next enqueue). */
  retryIdleMs?: number;
}

export interface WarmTarget {
  companyId: string;
  /** Maturity tier (8 = Titans); higher warms first, null last. */
  tier: number | null;
}

interface QueueEntry extends WarmTarget { priority: WarmPriority; seq: number }

/** Whether this tab is due for an attempt now; pure, exported for tests and the scoreboard. */
export function warmTabDue(
  cache: { state: CachedTabState; at?: string | null },
  attempt: WarmAttempt | undefined,
  now: number,
): { due: boolean; force: boolean } {
  if (cache.state === 'filled') return { due: false, force: false };
  if (cache.state === 'empty') {
    // An empty cache someone else produced (a user open) counts as one empty attempt.
    const last = attempt?.outcome === 'empty' ? attempt : { at: cache.at ?? new Date(now).toISOString(), outcome: 'empty' as const, count: 1 };
    if (last.count >= WARM_MAX_ATTEMPTS) return { due: false, force: false };
    const wait = WARM_EMPTY_BACKOFF_MS * 2 ** (last.count - 1);
    return { due: now - Date.parse(last.at) >= wait, force: true };
  }
  if (!attempt || attempt.outcome === 'filled') return { due: true, force: false };
  if (attempt.count >= WARM_MAX_ATTEMPTS) return { due: false, force: false };
  const base = attempt.outcome === 'empty' ? WARM_EMPTY_BACKOFF_MS : WARM_FAILED_BACKOFF_MS;
  return { due: now - Date.parse(attempt.at) >= base * 4 ** (attempt.count - 1), force: false };
}

export class DashboardWarmup {
  private readonly queue: QueueEntry[] = [];
  private readonly active = new Set<string>();
  private seq = 0;
  private running = 0;
  private idleWaiters: Array<() => void> = [];
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** Tabs the warm-up researched (for tests and diagnostics). */
  readonly researched: Array<{ companyId: string; tab: WarmTab }> = [];

  constructor(private readonly deps: DashboardWarmupDeps) {}

  private now(): number { return this.deps.now?.() ?? Date.now(); }

  /** Queue companies; a company already queued keeps its better priority. Returns how many are queued anew. */
  enqueue(targets: readonly WarmTarget[], priority: WarmPriority): number {
    if (this.stopped) return 0;
    let added = 0;
    for (const target of targets) {
      if (!target.companyId) continue;
      const existing = this.queue.find((entry) => entry.companyId === target.companyId);
      if (existing) {
        if (PRIORITY_RANK[priority] < PRIORITY_RANK[existing.priority]) existing.priority = priority;
        existing.tier = target.tier ?? existing.tier;
        continue;
      }
      if (this.active.has(target.companyId)) continue;
      if (!this.hasDueTab(target.companyId)) continue;
      this.queue.push({ ...target, priority, seq: this.seq++ });
      added += 1;
    }
    this.pump();
    return added;
  }

  /** Companies waiting (not yet started), in the order they will run. */
  pending(): string[] {
    return [...this.queue].sort(compareEntries).map((entry) => entry.companyId);
  }

  /** Resolves once nothing is queued or running (tests, shutdown). */
  idle(): Promise<void> {
    if (this.running === 0 && (this.queue.length === 0 || !this.deps.canRun())) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.settleIdle();
  }

  /** Re-check the gate (e.g. after a job finished or the user resumed). */
  kick(): void { this.pump(); }

  private hasDueTab(companyId: string): boolean {
    const attempts = this.deps.attempts()[companyId] ?? {};
    const now = this.now();
    return WARM_TABS.some((tab) => warmTabDue(this.deps.cached(companyId, tab), attempts[tab], now).due);
  }

  private pump(): void {
    if (this.stopped) return;
    while (this.running < Math.max(1, this.deps.concurrency) && this.queue.length > 0) {
      if (!this.deps.canRun()) {
        this.scheduleRetry();
        break;
      }
      this.queue.sort(compareEntries);
      const next = this.queue.shift()!;
      this.running += 1;
      this.active.add(next.companyId);
      void this.warmCompany(next)
        .catch(() => { /* warm-up never surfaces errors; tabs research on open */ })
        .finally(() => {
          this.running -= 1;
          this.active.delete(next.companyId);
          this.pump();
          this.settleIdle();
        });
    }
    this.settleIdle();
  }

  private scheduleRetry(): void {
    const wait = this.deps.retryIdleMs ?? 0;
    if (wait <= 0 || this.retryTimer) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.pump(); }, wait);
  }

  private settleIdle(): void {
    if (this.running > 0) return;
    if (this.queue.length > 0 && !this.stopped && this.deps.canRun()) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private async warmCompany(entry: QueueEntry): Promise<void> {
    for (const tab of WARM_TABS) {
      if (this.stopped) return;
      if (!this.deps.canRun()) {
        // Paused mid-company: put it back so the remaining tabs resume later.
        if (!this.queue.some((queued) => queued.companyId === entry.companyId)) this.queue.push(entry);
        this.scheduleRetry();
        break;
      }
      const previous = this.deps.attempts()[entry.companyId]?.[tab];
      const before = this.deps.cached(entry.companyId, tab);
      const { due, force } = warmTabDue(before, previous, this.now());
      if (!due) continue;
      // An empty cache with no record of ours already counts as one empty attempt (see warmTabDue).
      const prior = previous && previous.outcome !== 'filled' ? previous.count : before.state === 'empty' ? 1 : 0;
      let outcome: WarmAttempt['outcome'];
      try {
        await this.deps.research(entry.companyId, tab, force);
        this.researched.push({ companyId: entry.companyId, tab });
        const state = this.deps.cached(entry.companyId, tab).state;
        // Not cached after a successful answer: the company's figures moved
        // mid-pass (overview) — treat like a failure so it retries soon.
        outcome = state === 'filled' ? 'filled' : state === 'empty' ? 'empty' : 'failed';
      } catch {
        outcome = 'failed';
      }
      const count = outcome === 'filled' ? 0 : prior + 1;
      await this.deps.recordAttempt(entry.companyId, tab, { at: new Date(this.now()).toISOString(), outcome, count });
    }
    if (this.deps.afterCompany) {
      try { await this.deps.afterCompany(entry.companyId); } catch { /* best effort */ }
    }
  }
}

function compareEntries(a: QueueEntry, b: QueueEntry): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || (b.tier ?? -1) - (a.tier ?? -1)
    || a.seq - b.seq;
}
