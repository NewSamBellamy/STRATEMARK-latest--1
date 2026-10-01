import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createNativeFixtureClient, nativeFixtureFetch } from './native-fixture-client';
import * as fixture from './native-fixture-client';

afterEach(() => vi.useRealTimers());
describe('explicit synthetic provider', () => {
  it('provides distinct role research sections with explicit own-source indices and unresolved questions', async () => {
    vi.useFakeTimers();
    const schema = z.object({
      researchBrief: z.object({
        sections: z.array(
          z.object({
            section: z.string(),
            blocks: z.array(
              z.object({
                text: z.string(),
                kind: z.string(),
                sourceIndices: z.array(z.number()),
                timeWindow: z.string().nullable(),
              }),
            ),
          }),
        ),
        openQuestions: z.array(z.string()),
        limitations: z.array(z.string()),
      }),
    });
    const client = createNativeFixtureClient();
    const pending = client.structure(
      'Convert the research notes on "Alder Works" into JSON with this shape:\nNOTES:\nAlder Works schedules repairs. Birch Works supplies tooling.',
      schema,
    );
    const [result] = await Promise.all([pending, vi.runAllTimersAsync()]);
    const alder = result.researchBrief;
    expect(alder.sections[0]!.blocks[0]!.text).toMatch(/^Alder Works/);
    expect(alder.sections.map((section) => section.section)).toEqual([
      'overview',
      'offering',
      'position',
      'updates',
    ]);
    expect(alder.sections.every((section) => section.blocks.length > 0)).toBe(true);
    expect(
      alder.sections
        .flatMap((section) => section.blocks)
        .every((block) => block.sourceIndices.every((index) => index === 0)),
    ).toBe(true);
    expect(alder.openQuestions.length).toBeGreaterThan(0);
    expect(alder.limitations.join(' ')).toMatch(/synthetic/i);
    const second = client.structure(
      'Convert the research notes on "Birch Works" into JSON with this shape:\nNOTES:\nAlder Works schedules repairs. Birch Works supplies tooling.',
      schema,
    );
    const [birch] = await Promise.all([second, vi.runAllTimersAsync()]);
    expect(birch.researchBrief.sections[1]!.blocks[0]!.text).not.toBe(
      alder.sections[1]!.blocks[0]!.text,
    );
  });
  it('retains only the explicit canned source, accounting for one source request with no network', async () => {
    const beforeRequest = vi.fn();
    const result = await fixture.nativeFixtureRetrieveSource(
      'https://research-fixture.invalid/repair',
      {
        signal: new AbortController().signal,
        beforeRequest,
      },
    );
    expect(beforeRequest).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      retrievalStatus: 'retrieved',
      text: expect.stringContaining('Synthetic source text'),
    });
    expect(
      (
        await fixture.nativeFixtureRetrieveSource('https://other.invalid/source', {
          signal: new AbortController().signal,
          beforeRequest,
        })
      ).retrievalStatus,
    ).toBe('blocked');
    expect(beforeRequest).toHaveBeenCalledTimes(1);
  });
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
