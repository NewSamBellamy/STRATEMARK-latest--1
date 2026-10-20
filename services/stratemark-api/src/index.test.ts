/**
 * The Worker's own handler, end to end, against a stand-in for Google: the real routes, the real request inspection, the
 * real budget ledger (a Durable Object class with in-memory storage) and the real reader limits. These replay what a red
 * team did to the real Worker in workerd: a request the meter could not see, a burst that overshot the cap, one machine
 * counted as many visitors, a fetch proxy with no limit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
  },
}));

const { default: worker } = await import('./index');
const { BudgetCounter } = await import('./budget');
const { ReaderQuota } = await import('./reader-quota');
const { ShareVault, ShareQuota } = await import('./share-vault');
const { callCostMicros } = await import('./policy');

const APP = 'https://app.example';
const KEY = 'AIzaTESTKEYTESTKEYTESTKEYTESTKEYTESTKEY';
const MODEL = 'gemini-flash-lite-latest';
const DAY = new Date().toISOString().slice(0, 10);

function memoryStorage() {
  const map = new Map<string, unknown>();
  const counters = { gets: 0, puts: 0 };
  return {
    map, counters,
    get: async (keys: string | string[]) => {
      counters.gets += 1;
      return Array.isArray(keys) ? new Map(keys.filter((key) => map.has(key)).map((key) => [key, map.get(key)])) : map.get(keys);
    },
    put: async (a: string | Record<string, unknown>, b?: unknown) => {
      counters.puts += 1;
      for (const [key, value] of Object.entries(typeof a === 'string' ? { [a]: b } : a)) map.set(key, structuredClone(value));
    },
    setAlarm: async () => undefined, deleteAlarm: async () => undefined, deleteAll: async () => map.clear(),
  };
}

/** A Durable Object answers one call at a time (its input gate); a plain object does not, so this queues the calls. */
function oneAtATime<T extends object>(target: T): T {
  let queue: Promise<unknown> = Promise.resolve();
  return new Proxy(target, {
    get(object, property) {
      const value = (object as Record<string | symbol, unknown>)[property];
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const run = queue.then(() => (value as (...a: unknown[]) => unknown).apply(object, args));
        queue = run.catch(() => undefined);
        return run;
      };
    },
  });
}

function makeEnv(vars: Record<string, string> = {}) {
  const budgetStorage = memoryStorage();
  const budget = oneAtATime(new BudgetCounter({ storage: budgetStorage } as never, {} as never));
  const readers = new Map<string, InstanceType<typeof ReaderQuota>>();
  const vaults = new Map<string, unknown>();
  const shareQuota = oneAtATime(new ShareQuota({ storage: memoryStorage() } as never, {} as never));
  const env = {
    GEMINI_API_KEY: KEY, SERPER_API_KEY: 'serper-placeholder-key', ALLOWED_ORIGINS: APP, ALLOW_LOCALHOST: 'false',
    BUDGET: { idFromName: () => 'global', get: () => budget },
    SHARE_QUOTA: { idFromName: () => 'global', get: () => shareQuota },
    SHARES: {
      idFromName: (name: string) => name,
      get: (name: string) => { if (!vaults.has(name)) vaults.set(name, oneAtATime(new ShareVault({ storage: memoryStorage() } as never, {} as never))); return vaults.get(name); },
    },
    READER_QUOTA: {
      idFromName: (name: string) => name,
      get: (name: string) => { if (!readers.has(name)) readers.set(name, oneAtATime(new ReaderQuota({ storage: memoryStorage() } as never, {} as never))); return readers.get(name); },
    },
    ...vars,
  };
  return { env: env as never, budget, budgetStorage, vaults };
}

const GROUNDED = { contents: [{ parts: [{ text: 'research the meal kit market' }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.2 } };
const call = (env: never, body: unknown, ip = '203.0.113.9', model = MODEL) => worker.fetch(new Request(`https://worker.example/v1/gemini/${model}:generateContent`, {
  method: 'POST', headers: { origin: APP, 'content-type': 'application/json', 'cf-connecting-ip': ip },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}), env);

const USAGE = { promptTokenCount: 1000, candidatesTokenCount: 500 };
const google = {
  usage: USAGE,
  reply(extra: Record<string, unknown> = {}, usage: unknown = USAGE) {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] }, ...extra }], ...(usage === null ? {} : { usageMetadata: usage }) }), { status: 200 });
  },
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(async () => google.reply()); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });
const googleCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('generativelanguage'));

