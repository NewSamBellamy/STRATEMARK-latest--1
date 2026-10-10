/**
 * BudgetCounter — one Durable Object instance holds the day's spend ledger.
 *
 * A Durable Object handles its calls one at a time, so reserve/settle are
 * exact even under a burst of concurrent requests (KV counters are only
 * eventually consistent and can overshoot). Every Gemini call reserves its
 * worst-case cost before it starts and settles to the real cost after.
 */
import { DurableObject } from 'cloudflare:workers';
import { settle, tryReserve, type LedgerDay } from './policy';

const KEY = 'ledger';

export class BudgetCounter extends DurableObject {
  private async load(): Promise<LedgerDay> {
    return (await this.ctx.storage.get<LedgerDay>(KEY)) ?? { day: '', spentMicros: 0, heldMicros: 0, visitors: {} };
  }

  async reserve(day: string, ip: string, amount: number, budgetMicros: number, visitorBudgetMicros: number) {
    const result = tryReserve(await this.load(), day, ip, amount, budgetMicros, visitorBudgetMicros);
    await this.ctx.storage.put(KEY, result.ledger);
    return result.ok ? { ok: true as const } : { ok: false as const, reason: result.reason };
  }

  async settle(day: string, ip: string, held: number, actual: number): Promise<void> {
    await this.ctx.storage.put(KEY, settle(await this.load(), day, ip, held, actual));
  }

  async status(day: string): Promise<{ spentMicros: number; heldMicros: number }> {
    const ledger = await this.load();
    return ledger.day === day ? { spentMicros: ledger.spentMicros, heldMicros: ledger.heldMicros } : { spentMicros: 0, heldMicros: 0 };
  }
}
