/**
 * The budget ledger Durable Object itself (BudgetCounter) on in-memory storage that counts its reads and writes: the days it
 * keeps, what a refused call writes, and what a call that carries the wrong day does.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
  },
}));

const { BudgetCounter } = await import('./budget');

function countedStorage() {
  const map = new Map<string, unknown>();
  const counters = { gets: 0, puts: 0 };
  return {
    map, counters,
    get: async (key: string) => { counters.gets += 1; return map.get(key); },
    put: async (key: string, value: unknown) => { counters.puts += 1; map.set(key, structuredClone(value)); },
  };
}

function makeCounter() {
  const storage = countedStorage();
  return { storage, counter: new BudgetCounter({ storage } as never, {} as never) };
}

const BUDGET = 100_000_000;
const VISITOR = 20_000_000;

describe('a call that carries a day older than the ledger\'s', () => {
  it('does not wipe the newer day: its hold goes on the day in progress, and settling releases it there (R2-W4)', async () => {
    const { counter } = makeCounter();
    expect(await counter.reserve('2026-10-20', '1.1.1.1', 5_000_000, BUDGET, VISITOR)).toEqual({ ok: true, day: '2026-10-20' });
    await counter.settle('2026-10-20', '1.1.1.1', 5_000_000, 4_000_000);
    expect(await counter.status('2026-10-20')).toMatchObject({ spentMicros: 4_000_000, heldMicros: 0, visitors: 1 });

    // A request whose day was read before midnight, delivered after.
    const late = await counter.reserve('2026-10-19', '2.2.2.2', 1_000, BUDGET, VISITOR);
    expect(late).toEqual({ ok: true, day: '2026-10-20' });
    expect(await counter.status('2026-10-20')).toMatchObject({ spentMicros: 4_000_000, heldMicros: 1_000, visitors: 2 });
    await counter.settle((late as { day: string }).day, '2.2.2.2', 1_000, 0);
    expect(await counter.status('2026-10-20')).toMatchObject({ spentMicros: 4_000_000, heldMicros: 0, visitors: 1 });
  });

  it('is still held to the day\'s budget: a spent day is not reopened by an old day', async () => {
    const { counter } = makeCounter();
    await counter.reserve('2026-10-20', '1.1.1.1', 90_000_000, BUDGET, BUDGET);
    await counter.settle('2026-10-20', '1.1.1.1', 90_000_000, 90_000_000);
    expect(await counter.reserve('2026-10-19', '2.2.2.2', 20_000_000, BUDGET, VISITOR)).toEqual({ ok: false, reason: 'global' });
  });

  it('does not roll the day in progress into the history as though it had ended', async () => {
    const { counter } = makeCounter();
    await counter.reserve('2026-10-20', '1.1.1.1', 5_000_000, BUDGET, VISITOR);
    await counter.settle('2026-10-20', '1.1.1.1', 5_000_000, 4_000_000);
    await counter.reserve('2026-10-19', '2.2.2.2', 1_000, BUDGET, VISITOR);
    await counter.settle('2026-10-19', '3.3.3.3', 1_000, 500); // a call that straddled midnight
    expect((await counter.status('2026-10-20')).history).toEqual([]);
  });

  it('still rolls a finished day into the history when the new day arrives', async () => {
    const { counter } = makeCounter();
    await counter.reserve('2026-10-19', '1.1.1.1', 5_000_000, BUDGET, VISITOR);
    await counter.settle('2026-10-19', '1.1.1.1', 5_000_000, 4_000_000);
    await counter.reserve('2026-10-20', '1.1.1.1', 1_000, BUDGET, VISITOR);
    expect((await counter.status('2026-10-20')).history).toEqual([{ day: '2026-10-19', spentUsd: 4, visitors: 1 }]);
  });
});
