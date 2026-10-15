/**
 * Dashboard warm-up scheduler: order (tier, priority), restraint (concurrency,
 * gate), resumability (cached tabs skipped) and back-off (empty / failed tabs
 * are not retried in a loop).
 */
import { describe, expect, it } from 'vitest';
import {
  DashboardWarmup,
  WARM_EMPTY_BACKOFF_MS,
  WARM_FAILED_BACKOFF_MS,
  WARM_MAX_ATTEMPTS,
  WARM_TABS,
  warmupConcurrency,
  warmupTabsInParallel,
  warmTabDue,
  type CachedTabState,
  type DashboardWarmupDeps,
  type WarmAttempts,
  type WarmTab,
} from './dashboard-warmup';

const T0 = Date.parse('2026-10-13T00:00:00.000Z');

function harness(options: {
  concurrency?: number;
  tabsInParallel?: number;
  /** What a research call leaves in the cache. */
  result?: (companyId: string, tab: WarmTab) => CachedTabState | 'throw';
  cached?: Record<string, Partial<Record<WarmTab, CachedTabState>>>;
  attempts?: WarmAttempts;
  /** Hold every research call until released. */
  hold?: boolean;
} = {}) {
  let now = T0;
  let allowed = true;
  const cache: Record<string, Partial<Record<WarmTab, { state: CachedTabState; at: string }>>> = {};
  for (const [companyId, tabs] of Object.entries(options.cached ?? {})) {
    for (const [tab, state] of Object.entries(tabs)) (cache[companyId] ??= {})[tab as WarmTab] = { state: state!, at: new Date(now).toISOString() };
  }
  let attempts: WarmAttempts = structuredClone(options.attempts ?? {});
  const calls: Array<{ companyId: string; tab: WarmTab; force: boolean }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const companiesInFlight = new Set<string>();
  let maxCompanies = 0;
  const releases: Array<() => void> = [];
  const deps: DashboardWarmupDeps = {
    concurrency: options.concurrency ?? 1,
    ...(options.tabsInParallel !== undefined ? { tabsInParallel: options.tabsInParallel } : {}),
    now: () => now,
    canRun: () => allowed,
    cached: (companyId, tab) => cache[companyId]?.[tab] ?? { state: 'missing' },
    attempts: () => attempts,
    recordAttempt: (companyId, tab, attempt) => { attempts = { ...attempts, [companyId]: { ...attempts[companyId], [tab]: attempt } }; },
    research: async (companyId, tab, force) => {
      calls.push({ companyId, tab, force });
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      companiesInFlight.add(companyId); maxCompanies = Math.max(maxCompanies, companiesInFlight.size);
      try {
        if (options.hold) await new Promise<void>((resolve) => releases.push(resolve));
        else await Promise.resolve();
        const outcome = options.result?.(companyId, tab) ?? 'filled';
        if (outcome === 'throw') throw new Error('provider failed');
        if (outcome !== 'missing') (cache[companyId] ??= {})[tab] = { state: outcome, at: new Date(now).toISOString() };
      } finally {
        inFlight -= 1;
      }
    },
  };
  const warmup = new DashboardWarmup({
    ...deps,
    research: async (companyId, tab, force) => {
      await deps.research(companyId, tab, force);
      // A company stays "in flight" until its last tab finishes.
      if (tab === WARM_TABS[WARM_TABS.length - 1]) companiesInFlight.delete(companyId);
    },
  });
  return {
    warmup, calls,
    attempts: () => attempts,
    get maxInFlight() { return maxInFlight; },
    get maxCompanies() { return maxCompanies; },
    advance: (ms: number) => { now += ms; },
    setAllowed: (value: boolean) => { allowed = value; },
    releaseOne: async () => { releases.shift()?.(); await new Promise((r) => setTimeout(r, 0)); },
    releaseAll: async () => {
      while (releases.length) { releases.shift()!(); await new Promise((r) => setTimeout(r, 0)); }
    },
  };
}

const companiesIn = (calls: Array<{ companyId: string }>) => [...new Set(calls.map((call) => call.companyId))];

