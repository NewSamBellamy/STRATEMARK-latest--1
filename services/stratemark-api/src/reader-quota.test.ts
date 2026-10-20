import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
  },
}));

const { ReaderQuota, READER_LIMITS_DEFAULT, takeReaderQuota } = await import('./reader-quota');

const LIMITS = { perMinute: 3, perDay: 5 };
const T0 = Date.parse('2026-10-19T10:00:10.000Z');

describe('how often one visitor may read', () => {
  it('lets a visitor read up to the minute limit, then says when to try again', () => {
    let state: ReturnType<typeof takeReaderQuota>['state'] | undefined;
    for (let i = 0; i < 3; i += 1) {
      const r = takeReaderQuota(state, T0 + i, LIMITS);
      expect(r.ok).toBe(true);
      state = r.state;
    }
    const refused = takeReaderQuota(state, T0 + 10, LIMITS);
    expect(refused).toMatchObject({ ok: false });
    if (!refused.ok) expect(refused.retryAfterSeconds).toBe(50); // 10:00:10 to 10:01:00
    // A refused read is not counted: the next minute starts clean.
    expect(takeReaderQuota(refused.state, T0 + 60_000, LIMITS)).toMatchObject({ ok: true });
  });

  it('stops at the day limit even when each minute is quiet, and starts clean at UTC midnight', () => {
    let state: ReturnType<typeof takeReaderQuota>['state'] | undefined;
    for (let i = 0; i < 5; i += 1) {
      const r = takeReaderQuota(state, T0 + i * 120_000, LIMITS);
      expect(r.ok).toBe(true);
      state = r.state;
    }
    const refused = takeReaderQuota(state, T0 + 900_000, LIMITS);
    expect(refused).toMatchObject({ ok: false });
    if (!refused.ok) expect(refused.retryAfterSeconds).toBe(Math.ceil((Date.parse('2026-10-20T00:00:00.000Z') - (T0 + 900_000)) / 1000));
    expect(takeReaderQuota(state, Date.parse('2026-10-20T00:00:01.000Z'), LIMITS)).toMatchObject({ ok: true });
  });

  it('is generous enough for a deck being made', () => {
    // 18 companies, a few hundred reads in three minutes, spread over a few minutes.
    let state: ReturnType<typeof takeReaderQuota>['state'] | undefined;
    let refused = 0;
    for (let i = 0; i < 400; i += 1) {
      const r = takeReaderQuota(state, T0 + i * 450, READER_LIMITS_DEFAULT);
      if (!r.ok) refused += 1;
      state = r.state;
    }
    expect(refused).toBe(0);
  });
});

describe('ReaderQuota', () => {
  function object() {
    const map = new Map<string, unknown>();
    let alarm: number | null = null;
    const storage = {
      map, get: async (key: string) => map.get(key), put: async (key: string, value: unknown) => { map.set(key, value); },
      deleteAll: async () => { map.clear(); alarm = null; }, setAlarm: async (t: number) => { alarm = t; }, alarmAt: () => alarm,
    };
    return { storage, quota: new ReaderQuota({ storage } as never, {} as never) as unknown as InstanceType<typeof ReaderQuota> };
  }

  it('counts for one visitor, refuses past the limit, and deletes itself when idle', async () => {
    const { storage, quota } = object();
    expect(await quota.take(T0, LIMITS)).toEqual({ ok: true });
    expect(await quota.take(T0, LIMITS)).toEqual({ ok: true });
    expect(await quota.take(T0, LIMITS)).toEqual({ ok: true });
    expect(await quota.take(T0, LIMITS)).toMatchObject({ ok: false });
    expect(storage.alarmAt()).toBe(T0 + 2 * 86_400_000);
    await quota.alarm();
    expect(storage.map.size).toBe(0);
  });
});
