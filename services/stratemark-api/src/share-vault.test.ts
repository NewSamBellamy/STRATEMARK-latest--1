import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Durable Object base class only exists inside the Workers runtime; the classes under test only use `this.ctx.storage`.
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
  },
}));

const { ShareVault, ShareQuota } = await import('./share-vault');
const { SHARE_LIMITS_DEFAULT } = await import('./share-policy');

/** Just enough of Durable Object storage: keys and batches, with the 128-key and 128 KiB limits enforced. */
function fakeStorage() {
  const map = new Map<string, unknown>();
  let alarm: number | null = null;
  const storage = {
    map,
    get: async (keys: string | string[]) => {
      if (Array.isArray(keys)) {
        if (keys.length > 128) throw new Error('too many keys');
        return new Map(keys.filter((k) => map.has(k)).map((k) => [k, map.get(k)]));
      }
      return map.get(keys);
    },
    put: async (a: string | Record<string, unknown>, b?: unknown) => {
      const entries = typeof a === 'string' ? { [a]: b } : a;
      if (storage.failOn && Object.keys(entries).some((key) => storage.failOn!(key))) throw new Error('storage failed');
      if (Object.keys(entries).length > 128) throw new Error('too many keys');
      for (const [k, v] of Object.entries(entries)) {
        if (typeof v === 'string' && v.length > 131_072) throw new Error('value too large');
        map.set(k, v);
      }
    },
    deleteAll: async () => { map.clear(); alarm = null; },
    deleteAlarm: async () => { alarm = null; },
    failOn: null as null | ((key: string) => boolean),
    setAlarm: async (t: number) => { alarm = t; },
    alarmAt: () => alarm,
  };
  return storage;
}

const META = { kind: 'deck' as const, title: 'T', description: 'D', viewer: 'https://app.example/share.html', createdAt: 1_000, expiresAt: 1_000 + 86_400_000, chunks: 0, hasOg: false, bytes: 0 };

function vault() {
  const storage = fakeStorage();
  return { storage, vault: new ShareVault({ storage } as never, {} as never) as unknown as InstanceType<typeof ShareVault> };
}

describe('ShareVault', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(2_000); });
  afterEach(() => { vi.useRealTimers(); });

  it('stores a large snapshot in pieces and reads it back byte for byte', async () => {
    const { vault: v, storage } = vault();
    const data = Array.from({ length: 5_000_000 / 10 }, (_unused, i) => String(i % 10).repeat(10)).join('');
    expect(await v.put({ meta: META, data, og: 'iVBORw0KGgoAAAA', tokenHash: 'hash' })).toBe(true);
    expect(await v.data()).toBe(data);
    expect(await v.og()).toBe('iVBORw0KGgoAAAA');
    expect((await v.meta())?.chunks).toBe(50);
    expect(storage.alarmAt()).toBe(META.expiresAt);
  });

  it('never overwrites an id that is taken', async () => {
    const { vault: v } = vault();
    expect(await v.put({ meta: META, data: 'a'.repeat(100), og: null, tokenHash: 'one' })).toBe(true);
    expect(await v.put({ meta: META, data: 'b'.repeat(100), og: null, tokenHash: 'two' })).toBe(false);
    expect(await v.data()).toBe('a'.repeat(100));
  });

  it('shows nothing until the record is written, so a half-made share is never served', async () => {
    const { storage, vault: v } = vault();
    await storage.put({ d0: 'orphan piece' });
    expect(await v.meta()).toBeNull();
    expect(await v.data()).toBeNull();
    expect(await v.og()).toBeNull();
  });

  it('leaves nothing behind when a write fails part-way, and the alarm was set first', async () => {
    for (const failingKey of ['d3', 'token', 'meta']) {
      const { storage, vault: v } = vault();
      storage.failOn = (key) => key === failingKey;
      await expect(v.put({ meta: META, data: 'z'.repeat(450_000), og: 'iVBORw0KGgoAAAA', tokenHash: 'h' })).rejects.toThrow('storage failed');
      expect(storage.map.size, failingKey).toBe(0);
      expect(storage.alarmAt(), failingKey).toBeNull();
      expect(await v.meta()).toBeNull();
    }
    // The alarm is the first thing written: a share that fails after the alarm is deleted by it as well.
    const { storage, vault: v } = vault();
    const order: string[] = [];
    const setAlarm = storage.setAlarm;
    storage.setAlarm = async (t: number) => { order.push('alarm'); await setAlarm(t); };
    const put = storage.put;
    storage.put = (async (a: string | Record<string, unknown>, b?: unknown) => { order.push('put'); await put(a, b); }) as typeof storage.put;
    await v.put({ meta: META, data: 'a'.repeat(100), og: null, tokenHash: 'h' });
    expect(order[0]).toBe('alarm');
  });

  it('refuses to serve a share with a missing piece rather than a short one', async () => {
    const { storage, vault: v } = vault();
    await v.put({ meta: META, data: 'z'.repeat(250_000), og: null, tokenHash: 'h' });
    storage.map.delete('d1');
    expect(await v.data()).toBeNull();
  });

  it('expires: a read after the expiry finds nothing and clears the storage', async () => {
    const { storage, vault: v } = vault();
    await v.put({ meta: META, data: 'a'.repeat(100), og: 'iVBORw0KGgoAAAA', tokenHash: 'h' });
    vi.setSystemTime(META.expiresAt + 1);
    expect(await v.meta()).toBeNull();
    expect(await v.data()).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it('deletes everything when its alarm fires', async () => {
    const { storage, vault: v } = vault();
    await v.put({ meta: META, data: 'a'.repeat(100), og: null, tokenHash: 'h' });
    await v.alarm();
    expect(storage.map.size).toBe(0);
  });

  it('stops sharing only for the holder of the token', async () => {
    const { vault: v } = vault();
    await v.put({ meta: META, data: 'a'.repeat(100), og: null, tokenHash: 'right' });
    expect(await v.remove('wrong')).toBe('forbidden');
    expect(await v.remove('')).toBe('forbidden');
    expect(await v.meta()).not.toBeNull();
    expect(await v.remove('right')).toBe('removed');
    expect(await v.meta()).toBeNull();
    expect(await v.remove('right')).toBe('missing');
  });

  it('serves no picture when none was stored', async () => {
    const { vault: v } = vault();
    await v.put({ meta: META, data: 'a'.repeat(100), og: null, tokenHash: 'h' });
    expect(await v.og()).toBeNull();
    expect((await v.meta())?.hasOg).toBe(false);
  });
});

describe('ShareQuota', () => {
  it('counts a visitor, refuses past the limit, and gives a hold back', async () => {
    const storage = fakeStorage();
    const q = new ShareQuota({ storage } as never, {} as never) as unknown as InstanceType<typeof ShareQuota>;
    const limits = { ...SHARE_LIMITS_DEFAULT, visitorCount: 2 };
    expect(await q.take('2026-10-19', 'v', 100, limits)).toEqual({ ok: true });
    expect(await q.take('2026-10-19', 'v', 100, limits)).toEqual({ ok: true });
    expect(await q.take('2026-10-19', 'v', 100, limits)).toEqual({ ok: false, reason: 'visitor' });
    await q.give('2026-10-19', 'v', 100);
    expect(await q.take('2026-10-19', 'v', 100, limits)).toEqual({ ok: true });
    expect(await q.take('2026-10-20', 'v', 100, limits)).toEqual({ ok: true });
    await q.give('2026-10-19', 'nobody', 100); // a stale or unknown hold is ignored, not an error
  });
});
