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
