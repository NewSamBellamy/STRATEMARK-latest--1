/**
 * LivingDeckRuntime — the loop that makes an open deck research itself.
 *
 * Mental model: every company card has a desk agent whose job is "keep my
 * company's figures current and defensible." While the deck is open, the
 * runtime gives one desk at a time a turn to act, in strict priority order:
 *
 *   0. RECOVER GAPS — one bounded company hunt for absent core profile figures.
 *   1. RESOLVE DOUBT — cross-metric consistency findings (shares summing past
 *      100%, valuation below ARR…) name the figures most likely to be wrong;
 *      re-verify those first.
 *   2. REFRESH DECAY — the freshness engine (@mi/contracts) ranks every stored
 *      figure by overdue-ness; verify the single most-decayed one.
 *   3. WARM THE ROOM — pre-research dashboard tabs the user hasn't opened yet
 *      so "View more" is instant instead of a 30-second spinner.
 *   4. REST — nothing due: idle quietly and re-check on a slow cadence.
 *
 * Cost discipline (deliberate, not incidental):
 *   - ONE action per tick, ticks paced by `intervalMs` (default 15s ≈ 4/min)
 *   - a hard `maxActions` budget per session — the loop rests when spent
 *   - verification is skipped entirely on transports without live research;
 *     prefetching still runs (cache-warm only, no extra spend once cached)
 *
 * The class is framework-free and fully dependency-injected (clock included),
 * so the scheduling policy is unit-testable without React, timers, or Gemini.
 */

/**
 * Page-hidden timer throttling (1s clamp, then ~1/min under intensive
 * throttling) was stalling the desks whenever the deck tab lost focus — the
 * "why does operation keep stopping" class of failure. Timers inside a
 * dedicated Worker are NOT throttled by page visibility, so the tick cadence
 * survives backgrounding. One shared Worker backs every runtime; engines
 * without Worker support (tests, old webviews) fall back to setTimeout and
 * the runtime's visibility catch-up covers the rest.
 */
const TICKER_WORKER_SOURCE = `
const pending = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, at] of pending) {
    if (now >= at) { pending.delete(id); postMessage(id); }
  }
}, 250);
onmessage = (e) => { pending.set(e.data.id, Date.now() + e.data.ms); };
`;

interface ThrottleProofTicker {
  schedule(fn: () => void, ms: number): () => void;
}

let sharedTicker: ThrottleProofTicker | null = null;

function throttleProofTicker(): ThrottleProofTicker | null {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return null;
  if (sharedTicker) return sharedTicker;
  try {
    const pending = new Map<number, () => void>();
    let nextId = 1;
    const worker = new Worker(
      URL.createObjectURL(new Blob([TICKER_WORKER_SOURCE], { type: 'text/javascript' })),
    );
    worker.onmessage = (e: MessageEvent<number>) => {
      const fn = pending.get(e.data);
      pending.delete(e.data);
      fn?.();
    };
    worker.onerror = () => { /* ticks fall back to the visibility catch-up */ };
    sharedTicker = {
      schedule(fn, ms) {
        const id = nextId++;
        pending.set(id, fn);
        worker.postMessage({ id, ms });
        return () => { pending.delete(id); };
      },
    };
    return sharedTicker;
  } catch {
    return null;
  }
}

export type LivingActionKind =
  | 'started'
  | 'verified'
  | 'checked'
  | 'corrected'
  | 'hunted'
  | 'hunting'
  | 'prefetched'
  | 'finding'
  | 'resting'
  | 'error';

export interface AgentActivityEvent {
  id: number;
  at: number;
  kind: LivingActionKind;
  /** Which desk acted; null for deck-level events (audit findings, rest). */
  companyName: string | null;
  /** Feed-ready human sentence. */
  message: string;
  /** Source count backing the action, for the "· N sources" suffix. */
  citations?: number;
  severity?: 'warning' | 'critical';
}

export interface VerificationTarget {
  companyId: string;
  companyName: string;
  metricType: string;
  metricLabel: string;
  /** Why this target is queued — shown in the feed. */
  reason: 'consistency' | 'stale';
}

export interface PrefetchTarget {
  companyId: string;
  companyName: string;
  tab: string;
  tabLabel: string;
}

export interface RecoveryTarget {
  companyId: string;
  companyName: string;
}