describe('DashboardWarmup', () => {
  it('warms every warm tab of every queued company, highest tier first', async () => {
    const h = harness();
    h.warmup.enqueue([
      { companyId: 'tier3', tier: 3 },
      { companyId: 'untiered', tier: null },
      { companyId: 'tier8', tier: 8 },
      { companyId: 'tier5', tier: 5 },
    ], 'creation');
    await h.warmup.idle();
    expect(companiesIn(h.calls)).toEqual(['tier8', 'tier5', 'tier3', 'untiered']);
    expect(h.calls).toHaveLength(4 * WARM_TABS.length);
    for (const companyId of ['tier8', 'tier5', 'tier3', 'untiered']) {
      expect(h.calls.filter((call) => call.companyId === companyId).map((call) => call.tab)).toEqual([...WARM_TABS]);
    }
  });

  it('serves a new deck before a startup backfill already queued, and deck-open in between', async () => {
    const h = harness({ hold: true });
    // The first backfill company starts at once (nothing else is queued yet).
    h.warmup.enqueue([{ companyId: 'old_a', tier: 8 }, { companyId: 'old_b', tier: 8 }], 'backfill');
    h.warmup.enqueue([{ companyId: 'opened', tier: 1 }], 'open');
    h.warmup.enqueue([{ companyId: 'fresh_low', tier: 2 }, { companyId: 'fresh_high', tier: 6 }], 'creation');
    expect(h.warmup.pending()).toEqual(['fresh_high', 'fresh_low', 'opened', 'old_b']);
    await h.releaseAll();
    await h.warmup.idle();
    expect(companiesIn(h.calls)).toEqual(['old_a', 'fresh_high', 'fresh_low', 'opened', 'old_b']);
  });

  it('never runs more companies at once than its concurrency', async () => {
    const h = harness({ concurrency: 2, hold: true });
    h.warmup.enqueue(Array.from({ length: 6 }, (_, i) => ({ companyId: `c${i}`, tier: 8 - i })), 'creation');
    await new Promise((r) => setTimeout(r, 0));
    // Two companies started; each runs its tabs one at a time.
    expect(h.calls.map((call) => call.companyId)).toEqual(['c0', 'c1']);
    await h.releaseAll();
    await h.warmup.idle();
    expect(h.maxInFlight).toBe(2);
    expect(h.maxCompanies).toBeLessThanOrEqual(2);
    expect(h.calls).toHaveLength(6 * WARM_TABS.length);
  });

  it('skips tabs that are already cached and companies with nothing due (resumable)', async () => {
    const h = harness({ cached: {
      done: Object.fromEntries(WARM_TABS.map((tab) => [tab, 'filled'])) as Record<WarmTab, CachedTabState>,
      half: { overview: 'filled', history: 'filled' },
    } });
    expect(h.warmup.enqueue([{ companyId: 'done', tier: 8 }, { companyId: 'half', tier: 7 }], 'creation')).toBe(1);
    await h.warmup.idle();
    expect(h.calls.map((call) => `${call.companyId}:${call.tab}`)).toEqual(['half:team_org', 'half:products_roadmap', 'half:live_intel']);
    // A second pass (e.g. after a reload) finds nothing to do.
    expect(h.warmup.enqueue([{ companyId: 'done', tier: 8 }, { companyId: 'half', tier: 7 }], 'open')).toBe(0);
    await h.warmup.idle();
    expect(h.calls).toHaveLength(3);
  });

  it('records an empty answer and backs off instead of re-researching it in a loop', async () => {
    const h = harness({ result: (_c, tab) => tab === 'history' ? 'empty' : 'filled' });
    h.warmup.enqueue([{ companyId: 'quiet', tier: 4 }], 'creation');
    await h.warmup.idle();
    expect(h.attempts().quiet?.history).toMatchObject({ outcome: 'empty', count: 1 });
    expect(h.attempts().quiet?.team_org).toMatchObject({ outcome: 'filled', count: 0 });
    // Re-queued at once (deck reopened, app restarted): nothing is due.
    for (let i = 0; i < 5; i += 1) h.warmup.enqueue([{ companyId: 'quiet', tier: 4 }], 'open');
    await h.warmup.idle();
    expect(h.calls.filter((call) => call.tab === 'history')).toHaveLength(1);
    // After the back-off, ONE forced retry; then a longer wait; then it stops for good.
    h.advance(WARM_EMPTY_BACKOFF_MS);
    h.warmup.enqueue([{ companyId: 'quiet', tier: 4 }], 'backfill');
    await h.warmup.idle();
    const historyCalls = () => h.calls.filter((call) => call.tab === 'history');
    expect(historyCalls()).toHaveLength(2);
    expect(historyCalls()[1]!.force).toBe(true);
    expect(h.attempts().quiet?.history).toMatchObject({ outcome: 'empty', count: 2 });
    h.advance(WARM_EMPTY_BACKOFF_MS);
    h.warmup.enqueue([{ companyId: 'quiet', tier: 4 }], 'backfill');
    await h.warmup.idle();
    expect(historyCalls()).toHaveLength(2);
    h.advance(WARM_EMPTY_BACKOFF_MS);
    h.warmup.enqueue([{ companyId: 'quiet', tier: 4 }], 'backfill');
    await h.warmup.idle();
    expect(historyCalls()).toHaveLength(WARM_MAX_ATTEMPTS);
    h.advance(100 * WARM_EMPTY_BACKOFF_MS);
    expect(h.warmup.enqueue([{ companyId: 'quiet', tier: 4 }], 'backfill')).toBe(0);
  });

  it('a failed tab is left for the on-open path and retried only after its back-off', async () => {
    const h = harness({ result: (_c, tab) => tab === 'products_roadmap' ? 'throw' : 'filled' });
    h.warmup.enqueue([{ companyId: 'flaky', tier: 6 }], 'creation');
    await h.warmup.idle();
    // The other tabs still warmed; the failure was recorded, not cached.
    expect(h.calls.map((call) => call.tab)).toEqual([...WARM_TABS]);
    expect(h.attempts().flaky?.products_roadmap).toMatchObject({ outcome: 'failed', count: 1 });
    h.warmup.enqueue([{ companyId: 'flaky', tier: 6 }], 'open');
    await h.warmup.idle();
    expect(h.calls).toHaveLength(WARM_TABS.length);
    h.advance(WARM_FAILED_BACKOFF_MS);
    h.warmup.enqueue([{ companyId: 'flaky', tier: 6 }], 'open');
    await h.warmup.idle();
    expect(h.calls.map((call) => call.tab).slice(WARM_TABS.length)).toEqual(['products_roadmap']);
    expect(h.attempts().flaky?.products_roadmap).toMatchObject({ outcome: 'failed', count: 2 });
  });

  it('holds while the gate is closed (quota, pause, deck build) and resumes on the next kick', async () => {
    const h = harness();
    h.setAllowed(false);
    h.warmup.enqueue([{ companyId: 'a', tier: 5 }], 'creation');
    await h.warmup.idle();
    expect(h.calls).toHaveLength(0);
    expect(h.warmup.pending()).toEqual(['a']);
    h.setAllowed(true);
    h.warmup.kick();
    await h.warmup.idle();
    expect(h.calls).toHaveLength(WARM_TABS.length);
  });
});

