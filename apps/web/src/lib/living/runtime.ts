/**
 * LivingDeckRuntime — the loop that makes an open deck research itself.
 *
 * Mental model: every company card has a desk agent whose job is "keep my
 * company's figures current and defensible." While the deck is open, the
 * runtime gives one desk at a time a turn to act, in strict priority order:
 *
 *   1. RESOLVE DOUBT — cross-metric consistency findings (shares summing past
 *      100%, valuation below ARR…) name the figures most likely to be wrong;
 *      re-verify those first.
 *   2. REFRESH DECAY — the freshness engine (@mi/contracts) ranks every stored
 *      figure by overdue-ness; verify the single most-decayed one.
 *   3. REST — nothing due: idle quietly and re-check on a slow cadence.
 *
 * Cost discipline (deliberate, not incidental):
 *   - ONE action per tick, ticks paced by `intervalMs` (default 15s ≈ 4/min)
 *   - a hard `maxActions` budget per session — the loop rests when spent
 *   - verification is skipped entirely on transports without live research
 *
 * The class is framework-free and fully dependency-injected (clock included),
 * so the scheduling policy is unit-testable without React, timers, or Gemini.
 */

export type LivingActionKind =
  'started' | 'verified' | 'corrected' | 'finding' | 'resting' | 'error';

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

export interface LivingDeckDeps {
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
    | ((
        target: VerificationTarget,
      ) => Promise<{ changed: boolean; citations: number; summary: string }>)
    | null;
  onEvent(event: AgentActivityEvent): void;
  now?: () => number;
  /** Pacing between verification actions. */
  intervalMs?: number;
  /** Re-check cadence while resting. */
  idleIntervalMs?: number;
  /** Hard per-session verification budget. */
  maxActions?: number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
}

export type LivingStatus = 'stopped' | 'running' | 'paused' | 'resting';

export class LivingDeckRuntime {
  private deps: Required<
    Pick<
      LivingDeckDeps,
      'now' | 'intervalMs' | 'idleIntervalMs' | 'maxActions' | 'setTimer' | 'clearTimer'
    >
  > &
    LivingDeckDeps;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;
  private actionsTaken = 0;
  private statusValue: LivingStatus = 'stopped';
  /** In-flight guard: never overlap actions. */
  private acting = false;

  constructor(deps: LivingDeckDeps) {
    this.deps = {
      now: () => Date.now(),
      // 10s between verifications ≈ 6/min — fast enough that a birth audit of
      // a fresh deck visibly self-corrects within the first minutes.
      intervalMs: 10_000,
      idleIntervalMs: 60_000,
      maxActions: 60,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t),
      ...deps,
    };
  }

  get status(): LivingStatus {
    return this.statusValue;
  }

  get actionCount(): number {
    return this.actionsTaken;
  }

  start(deskCount: number): void {
    if (this.statusValue === 'running') return;
    this.statusValue = 'running';
    this.emit('started', null, `Live research on — ${deskCount} company desks watching this deck.`);
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
    this.clear();
  }

  private clear(): void {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private schedule(ms: number): void {
    this.clear();
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
      const plan = this.deps.plan(this.deps.now());

      // Surface fresh audit findings even when we cannot act on them.
      for (const finding of plan.freshFindings) {
        this.emit('finding', null, finding.message, { severity: finding.severity });
      }

      const verifyTarget = this.deps.verify
        ? (plan.consistencyTargets[0] ?? plan.staleTargets[0] ?? null)
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
            'verified',
            verifyTarget.companyName,
            `${verifyTarget.companyName} desk re-verified ${verifyTarget.metricLabel} — ${
              verifyTarget.reason === 'consistency' ? 'consistency check' : 'freshness sweep'
            }: ${result.summary}`,
            { citations: result.citations },
          );
        }
        this.schedule(this.deps.intervalMs);
        return;
      }

      // Nothing to do: rest and re-check slowly.
      if (this.statusValue !== 'resting') {
        this.statusValue = 'resting';
        this.emit('resting', null, 'All tracked figures are fresh — watching for decay.');
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