export interface LivingDeckDeps {
  /** Readiness gate for automatic work only; deferral spends no action budget. */
  canAct?(): Promise<boolean>;
  /** Caller enforces per-company attempt limits, including failures/remounts. */
  nextRecovery?(): RecoveryTarget | null;
  recover?: ((target: RecoveryTarget) => Promise<{ filled: number }>) | null;
  /** Recompute the audit + stale queue. Called at most once per tick. */
  plan(nowMs: number): {
    /** Doubt first: findings-driven targets, most severe first. */
    consistencyTargets: VerificationTarget[];
    /** Decay second: freshness-driven targets, most overdue first. */
    staleTargets: VerificationTarget[];
    /** New findings to surface (already-seen ones filtered by the caller). */
    freshFindings: Array<{ message: string; severity: 'warning' | 'critical' }>;
  };
  /** Live re-verification write path. Null when the transport can't research. */
  verify:
    | ((target: VerificationTarget) => Promise<{ changed: boolean; citations: number; summary: string }>)
    | null;
  /** Warm the next cold dashboard tab; null when everything is warm. */
  nextPrefetch(): PrefetchTarget | null;
  prefetch(target: PrefetchTarget): Promise<void>;
  onEvent(event: AgentActivityEvent): void;
  now?: () => number;
  /** Pacing between verification actions. */
  intervalMs?: number;
  /** Pacing after a prefetch (cheaper than verification, so faster). */
  prefetchIntervalMs?: number;
  /** Re-check cadence while resting. */
  idleIntervalMs?: number;
  /** Hard per-session action budget (hunts + verifications + prefetches). */
  maxActions?: number;
  /** Timer handle is opaque — the default scheduler may not be setTimeout. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export type LivingStatus = 'stopped' | 'running' | 'paused' | 'resting';

export class LivingDeckRuntime {
  private deps: Required<
    Pick<
      LivingDeckDeps,
      'now' | 'intervalMs' | 'prefetchIntervalMs' | 'idleIntervalMs' | 'maxActions' | 'setTimer' | 'clearTimer'
    >
  > &
    LivingDeckDeps;
  private timer: unknown = null;
  private nextId = 1;
  private actionsTaken = 0;
  private statusValue: LivingStatus = 'stopped';
  /** In-flight guard: never overlap actions. */
  private acting = false;

  constructor(deps: LivingDeckDeps) {
    const ticker = throttleProofTicker();
    this.deps = {
      now: () => Date.now(),
      // 10s between verifications ≈ 6/min — fast enough that a birth audit of
      // a fresh deck visibly self-corrects within the first minutes.
      intervalMs: 10_000,
      prefetchIntervalMs: 5_000,
      idleIntervalMs: 60_000,
      maxActions: 60,
      // Worker-backed default keeps the cadence alive in background tabs; the
      // cancel closure doubles as the opaque timer handle.
      setTimer: ticker
        ? (fn, ms) => ticker.schedule(fn, ms)
        : (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => {
        if (typeof t === 'function') (t as unknown as () => void)();
        else clearTimeout(t as ReturnType<typeof setTimeout>);
      },
      ...deps,
    };
  }

  get status(): LivingStatus {
    return this.statusValue;
  }

  get actionCount(): number {
    return this.actionsTaken;
  }

  start(deskCount: number, liveResearch = true): void {
    if (this.statusValue === 'running') return;
    this.statusValue = 'running';
    this.emit('started', null, liveResearch
      ? `Live research on — ${deskCount} company desks watching this deck.`
      : `Dashboard warming on — ${deskCount} company desks; live research unavailable.`);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    // First action almost immediately; pacing applies between actions.
    this.schedule(400);
  }

  pause(): void {
    if (this.statusValue === 'stopped') return;
    this.statusValue = 'paused';
    this.clear();
  }

  resume(): void {
    if (this.statusValue !== 'paused') return;
    this.statusValue = 'running';
    this.schedule(400);
  }

  stop(): void {
    this.statusValue = 'stopped';
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.clear();
  }

  /**
   * Backstop for engines without Worker timers: a throttled background tab
   * can leave the next tick minutes late. The moment the tab is shown again,
   * run the overdue turn instead of waiting out the throttled timer.
   */
  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') return;
    if (this.statusValue !== 'running' && this.statusValue !== 'resting') return;
    if (this.acting) return;
    void this.tick();
  };