describe('a hosted call is metered for what Google bills', () => {
  it('charges an honest grounded call its tokens and the grounding rate, and releases the hold', async () => {
    const { env, budget } = makeEnv();
    fetchMock.mockImplementation(async () => google.reply({ groundingMetadata: { webSearchQueries: ['a', 'b', 'c', 'd', 'e'] } }));
    expect((await call(env, GROUNDED)).status).toBe(200);
    const status = await budget.status(DAY);
    expect(status.spentMicros).toBe(callCostMicros(MODEL, google.usage, true, 5));
    expect(status.heldMicros).toBe(0);
  });

  it('charges the same for a request that spells the grounding tool with an escape (the old meter read raw text and missed it)', async () => {
    const { env, budget } = makeEnv();
    const spelled = '{"contents":[{"parts":[{"text":"x"}]}],"tools":[{"google\\u005fsearch":{}}]}';
    fetchMock.mockImplementation(async () => google.reply({ groundingMetadata: { webSearchQueries: ['a'] } }));
    expect((await call(env, spelled)).status).toBe(200);
    expect((await budget.status(DAY)).spentMicros).toBe(callCostMicros(MODEL, google.usage, true, 1));
  });

  it('charges the grounding rate to an answer that searched though the request did not ask it to', async () => {
    const { env, budget } = makeEnv();
    fetchMock.mockImplementation(async () => google.reply({ groundingMetadata: { webSearchQueries: ['a', 'b'] } }));
    await call(env, { contents: [{ parts: [{ text: 'x' }] }] });
    expect((await budget.status(DAY)).spentMicros).toBe(callCostMicros(MODEL, google.usage, true, 2));
  });

  it('charges the worst case for an answer that reports no usage, instead of nothing', async () => {
    const { env, budget } = makeEnv();
    fetchMock.mockImplementation(async () => google.reply({}, null));
    await call(env, GROUNDED);
    expect((await budget.status(DAY)).spentMicros).toBeGreaterThan(callCostMicros(MODEL, google.usage, true, 1));
  });

  it('refuses a request for a feature the meter cannot see, before holding a cent or calling Google', async () => {
    const { env, budget } = makeEnv();
    for (const body of [
      { ...GROUNDED, tools: [{ googleMaps: {} }] },
      { ...GROUNDED, tools: [{ google_search_retrieval: {} }] },
      { contents: [{ parts: [{ fileData: { fileUri: 'https://www.youtube.com/watch?v=abc', mimeType: 'video/mp4' } }] }] },
      { ...GROUNDED, cachedContent: 'cachedContents/abc' },
      'not json',
    ]) {
      const res = await call(env, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(googleCalls()).toHaveLength(0);
    expect(await budget.status(DAY)).toMatchObject({ spentMicros: 0, heldMicros: 0 });
  });

  it('sends Google a rebuilt request with the answer capped, never the raw body', async () => {
    const { env } = makeEnv();
    await call(env, { ...GROUNDED, generationConfig: { temperature: 0.2, maxOutputTokens: 5_000_000, thinkingConfig: { thinkingBudget: 999_999 } } });
    const sent = JSON.parse((googleCalls()[0]![1] as RequestInit).body as string) as { generationConfig: { maxOutputTokens: number; thinkingConfig: { thinkingBudget: number } } };
    expect(sent.generationConfig.maxOutputTokens).toBe(32_768);
    expect(sent.generationConfig.thinkingConfig.thinkingBudget).toBe(16_384);
  });

  it('does not repeat the owner’s Google project number from an error body', async () => {
    const { env } = makeEnv();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded for project projects/123456789012 (PerMinute)', status: 'RESOURCE_EXHAUSTED' } }), { status: 429 }));
    const res = await call(env, GROUNDED);
    expect(res.status).toBe(429);
    const text = await res.text();
    expect(text).not.toContain('123456789012');
    expect(text).toContain('PerMinute'); // the client still tells a per-minute limit from a spent day
  });

  it('refuses a body that is too large without buffering it, even with no length declared', async () => {
    const { env } = makeEnv();
    const huge = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(512 * 1024).fill(97)); } });
    const res = await worker.fetch(new Request(`https://worker.example/v1/gemini/${MODEL}:generateContent`, {
      method: 'POST', headers: { origin: APP, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: huge, duplex: 'half',
    } as RequestInit), env);
    expect(res.status).toBe(413);
    expect(googleCalls()).toHaveLength(0);
  });
});

