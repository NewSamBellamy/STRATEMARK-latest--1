/**
 * Scheduling-policy tests for the LivingDeckRuntime.
 *
 * Everything is injected — clock, timers, plan, verify, prefetch — so these
 * tests pin the POLICY (priority order, pacing, budget, pause semantics)
 * without React, real timers, or any model call.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  LivingDeckRuntime,
  type AgentActivityEvent,
  type LivingDeckDeps,
  type PrefetchTarget,
  type VerificationTarget,
} from './runtime';

function target(
  companyName: string,
  metricType: string,
  reason: 'consistency' | 'stale',
): VerificationTarget {
  return {
    companyId: companyName.toLowerCase(),
    companyName,
    metricType,
    metricLabel: metricType.toUpperCase(),
    reason,
  };
}

/** Manual timer harness: runs scheduled callbacks only when we say so. */
function harness(overrides: Partial<LivingDeckDeps> = {}) {
  const events: AgentActivityEvent[] = [];
  const pending: Array<{ fn: () => void }> = [];
  const deps: LivingDeckDeps = {
    plan: () => ({ consistencyTargets: [], staleTargets: [], freshFindings: [] }),
    verify: null,
    nextPrefetch: () => null,
    prefetch: async () => undefined,
    onEvent: (e) => events.push(e),
    now: () => 1_000_000,
    intervalMs: 100,
    idleIntervalMs: 1000,
    setTimer: (fn) => {
      const entry = { fn };
      pending.push(entry);
      return entry as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (t) => {
      const i = pending.indexOf(t as unknown as { fn: () => void });
      if (i >= 0) pending.splice(i, 1);
    },
    ...overrides,
  };
  const runtime = new LivingDeckRuntime(deps);
  /** Run the next scheduled tick to completion (awaiting async work). */
  const runNext = async () => {
    const entry = pending.shift();
    entry?.fn();
    // allow the async tick body to finish
    await new Promise((r) => setTimeout(r, 0));
  };
  return { runtime, events, pending, runNext };
}

describe('LivingDeckRuntime', () => {
  it.each(['resolve', 'reject'] as const)('preserves pause when an in-flight turn finishes (%s)', async outcome => {
    let finish!: () => void;
    const verify = vi.fn(() => new Promise<{ changed: boolean; citations: number; summary: string }>((resolve, reject) => {
      finish = () => outcome === 'resolve' ? resolve({ changed: false, citations: 0, summary: 'unverified' }) : reject(new Error('failed'));
    }));
    const { runtime, pending, runNext } = harness({ verify,
      plan: () => ({ consistencyTargets: [], staleTargets: [target('Example', 'arr', 'stale')], freshFindings: [] }) });
    runtime.start(1);
    await runNext();
    runtime.pause();
    finish();
    await runNext();
    expect(runtime.status).toBe('paused');
    expect(pending).toHaveLength(0);
    expect(verify).toHaveBeenCalledTimes(1);
  });
  it('announces itself on start and prioritizes consistency doubt over freshness decay', async () => {
    const verify = vi.fn().mockResolvedValue({ changed: false, citations: 2, summary: 'holds' });
    const { runtime, events, runNext } = harness({
      plan: () => ({
        consistencyTargets: [target('OpenAI', 'market_share', 'consistency')],
        staleTargets: [target('Anthropic', 'arr', 'stale')],
        freshFindings: [],
      }),
      verify,
    });

    runtime.start(20);
    expect(events[0]?.kind).toBe('started');
    expect(events[0]?.message).toContain('20 company desks');

    await runNext();
    // The doubted figure won the turn, not the merely-stale one.
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0]?.[0].companyName).toBe('OpenAI');
    expect(events.at(-1)?.kind).toBe('verified');
    expect(events.at(-1)?.message).toContain('consistency check');
  });

  it('reports corrections distinctly from confirmations', async () => {
    const { runtime, events, runNext } = harness({
      plan: () => ({
        consistencyTargets: [],
        staleTargets: [target('OpenAI', 'arr', 'stale')],
        freshFindings: [],
      }),
      verify: vi.fn().mockResolvedValue({ changed: true, citations: 3, summary: 'now $40.0B' }),
    });
    runtime.start(1);
    await runNext();
    const last = events.at(-1);
    expect(last?.kind).toBe('corrected');
    expect(last?.message).toContain('corrected ARR');
    expect(last?.citations).toBe(3);
  });

  it('falls back to tab prefetching when nothing needs verification', async () => {
    const prefetched: PrefetchTarget[] = [];
    let cold: PrefetchTarget | null = {
      companyId: 'openai',
      companyName: 'OpenAI',
      tab: 'live_intel',
      tabLabel: 'Live Intel',
    };
    const { runtime, events, runNext } = harness({
      nextPrefetch: () => cold,
      prefetch: async (t) => {
        prefetched.push(t);
        cold = null;
      },
    });
    runtime.start(1);
    await runNext();
    expect(prefetched).toHaveLength(1);
    expect(events.at(-1)?.kind).toBe('prefetched');
    expect(events.at(-1)?.message).toContain('Live Intel');

    // Next turn: everything warm → rests on the idle cadence.
    await runNext();
    expect(events.at(-1)?.kind).toBe('resting');
  });

  it('never verifies on transports without live research, but still prefetches', async () => {
    const prefetch = vi.fn().mockResolvedValue(undefined);
    let served = false;
    const { runtime, runNext } = harness({
      plan: () => ({
        consistencyTargets: [target('OpenAI', 'arr', 'consistency')],
        staleTargets: [],
        freshFindings: [],
      }),
      verify: null, // mock/demo transport
      nextPrefetch: () =>
        served
          ? null
          : { companyId: 'x', companyName: 'X', tab: 'overview', tabLabel: 'Overview' },
      prefetch: async (t) => {
        served = true;
        await prefetch(t);
      },
    });
    runtime.start(1);
    await runNext();
    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it('stops spending at the action budget and says so', async () => {
    const verify = vi.fn().mockResolvedValue({ changed: false, citations: 1, summary: 'holds' });
    const { runtime, events, runNext } = harness({
      plan: () => ({
        consistencyTargets: [],
        staleTargets: [target('OpenAI', 'arr', 'stale')],
        freshFindings: [],
      }),
      verify,
      maxActions: 2,
    });
    runtime.start(1);
    await runNext(); // action 1
    await runNext(); // action 2
    await runNext(); // budget check → resting
    expect(verify).toHaveBeenCalledTimes(2);
    expect(events.at(-1)?.kind).toBe('resting');
    expect(events.at(-1)?.message).toContain('budget');
    expect(runtime.status).toBe('resting');
  });

  it('surfaces fresh audit findings in the feed', async () => {
    const { runtime, events, runNext } = harness({
      plan: () => ({
        consistencyTargets: [],
        staleTargets: [],
        freshFindings: [
          { message: 'Stated market shares add up to 101.7%…', severity: 'warning' },
        ],
      }),
    });
    runtime.start(1);
    await runNext();
    const finding = events.find((e) => e.kind === 'finding');
    expect(finding?.message).toContain('101.7%');
    expect(finding?.severity).toBe('warning');
  });

  it('pause stops scheduling; resume picks the loop back up', async () => {
    const verify = vi.fn().mockResolvedValue({ changed: false, citations: 1, summary: 'holds' });
    const { runtime, pending, runNext } = harness({
      plan: () => ({
        consistencyTargets: [],
        staleTargets: [target('OpenAI', 'arr', 'stale')],
        freshFindings: [],
      }),
      verify,
    });
    runtime.start(1);
    runtime.pause();
    expect(pending).toHaveLength(0); // nothing scheduled while paused
    runtime.resume();
    await runNext();
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('a failing verification spends budget, reports, and does not kill the loop', async () => {
    const verify = vi
      .fn()
      .mockRejectedValueOnce(new Error('429 rate limited'))
      .mockResolvedValue({ changed: false, citations: 1, summary: 'holds' });
    const { runtime, events, runNext } = harness({
      plan: () => ({
        consistencyTargets: [],
        staleTargets: [target('OpenAI', 'arr', 'stale')],
        freshFindings: [],
      }),
      verify,
    });
    runtime.start(1);
    await runNext();
    expect(events.at(-1)?.kind).toBe('error');
    await runNext();
    expect(events.at(-1)?.kind).toBe('verified');
    expect(runtime.actionCount).toBe(2);
  });
});