  private clear(): void {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private schedule(ms: number): void {
    this.clear();
    if (this.statusValue === 'paused' || this.statusValue === 'stopped') return;
    this.timer = this.deps.setTimer(() => {
      void this.tick();
    }, ms);
  }

  private emit(
    kind: LivingActionKind,
    companyName: string | null,
    message: string,
    extra?: { citations?: number; severity?: 'warning' | 'critical' },
  ): void {
    this.deps.onEvent({
      id: this.nextId++,
      at: this.deps.now(),
      kind,
      companyName,
      message,
      ...extra,
    });
  }

  /** One turn: exactly one action, then re-schedule. */
  private async tick(): Promise<void> {
    if (this.statusValue !== 'running' && this.statusValue !== 'resting') return;
    if (this.acting) return;

    if (this.actionsTaken >= this.deps.maxActions) {
      this.statusValue = 'resting';
      this.emit(
        'resting',
        null,
        'Research budget for this session is spent — resting. Reopen the deck to continue.',
      );
      this.clear();
      return;
    }

    this.acting = true;
    try {
      if (this.deps.canAct) {
        const ready = await this.deps.canAct();
        // Pause/stop may occur while the readiness read is in flight.
        if (!['running', 'resting'].includes(this.statusValue)) return;
        if (!ready) {
          if (this.statusValue !== 'resting') {
            this.statusValue = 'resting';
            this.emit('resting', null, 'Automatic research deferred — waiting for initial deck research readiness.');
          }
          this.schedule(this.deps.idleIntervalMs);
          return;
        }
      }
      const plan = this.deps.plan(this.deps.now());

      // Surface fresh audit findings even when we cannot act on them.
      for (const finding of plan.freshFindings) {
        this.emit('finding', null, finding.message, { severity: finding.severity });
      }

      const recoveryTarget = this.deps.recover ? this.deps.nextRecovery?.() : null;
      if (recoveryTarget && this.deps.recover) {
        this.statusValue = 'running';
        this.emit('hunting', recoveryTarget.companyName,
          `${recoveryTarget.companyName} desk is hunting missing figures — research in progress.`);
        const result = await this.deps.recover(recoveryTarget);
        this.actionsTaken += 1;
        this.emit('hunted', recoveryTarget.companyName,
          result.filled > 0
            ? `${recoveryTarget.companyName} desk: Filled ${result.filled} soft figure${result.filled === 1 ? '' : 's'} from live sources.`
            : `${recoveryTarget.companyName} desk hunted missing figures — nothing met the sourcing bar; gaps remain unknown.`);
        this.schedule(this.deps.intervalMs);
        return;
      }

      const verifyTarget = this.deps.verify
        ? plan.consistencyTargets[0] ?? plan.staleTargets[0] ?? null
        : null;

      if (verifyTarget && this.deps.verify) {
        this.statusValue = 'running';
        const result = await this.deps.verify(verifyTarget);
        this.actionsTaken += 1;
        if (result.changed) {
          this.emit(
            'corrected',
            verifyTarget.companyName,
            `${verifyTarget.companyName} desk corrected ${verifyTarget.metricLabel}: ${result.summary}`,
            { citations: result.citations },
          );
        } else {
          this.emit(
            'checked',
            verifyTarget.companyName,
            `${verifyTarget.companyName} desk checked ${verifyTarget.metricLabel} — ${
              verifyTarget.reason === 'consistency' ? 'consistency check' : 'freshness sweep'
            }: ${result.summary}`,
            { citations: result.citations },
          );
        }
        this.schedule(this.deps.intervalMs);
        return;
      }

      const prefetchTarget = this.deps.nextPrefetch();
      if (prefetchTarget) {
        this.statusValue = 'running';
        await this.deps.prefetch(prefetchTarget);
        this.actionsTaken += 1;
        this.emit(
          'prefetched',
          prefetchTarget.companyName,
          `${prefetchTarget.companyName} desk pre-researched the ${prefetchTarget.tabLabel} tab — it will open instantly.`,
        );
        this.schedule(this.deps.prefetchIntervalMs);
        return;
      }

      // Nothing to do: rest and re-check slowly.
      if (this.statusValue !== 'resting') {
        this.statusValue = 'resting';
        this.emit('resting', null, 'No further automatic research queued — unresolved gaps may remain.');
      }
      this.schedule(this.deps.idleIntervalMs);
    } catch (err) {
      this.actionsTaken += 1; // failures spend budget too — no hot error loops
      this.emit('error', null, `A research turn failed and was skipped: ${(err as Error).message}`);
      this.schedule(this.deps.intervalMs);
    } finally {
      this.acting = false;
    }
  }
}