describe('the budget holds', () => {
  it('a budget of zero is a kill switch', async () => {
    const { env } = makeEnv({ DAILY_BUDGET_USD: '0' });
    const res = await call(env, GROUNDED);
    expect(res.status).toBe(402);
    expect(googleCalls()).toHaveLength(0);
  });

  it('counts every address in one IPv6 /64 as one visitor, so rotating addresses does not buy more budget', async () => {
    const { env } = makeEnv({ DAILY_VISITOR_BUDGET_USD: '0.27' });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await call(env, GROUNDED, `2001:db8:abcd:12:${i}:${i}:${i}:${i + 1}`)).status);
    expect(statuses[0]).toBe(200);
    expect(statuses.slice(1).every((status) => status === 402)).toBe(true);
    // A different /64 is a different visitor.
    expect((await call(env, GROUNDED, '2001:db8:abcd:99::1')).status).toBe(200);
  });

  it('a burst cannot be admitted past the cap: each call is held at what it can cost', async () => {
    const { env, budget } = makeEnv({ DAILY_BUDGET_USD: '1' });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fetchMock.mockImplementation(async () => { await gate; return google.reply(); });
    const burst = Array.from({ length: 40 }, (_unused, i) => call(env, GROUNDED, `198.51.100.${i + 1}`));
    await vi.waitFor(async () => expect((await budget.status(DAY)).heldMicros).toBeGreaterThan(0));
    release();
    const statuses = (await Promise.all(burst)).map((res) => res.status);
    expect(statuses.filter((status) => status === 200).length).toBeLessThan(10); // about $0.26 held each against $1
    expect(statuses.filter((status) => status === 402).length).toBeGreaterThan(30);
  });
});

describe('the readers are limited per visitor', () => {
  const preview = (env: never, headers: Record<string, string> = { origin: APP }, ip = '203.0.113.50') => worker.fetch(new Request('https://worker.example/v1/preview?url=https%3A%2F%2Fexample.org%2F', { method: 'GET', headers: { 'cf-connecting-ip': ip, ...headers } }), env);

  it('lets a deck’s worth of reads through and then says when to come back', async () => {
    const { env } = makeEnv();
    const statuses: number[] = [];
    for (let i = 0; i < 245; i += 1) statuses.push((await preview(env)).status);
    expect(statuses.slice(0, 240).every((status) => status !== 429)).toBe(true);
    expect(statuses.slice(240).every((status) => status === 429)).toBe(true);
    const refused = await preview(env);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another visitor is not affected.
    expect((await preview(env, { origin: APP }, '203.0.113.51')).status).not.toBe(429);
  });

  it('a picture shown by an img tag (no Origin, only a Referer) is let in for an allowed page and refused for any other', async () => {
    const { env } = makeEnv();
    // A public address for the host, and a small PNG from it.
    fetchMock.mockImplementation(async (url: string) => String(url).includes('cloudflare-dns')
      ? new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }))
      : new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } }));
    // Node's Request drops a Referer header (a browser rule), the Workers runtime does not: stand in for the inbound request.
    const image = (headers: Record<string, string>) => {
      const all: Record<string, string> = { 'cf-connecting-ip': '203.0.113.60', ...headers };
      const inbound = { url: 'https://worker.example/v1/image?url=https%3A%2F%2Fexample.org%2Fa.png', method: 'GET', signal: new AbortController().signal, headers: { get: (name: string) => all[name.toLowerCase()] ?? null } };
      return worker.fetch(inbound as unknown as Request, env);
    };
    expect((await image({ referer: `${APP}/#/markets/x/deck` })).status).toBe(200);
    expect((await image({ referer: 'https://evil.example/page' })).status).toBe(403);
    expect((await image({})).status).toBe(403);
  });
});