describe('warmTabDue', () => {
  it('treats an empty cache produced by a user open as one empty attempt', () => {
    const at = new Date(T0).toISOString();
    expect(warmTabDue({ state: 'empty', at }, undefined, T0 + 1000)).toEqual({ due: false, force: true });
    expect(warmTabDue({ state: 'empty', at }, undefined, T0 + WARM_EMPTY_BACKOFF_MS)).toEqual({ due: true, force: true });
    expect(warmTabDue({ state: 'filled', at }, undefined, T0)).toEqual({ due: false, force: false });
    expect(warmTabDue({ state: 'missing' }, undefined, T0)).toEqual({ due: true, force: false });
  });
});

describe('warmupConcurrency', () => {
  it('follows the key allowance: one company at a time on a free key, four on a fast one, never more', () => {
    expect(warmupConcurrency(0)).toBe(1);
    expect(warmupConcurrency(10)).toBe(1);
    expect(warmupConcurrency(30)).toBe(2);
    expect(warmupConcurrency(60)).toBe(4);
    expect(warmupConcurrency(1000)).toBe(4);
  });
});

describe('tabs of one company in parallel', () => {
  it('follows the key allowance: strictly one at a time below 60 a minute, two at 60', () => {
    expect(warmupTabsInParallel(10)).toBe(1);
    expect(warmupTabsInParallel(30)).toBe(1);
    expect(warmupTabsInParallel(60)).toBe(2);
    expect(warmupTabsInParallel(600)).toBe(2);
  });

  it('runs the Overview alone first, then at most two tabs of the company at once, and every tab', async () => {
    const h = harness({ concurrency: 1, tabsInParallel: 2, hold: true });
    h.warmup.enqueue([{ companyId: 'c', tier: 8 }], 'creation');
    await new Promise((r) => setTimeout(r, 0));
    expect(h.calls.map((call) => call.tab)).toEqual(['overview']);
    await h.releaseOne(); // overview done: two more start together
    expect(h.calls.map((call) => call.tab)).toEqual(['overview', 'history', 'team_org']);
    await h.releaseOne(); // one of the two done: the next tab takes its place, never a third at once
    expect(h.calls.map((call) => call.tab)).toEqual(['overview', 'history', 'team_org', 'products_roadmap']);
    await h.releaseAll();
    await h.warmup.idle();
    expect(h.calls.map((call) => call.tab).sort()).toEqual([...WARM_TABS].sort());
    expect(h.maxInFlight).toBe(2);
  });

  it('keeps the default of one tab at a time, in reading order', async () => {
    const h = harness({ concurrency: 1 });
    h.warmup.enqueue([{ companyId: 'c', tier: 8 }], 'creation');
    await h.warmup.idle();
    expect(h.calls.map((call) => call.tab)).toEqual([...WARM_TABS]);
    expect(h.maxInFlight).toBe(1);
  });

  it('stops starting tabs when the gate closes mid-company, and finishes the rest when it reopens', async () => {
    const h = harness({ concurrency: 1, tabsInParallel: 2, hold: true });
    h.warmup.enqueue([{ companyId: 'c', tier: 8 }], 'creation');
    await new Promise((r) => setTimeout(r, 0));
    h.setAllowed(false);
    await h.releaseAll(); // overview finishes; the gate is shut, so no more tabs start
    await new Promise((r) => setTimeout(r, 0));
    expect(h.calls.map((call) => call.tab)).toEqual(['overview']);
    h.setAllowed(true);
    h.warmup.kick();
    for (let round = 0; round < 6; round += 1) { await h.releaseAll(); await new Promise((r) => setTimeout(r, 0)); }
    await h.warmup.idle();
    expect(h.calls.map((call) => call.tab).sort()).toEqual([...WARM_TABS].sort());
  });
});
