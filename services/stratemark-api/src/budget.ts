/**
 * BudgetCounter — one Durable Object instance holds the day's spend ledger.
 *
 * A Durable Object handles its calls one at a time, so reserve/settle are
 * exact even under a burst of concurrent requests (KV counters are only
 * eventually consistent and can overshoot). Every Gemini call reserves its
 * worst-case cost before it starts and settles to the real cost after.
 */
import { DurableObject } from 'cloudflare:workers';
import { rollHistory, settle, tryReserve, type DaySummary, type LedgerDay } from './policy';
import { MAX_ALLOWANCE_VISITORS, reserveAllowance, settleAllowance, type LifetimeRecord } from './allowance';

const KEY = 'ledger';
const HISTORY = 'history';
/** Lifetime allowance: one record per visitor under `life:<id>`, and how many there are. Neither belongs to a day. */
const LIFE = 'life:';
const LIFE_COUNT = 'lifeCount';

/** A visitor's lifetime allowance for one call: who it belongs to (allowanceIdentity) and the ceiling in micro-dollars. */
export interface AllowanceCap { id: string; micros: number }

export class BudgetCounter extends DurableObject {
  private async load(): Promise<LedgerDay> {
    return (await this.ctx.storage.get<LedgerDay>(KEY)) ?? { day: '', spentMicros: 0, heldMicros: 0, visitors: {} };
  }

  /** When the UTC day changes, keep a one-line summary of the day that ended. A call that carries an older day than the ledger's ends nothing. */
  private async rollover(ledger: LedgerDay, day: string): Promise<void> {
    if (!ledger.day || ledger.day >= day) return;
    const history = (await this.ctx.storage.get<DaySummary[]>(HISTORY)) ?? [];
    await this.ctx.storage.put(HISTORY, rollHistory(history, ledger));
  }

  /**
   * `allowance` is given for hosted-key calls only (a visitor's own key never reaches here). The day's limits and the
   * lifetime allowance are decided together, and nothing is written unless both let the call through, so a call refused
   * by either holds nothing in the other. Over the allowance is `allowance` (permanent), which wins over a spent day.
   */
  async reserve(day: string, ip: string, amount: number, budgetMicros: number, visitorBudgetMicros: number, allowance?: AllowanceCap) {
    const current = await this.load();
    await this.rollover(current, day);
    const result = tryReserve(current, day, ip, amount, budgetMicros, visitorBudgetMicros);
    let life: { record: LifetimeRecord; known: boolean } | null = null;
    let refusal: { ok: false; reason: 'global' | 'visitor' | 'allowance-full' } | { ok: false; reason: 'allowance'; usedMicros: number } | null = result.ok ? null : { ok: false, reason: result.reason };
    if (allowance && (result.ok || result.reason === 'visitor')) {
      const existing = await this.ctx.storage.get<LifetimeRecord>(LIFE + allowance.id);
      const count = (await this.ctx.storage.get<number>(LIFE_COUNT)) ?? 0;
      if (!existing && count >= MAX_ALLOWANCE_VISITORS) {
        refusal = { ok: false, reason: 'allowance-full' }; // table full: fail closed, as the day's ledger does, with its own wording
      } else {
        const step = reserveAllowance(existing, amount, allowance.micros, Date.now());
        if (!step.ok) refusal = { ok: false, reason: 'allowance', usedMicros: step.usedMicros };
        else if (!refusal) life = { record: step.record, known: !!existing };
      }
    }
    // A refused call changes nothing, so it writes nothing (a flood of refused calls used to rewrite the whole ledger each time).
    // The first call of a new day does change the ledger, refused or not: it starts that day's.
    // A call the allowance refused must not leave the day's hold behind (tryReserve had admitted it): keep the day, drop the hold.
    const written: LedgerDay = refusal && result.ok
      ? (result.ledger.day === current.day ? current : { day: result.ledger.day, spentMicros: 0, heldMicros: 0, visitors: {} })
      : result.ledger;
    if (written !== current) await this.ctx.storage.put(KEY, written);
    if (refusal) return refusal;
    if (life && allowance) {
      await this.ctx.storage.put(LIFE + allowance.id, life.record);
      if (!life.known) await this.ctx.storage.put(LIFE_COUNT, ((await this.ctx.storage.get<number>(LIFE_COUNT)) ?? 0) + 1);
    }
    // `day` is the day the hold was put on, which is the ledger's day when the caller's was older: settle on that one.
    return { ok: true as const, day: result.ledger.day, ...(life ? { allowanceSpentMicros: life.record.spent } : {}) };
  }

  async settle(day: string, ip: string, held: number, actual: number, allowanceId?: string): Promise<void> {
    const current = await this.load();
    await this.rollover(current, day); // a call that straddled midnight
    const settled = settle(current, day, ip, held, actual);
    if (!allowanceId) { await this.ctx.storage.put(KEY, settled); return; }
    const existing = await this.ctx.storage.get<LifetimeRecord>(LIFE + allowanceId);
    const next = settleAllowance(existing, held, actual, Date.now());
    // One multi-key put, so a crash cannot leave the day's ledger and the allowance record out of step.
    if (next) { await this.ctx.storage.put({ [KEY]: settled, [LIFE + allowanceId]: next }); return; }
    await this.ctx.storage.put(KEY, settled);
    // Nothing spent and nothing held: no record (a visitor whose calls cost nothing takes no slot).
    if (existing) {
      await this.ctx.storage.delete(LIFE + allowanceId);
      await this.ctx.storage.put(LIFE_COUNT, Math.max(0, ((await this.ctx.storage.get<number>(LIFE_COUNT)) ?? 0) - 1));
    }
  }

  async status(day: string): Promise<{ spentMicros: number; heldMicros: number; visitors: number; allowanceVisitors: number; history: DaySummary[] }> {
    const ledger = await this.load();
    const kept = await this.ctx.storage.get<DaySummary[] | number>([HISTORY, LIFE_COUNT]);
    const history = (kept.get(HISTORY) as DaySummary[] | undefined) ?? [];
    const today = ledger.day === day;
    return {
      spentMicros: today ? ledger.spentMicros : 0,
      heldMicros: today ? ledger.heldMicros : 0,
      visitors: today ? Object.keys(ledger.visitors).length : 0,
      // How many visitors have a lifetime record: a count, never who.
      allowanceVisitors: (kept.get(LIFE_COUNT) as number | undefined) ?? 0,
      // A finished day not yet rolled (no call since midnight) still shows.
      history: today || !ledger.day ? history.slice(0, 7) : rollHistory(history, ledger).slice(0, 7),
    };
  }
}