describe('the hosted search relay counts visitors the way every other route does', () => {
  const serper = async (url: string) => (String(url).includes('serper') ? new Response(JSON.stringify({ organic: [] }), { status: 200 }) : google.reply());
  const search = (env: never, ip: string) => worker.fetch(new Request('https://worker.example/v1/search', {
    method: 'POST', headers: { origin: APP, 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ provider: 'serper', query: 'meal kits' }),
  }), env);

  it('counts every address in one IPv6 /64 as one visitor (it used to count each address, so rotating addresses bought a fresh limit)', async () => {
    const { env, budget } = makeEnv();
    fetchMock.mockImplementation(serper);
    for (let i = 0; i < 40; i += 1) expect((await search(env, `2001:db8:abcd:12:${i.toString(16)}::1`)).status).toBe(200);
    expect((await budget.status(DAY)).visitors).toBe(1);
    // A different /64 is a different visitor.
    expect((await search(env, '2001:db8:abcd:99::1')).status).toBe(200);
    expect((await budget.status(DAY)).visitors).toBe(2);
  });

  it('meets the per-visitor cap by /64 too: rotating through a /64 does not buy more searches', async () => {
    // $0.01 a visitor is ten hosted searches at 1,000 micro-dollars each.
    const { env } = makeEnv({ DAILY_VISITOR_BUDGET_USD: '0.01' });
    fetchMock.mockImplementation(serper);
    const statuses: number[] = [];
    for (let i = 0; i < 14; i += 1) statuses.push((await search(env, `2001:db8:abcd:12:${i.toString(16)}::1`)).status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(10);
    expect(statuses.filter((status) => status === 402)).toHaveLength(4);
  });
});

describe('a visitor whose address is a name every object has', () => {
  it('is held to the per-visitor cap through the real handler', async () => {
    const { env } = makeEnv({ DAILY_VISITOR_BUDGET_USD: '0.27' }); // one grounded Flash-Lite call is held at about $0.256
    const statuses: number[] = [];
    for (const ip of ['constructor', 'constructor', '__proto__', '__proto__']) statuses.push((await call(env, GROUNDED, ip)).status);
    expect(statuses).toEqual([200, 402, 200, 402]);
  });
});

describe('calls that cost nothing do not fill the visitor ledger', () => {
  it('leaves no visitors behind when Google rejects every call, and a genuine visitor is still served (R2-W3)', async () => {
    const { env, budget } = makeEnv();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: { code: 404, message: 'model not found' } }), { status: 404 }));
    for (let i = 0; i < 120; i += 1) expect((await call(env, GROUNDED, `10.0.${i >> 8}.${i & 255}`)).status).toBe(404);
    expect(await budget.status(DAY)).toMatchObject({ spentMicros: 0, heldMicros: 0, visitors: 0 });
    fetchMock.mockImplementation(async () => google.reply());
    expect((await call(env, GROUNDED, '198.51.100.77')).status).toBe(200);
  });
});

describe('a refused hosted call is cheap for the ledger', () => {
  it('rewrites the ledger for none of twenty refused calls (R2-W10)', async () => {
    const { env, budgetStorage } = makeEnv({ DAILY_VISITOR_BUDGET_USD: '0' });
    for (let i = 0; i < 20; i += 1) expect((await call(env, GROUNDED, `198.51.100.${i}`)).status).toBe(402);
    // One write starts the day's ledger; the other nineteen refusals write nothing.
    expect(budgetStorage.counters.puts).toBe(1);
  });
});

