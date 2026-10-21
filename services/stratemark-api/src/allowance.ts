/**
 * The lifetime allowance: how much hosted-key spend one beta visitor is covered for, in all, for ever.
 *
 * The daily ledger (policy.ts) resets every UTC midnight, so a $20-a-day limit alone lets one person spend $20 a day
 * without end. This is the other half: a running total per visitor that no rollover touches. Pure steps here (no Worker
 * globals, tested in Node); BudgetCounter keeps the records, one storage key per visitor, so a call reads and writes only
 * its own visitor's record and the day's ledger never carries lifetime totals.
 *
 * "A person" is a visitor address (an IPv4 address or an IPv6 /64, visitor.ts). That is imperfect on purpose and said so:
 * people behind one network share an allowance, and a person who changes network gets a fresh one. `allowanceIdentity`
 * is the one place that names who the allowance belongs to, so it can be swapped for a sign-in later without touching
 * the ledger.
 *
 * Only hosted-key spend counts. A visitor's own key is forwarded without a reservation at all, so it is never counted
 * and never blocked here.
 */
import { sha256Hex } from './share-policy';
import { visitorAddress } from './visitor';

/** One visitor's lifetime record, in micro-dollars. `at` is when a hold last went on (ms), used to drop a hold that leaked. */
export interface LifetimeRecord { spent: number; held: number; at: number }

/**
 * Most visitors the allowance table tracks. Past it a NEW visitor is refused (fail closed, the same as the daily ledger),
 * rather than the table growing without bound. A visitor whose calls cost nothing keeps no record, so a flood of addresses
 * that never spend cannot fill it.
 */
export const MAX_ALLOWANCE_VISITORS = 20_000;

/**
 * A hold with no settlement for this long is a leak (a crash between reserve and settle; the longest honest call is the
 * 120 second upstream timeout). It is dropped on the visitor's next reservation, so a leaked hold cannot eat a lifetime
 * allowance for ever. The window is far past any real call.
 */
export const STALE_HOLD_MS = 10 * 60_000;

/** Who the allowance belongs to. One function, so a sign-in can replace the address later. Stored hashed, never as an address. */
export async function allowanceIdentity(request: Request): Promise<string> {
  const address = visitorAddress(request.headers.get('cf-connecting-ip'));
  return (await sha256Hex(`stratemark-allowance:${address}`)).slice(0, 32);
}

export type AllowanceReserve =
  | { ok: true; record: LifetimeRecord }
  | { ok: false; record: LifetimeRecord | undefined; usedMicros: number };

/** Pure step: may this visitor's lifetime spend plus this hold stay within the allowance? A refused call changes nothing. */
export function reserveAllowance(record: LifetimeRecord | undefined, amount: number, allowanceMicros: number, nowMs: number): AllowanceReserve {
  const fresh = record && record.held > 0 && nowMs - record.at > STALE_HOLD_MS ? { ...record, held: 0 } : record;
  const spent = fresh?.spent ?? 0;
  const held = fresh?.held ?? 0;
  if (spent + held + amount > allowanceMicros) return { ok: false, record: fresh, usedMicros: spent + held };
  return { ok: true, record: { spent, held: held + amount, at: nowMs } };
}

/** Pure step: swap a hold for the call's actual cost. Nothing spent and nothing held leaves no record (undefined). */
export function settleAllowance(record: LifetimeRecord | undefined, held: number, actual: number, nowMs: number): LifetimeRecord | undefined {
  const spent = (record?.spent ?? 0) + actual;
  const stillHeld = Math.max(0, (record?.held ?? 0) - held);
  return spent > 0 || stillHeld > 0 ? { spent, held: stillHeld, at: record?.at ?? nowMs } : undefined;
}
