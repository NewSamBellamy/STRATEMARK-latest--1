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

const KEY = 'ledger';
const HISTORY = 'history';

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

  async reserve(day: string, ip: string, amount: number, budgetMicros: number, visitorBudgetMicros: number) {
    const current = await this.load();
    await this.rollover(current, day);
    const result = tryReserve(current, day, ip, amount, budgetMicros, visitorBudgetMicros);
    // A refused call changes nothing, so it writes nothing (a flood of refused calls used to rewrite the whole ledger each time).
    // The first call of a new day does change the ledger, refused or not: it starts that day's.
    if (result.ledger !== current) await this.ctx.storage.put(KEY, result.ledger);
    // `day` is the day the hold was put on, which is the ledger's day when the caller's was older: settle on that one.
    return result.ok ? { ok: true as const, day: result.ledger.day } : { ok: false as const, reason: result.reason };
  }

  async settle(day: string, ip: string, held: number, actual: number): Promise<void> {
    const current = await this.load();
    await this.rollover(current, day); // a call that straddled midnight
    await this.ctx.storage.put(KEY, settle(current, day, ip, held, actual));
  }

  async status(day: string): Promise<{ spentMicros: number; heldMicros: number; visitors: number; history: DaySummary[] }> {
    const ledger = await this.load();
    const history = (await this.ctx.storage.get<DaySummary[]>(HISTORY)) ?? [];
    const today = ledger.day === day;
    return {
      spentMicros: today ? ledger.spentMicros : 0,
      heldMicros: today ? ledger.heldMicros : 0,
      visitors: today ? Object.keys(ledger.visitors).length : 0,
      // A finished day not yet rolled (no call since midnight) still shows.
      history: today || !ledger.day ? history.slice(0, 7) : rollHistory(history, ledger).slice(0, 7),
    };
  }
}