describe('the public /health route does not read the ledger on every hit', () => {
  const health = (env: never) => worker.fetch(new Request('https://worker.example/health'), env);

  it('reads it once for twenty hits, and still answers every field the launch preflight reads', async () => {
    const { env, budgetStorage } = makeEnv();
    await call(env, GROUNDED);
    const getsBefore = budgetStorage.counters.gets;
    let body: Record<string, unknown> = {};
    for (let i = 0; i < 20; i += 1) {
      const res = await health(env);
      expect(res.status).toBe(200);
      body = await res.json() as Record<string, unknown>;
    }
    // One read of the ledger and one of its history, for all twenty hits (it was two reads for each hit).
    expect(budgetStorage.counters.gets - getsBefore).toBeLessThanOrEqual(2);
    expect(body).toMatchObject({
      ok: true, hostedResearch: true, keyLooksValid: true, budgetUsd: 100, visitorBudgetUsd: 20, visitorsToday: 1,
    });
    expect(Number(body.spentTodayUsd)).toBeGreaterThan(0);
    expect(Array.isArray(body.last7Days)).toBe(true);
  });

  it('reads it again once the numbers are ten seconds old', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(`${DAY}T10:00:00.000Z`));
      const { env, budgetStorage } = makeEnv();
      await health(env);
      const afterFirst = budgetStorage.counters.gets;
      vi.setSystemTime(new Date(`${DAY}T10:00:09.000Z`));
      await health(env);
      expect(budgetStorage.counters.gets).toBe(afterFirst);
      await call(env, GROUNDED);
      vi.setSystemTime(new Date(`${DAY}T10:00:11.000Z`));
      const fresh = await (await health(env)).json() as { spentTodayUsd: number; visitorsToday: number };
      expect(fresh.visitorsToday).toBe(1);
      expect(fresh.spentTodayUsd).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a budget that is set to something unusable fails closed', () => {
  it('refuses every hosted call with a 402 that names the setting, for values that used to leave the budget open', async () => {
    // "-1" used to mean the default; "1e308" became an infinite ceiling.
    for (const bad of ['-1', '1e308', 'abc', '0.0000001']) {
      const { env } = makeEnv({ DAILY_BUDGET_USD: bad });
      const res = await call(env, GROUNDED);
      expect(res.status, bad).toBe(402);
      const body = await res.json() as { budget: string; reason: string; misconfigured?: string[]; error: string };
      expect(body.budget, bad).toBe('exhausted');
      expect(body.reason, bad).toBe('global'); // the web app reads only this
      expect(body.misconfigured, bad).toEqual([expect.stringContaining('DAILY_BUDGET_USD')]);
      expect(JSON.stringify(body), bad).not.toContain(bad);
      expect(googleCalls()).toHaveLength(0);
    }
  });

  it('does the same for an unusable per-visitor budget and for the hosted search relay', async () => {
    const { env } = makeEnv({ DAILY_VISITOR_BUDGET_USD: '-3' });
    const gemini = await call(env, GROUNDED);
    expect(gemini.status).toBe(402);
    expect(await gemini.json()).toMatchObject({ reason: 'visitor', misconfigured: [expect.stringContaining('DAILY_VISITOR_BUDGET_USD')] });
    const search = await worker.fetch(new Request('https://worker.example/v1/search', {
      method: 'POST', headers: { origin: APP, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ provider: 'serper', query: 'meal kits' }),
    }), env);
    expect(search.status).toBe(402);
    expect(await search.json()).toMatchObject({ misconfigured: [expect.stringContaining('DAILY_VISITOR_BUDGET_USD')] });
  });

  it('leaves a budget that is fine, unset or zero unchanged, and /health reports a misconfiguration', async () => {
    expect((await call(makeEnv().env, GROUNDED)).status).toBe(200);
    expect((await call(makeEnv({ DAILY_BUDGET_USD: '25' }).env, GROUNDED)).status).toBe(200);
    const kill = await call(makeEnv({ DAILY_BUDGET_USD: '0' }).env, GROUNDED);
    expect(kill.status).toBe(402);
    expect(await kill.json()).not.toHaveProperty('misconfigured');
    const health = await (await worker.fetch(new Request('https://worker.example/health'), makeEnv({ DAILY_BUDGET_USD: '1e308' }).env)).json() as { budgetUsd: number; budgetMisconfigured: string[] };
    expect(health.budgetUsd).toBe(0);
    expect(health.budgetMisconfigured).toEqual([expect.stringContaining('DAILY_BUDGET_USD')]);
    const fine = await (await worker.fetch(new Request('https://worker.example/health'), makeEnv().env)).json() as { budgetMisconfigured: string[] };
    expect(fine.budgetMisconfigured).toEqual([]);
  });
});
