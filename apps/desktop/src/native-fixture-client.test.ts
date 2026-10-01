import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createNativeFixtureClient, nativeFixtureFetch } from './native-fixture-client';

afterEach(() => vi.useRealTimers());
describe('explicit synthetic provider', () => {
  it('uses a metered synthetic response and fails one unfinished company only once', async () => {
    vi.useFakeTimers();
    const client = createNativeFixtureClient();
    const beginAttempt = vi.fn(() => ({ id: 1, maxOutputTokens: 600 }));
    const settleAttempt = vi.fn();
    const options = {
      usageMeter: {
        beginAttempt,
        settleAttempt,
        snapshot: () => ({ requests: 1, inputTokens: 1, outputTokens: 1, complete: true }),
      },
    };
    const first = client.ground('Research Birch Works', options);
    const failed = expect(first).rejects.toThrow('Synthetic provider failure');
    await vi.runAllTimersAsync();
    await failed;
    const retry = client.ground('Research Birch Works', options);
    await vi.runAllTimersAsync();
    expect((await retry).text).toContain('SYNTHETIC FIXTURE');
    expect(beginAttempt).toHaveBeenCalledTimes(2);
    expect(settleAttempt).toHaveBeenCalledTimes(2);
    const discovery = client.structure(
      'output "companies"',
      z.object({ companies: z.array(z.object({ name: z.string(), domain: z.string() })) }),
    );
    await vi.runAllTimersAsync();
    expect((await discovery).companies.map((entry) => entry.domain)).toEqual([
      'alder-fixture.invalid',
      'birch-fixture.invalid',
    ]);
    expect((await nativeFixtureFetch('https://fixture.invalid')).status).toBe(404);
  });

  it('honors interruption without pretending the attempt completed', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const promise = createNativeFixtureClient().ground('fixture', { signal: controller.signal });
    const rejected = expect(promise).rejects.toThrow('interrupted');
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});
