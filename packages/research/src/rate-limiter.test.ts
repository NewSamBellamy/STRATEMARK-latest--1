import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from './util';

describe('call pacing', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('holds to the per-minute cap and releases waiters as the window rolls', async () => {
    const limiter = createRateLimiter(2);
    const granted: number[] = [];
    for (const n of [1, 2, 3]) void limiter.acquire().then(() => granted.push(n));
    await vi.advanceTimersByTimeAsync(0);
    expect(granted).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(granted).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(granted).toEqual([1, 2, 3]);
  });

  it('serves an urgent call ahead of queued bulk work, without exceeding the cap', async () => {
    const limiter = createRateLimiter(1);
    const granted: string[] = [];
    for (const n of ['bulk-1', 'bulk-2', 'bulk-3']) void limiter.acquire().then(() => granted.push(n));
    void limiter.acquire(undefined, 'urgent').then(() => granted.push('signals'));
    await vi.advanceTimersByTimeAsync(0);
    expect(granted).toEqual(['bulk-1']);
    await vi.advanceTimersByTimeAsync(60_100);
    expect(granted).toEqual(['bulk-1', 'signals']);
    await vi.advanceTimersByTimeAsync(60_100);
    expect(granted).toEqual(['bulk-1', 'signals', 'bulk-2']);
  });

  it('keeps headroom for an urgent call when bulk work has filled the window (the compare waited a minute)', async () => {
    const limiter = createRateLimiter(10);
    const granted: string[] = [];
    for (let n = 1; n <= 14; n += 1) void limiter.acquire().then(() => granted.push(`bulk-${n}`));
    await vi.advanceTimersByTimeAsync(0);
    // Bulk work may not use the whole cap: nine slots go out, one stays open.
    expect(granted).toHaveLength(9);
    await vi.advanceTimersByTimeAsync(1_000);
    void limiter.acquire(undefined, 'urgent').then(() => granted.push('compare'));
    await vi.advanceTimersByTimeAsync(0);
    expect(granted).toHaveLength(10);
    expect(granted.at(-1)).toBe('compare');
    // The cap itself holds: a second urgent call waits for the window like anyone else.
    void limiter.acquire(undefined, 'urgent').then(() => granted.push('compare-2'));
    await vi.advanceTimersByTimeAsync(0);
    expect(granted).not.toContain('compare-2');
    await vi.advanceTimersByTimeAsync(59_200);
    expect(granted).toContain('compare-2');
  });

  it('does not reserve anything on a tiny cap, where one slot is all there is', async () => {
    const limiter = createRateLimiter(2);
    const granted: number[] = [];
    for (const n of [1, 2]) void limiter.acquire().then(() => granted.push(n));
    await vi.advanceTimersByTimeAsync(0);
    expect(granted).toEqual([1, 2]);
  });

  it('drops a cancelled waiter from the queue so it never spends a slot', async () => {
    const limiter = createRateLimiter(1);
    const granted: string[] = [];
    void limiter.acquire().then(() => granted.push('first'));
    const controller = new AbortController();
    const cancelled = limiter.acquire(controller.signal);
    void limiter.acquire().then(() => granted.push('next'));
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(60_100);
    expect(granted).toEqual(['first', 'next']);
  });
});

describe('adaptive pacing', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** Keep the queue busy for a minute so the limiter is saturated, then report a success. */
  async function saturatedMinute(limiter: ReturnType<typeof createRateLimiter>) {
    for (let n = 0; n < 200; n += 1) void limiter.acquire();
    await vi.advanceTimersByTimeAsync(60_100);
    limiter.feedback('ok');
  }

  it('never moves without a ceiling', async () => {
    const limiter = createRateLimiter(10);
    await saturatedMinute(limiter);
    limiter.feedback('rate-limited');
    expect(limiter.currentLimit()).toBe(10);
  });

  it('rises toward its ceiling, a step per saturated minute, and stops there', async () => {
    const limiter = createRateLimiter(10, { ceiling: 30 });
    await saturatedMinute(limiter);
    expect(limiter.currentLimit()).toBe(15);
    await saturatedMinute(limiter);
    expect(limiter.currentLimit()).toBe(23);
    await saturatedMinute(limiter);
    expect(limiter.currentLimit()).toBe(30);
    await saturatedMinute(limiter);
    expect(limiter.currentLimit()).toBe(30);
  });

  it('lets more calls through once it has risen', async () => {
    const limiter = createRateLimiter(10, { ceiling: 60 });
    const granted: number[] = [];
    for (let n = 0; n < 300; n += 1) void limiter.acquire().then(() => granted.push(n));
    await vi.advanceTimersByTimeAsync(0);
    const firstMinute = granted.length;
    expect(firstMinute).toBeLessThanOrEqual(10);
    limiter.feedback('ok');
    await vi.advanceTimersByTimeAsync(60_100);
    limiter.feedback('ok');
    await vi.advanceTimersByTimeAsync(0);
    expect(limiter.currentLimit()).toBeGreaterThan(10);
    expect(granted.length - firstMinute).toBeGreaterThan(10);
  });

  it('does not rise when the queue is not using the cap: a quiet limiter has learned nothing', async () => {
    const limiter = createRateLimiter(10, { ceiling: 60 });
    void limiter.acquire();
    await vi.advanceTimersByTimeAsync(61_000);
    limiter.feedback('ok');
    expect(limiter.currentLimit()).toBe(10);
  });

  it('backs off when a call is rate-limited, never below its base, and holds before trying again', async () => {
    const limiter = createRateLimiter(10, { ceiling: 60 });
    await saturatedMinute(limiter);
    await saturatedMinute(limiter);
    expect(limiter.currentLimit()).toBe(23);
    limiter.feedback('rate-limited');
    expect(limiter.currentLimit()).toBe(13);
    limiter.feedback('rate-limited');
    expect(limiter.currentLimit()).toBe(10);
    // Held for five minutes: saturated minutes in that time do not raise it.
    await saturatedMinute(limiter);
    await saturatedMinute(limiter);
    expect(limiter.currentLimit()).toBe(10);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await saturatedMinute(limiter);
    expect(limiter.currentLimit()).toBe(15);
  });
});
