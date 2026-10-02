import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createGeminiClient } from './gemini';
import { createResearchUsageMeter } from './usage-meter';

describe('raw Gemini budget enforcement', () => {
  describe.each(['ground', 'structure'] as const)('%s thinking-token accounting', (kind) => {
    function fixture(usageMetadata: unknown, maxOutputTokens = 9) {
      const fetchImpl = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
              usageMetadata,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      );
      const meter = createResearchUsageMeter({
        maxRequests: 2,
        maxInputTokens: 10_000,
        maxOutputTokens,
      });
      const client = createGeminiClient({
        apiKey: 'test',
        groundedRpm: 0,
        structureRpm: 0,
        fetchImpl: fetchImpl as typeof fetch,
      });
      const call = () =>
        kind === 'ground'
          ? client.ground('test', { usageMeter: meter })
          : client.structure('test', z.object({ ok: z.boolean() }), { usageMeter: meter });
      return { fetchImpl, meter, call };
    }

    it('charges candidate plus thinking tokens and blocks the next dispatch', async () => {
      const { fetchImpl, meter, call } = fixture({
        promptTokenCount: 30,
        candidatesTokenCount: 4,
        thoughtsTokenCount: 5,
        totalTokenCount: 39,
      });
      await call();
      expect(meter.snapshot()).toEqual({
        requests: 1,
        inputTokens: 30,
        outputTokens: 9,
        complete: true,
      });
      await expect(call()).rejects.toThrow(/output token limit/i);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it.each([
      {
        label: 'absent thoughts',
        usage: { promptTokenCount: 30, candidatesTokenCount: 4, totalTokenCount: 34 },
      },
      {
        label: 'zero thoughts',
        usage: {
          promptTokenCount: 30,
          candidatesTokenCount: 4,
          thoughtsTokenCount: 0,
          totalTokenCount: 34,
        },
      },
      {
        label: 'absent optional total',
        usage: { promptTokenCount: 30, candidatesTokenCount: 4, thoughtsTokenCount: 5 },
      },
      {
        label: 'zero counts',
        usage: {
          promptTokenCount: 0,
          candidatesTokenCount: 0,
          thoughtsTokenCount: 0,
          totalTokenCount: 0,
        },
      },
    ])('settles valid $label without double-counting totals', async ({ usage }) => {
      const { fetchImpl, meter, call } = fixture(usage);
      await call();
      expect(meter.snapshot()).toEqual({
        requests: 1,
        inputTokens: usage.promptTokenCount,
        outputTokens:
          usage.candidatesTokenCount +
          ('thoughtsTokenCount' in usage ? usage.thoughtsTokenCount! : 0),
        complete: true,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it.each([
      { label: 'missing metadata', usage: undefined },
      { label: 'null metadata', usage: null },
      { label: 'missing prompt', usage: { candidatesTokenCount: 4, thoughtsTokenCount: 5 } },
      { label: 'missing candidates', usage: { promptTokenCount: 30, thoughtsTokenCount: 5 } },
      {
        label: 'unreported thoughts in total',
        usage: { promptTokenCount: 30, candidatesTokenCount: 4, totalTokenCount: 39 },
      },
      {
        label: 'total below sum',
        usage: {
          promptTokenCount: 30,
          candidatesTokenCount: 4,
          thoughtsTokenCount: 5,
          totalTokenCount: 34,
        },
      },
      {
        label: 'total above sum',
        usage: {
          promptTokenCount: 30,
          candidatesTokenCount: 4,
          thoughtsTokenCount: 5,
          totalTokenCount: 40,
        },
      },
      {
        label: 'negative thoughts',
        usage: { promptTokenCount: 30, candidatesTokenCount: 4, thoughtsTokenCount: -1 },
      },
      {
        label: 'fractional thoughts',
        usage: { promptTokenCount: 30, candidatesTokenCount: 4, thoughtsTokenCount: 0.5 },
      },
      {
        label: 'string thoughts',
        usage: { promptTokenCount: 30, candidatesTokenCount: 4, thoughtsTokenCount: '5' },
      },
      {
        label: 'null thoughts',
        usage: { promptTokenCount: 30, candidatesTokenCount: 4, thoughtsTokenCount: null },
      },
      {
        label: 'invalid candidates',
        usage: { promptTokenCount: 30, candidatesTokenCount: -1, thoughtsTokenCount: 5 },
      },
      {
        label: 'invalid prompt',
        usage: { promptTokenCount: 0.5, candidatesTokenCount: 4, thoughtsTokenCount: 5 },
      },
      {
        label: 'invalid total',
        usage: {
          promptTokenCount: 30,
          candidatesTokenCount: 4,
          thoughtsTokenCount: 5,
          totalTokenCount: '39',
        },
      },
      {
        label: 'unsafe thoughts',
        usage: {
          promptTokenCount: 30,
          candidatesTokenCount: 4,
          thoughtsTokenCount: Number.MAX_SAFE_INTEGER + 1,
        },
      },
      {
        label: 'overflowing output sum',
        usage: {
          promptTokenCount: 0,
          candidatesTokenCount: Number.MAX_SAFE_INTEGER,
          thoughtsTokenCount: 1,
        },
      },
    ])('retains reservations for $label instead of releasing allowance', async ({ usage }) => {
      const { fetchImpl, meter, call } = fixture(usage);
      await call();
      expect(meter.snapshot()).toMatchObject({ requests: 1, outputTokens: 9, complete: false });
      expect(meter.snapshot().inputTokens).toBeGreaterThan(30);
      await expect(call()).rejects.toThrow(/output token limit/i);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('rejects reported thinking usage over the grant without retrying or releasing it', async () => {
      const { fetchImpl, meter, call } = fixture({
        promptTokenCount: 30,
        candidatesTokenCount: 4,
        thoughtsTokenCount: 6,
        totalTokenCount: 40,
      });
      await expect(call()).rejects.toThrow(/output token limit/i);
      expect(meter.snapshot()).toMatchObject({ requests: 1, outputTokens: 9, complete: false });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  it('caps output before dispatch and reconciles reported token usage', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        generationConfig: { maxOutputTokens?: number };
      };
      expect(body.generationConfig.maxOutputTokens).toBe(9);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'grounded' }] } }],
          usageMetadata: {
            promptTokenCount: 30,
            candidatesTokenCount: 4,
            totalTokenCount: 34,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const meter = createResearchUsageMeter({
      maxRequests: 1,
      maxInputTokens: 10_000,
      maxOutputTokens: 9,
    });
    const client = createGeminiClient({
      apiKey: 'test',
      groundedRpm: 0,
      structureRpm: 0,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await client.ground('test', { usageMeter: meter });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(meter.snapshot()).toEqual({
      requests: 1,
      inputTokens: 30,
      outputTokens: 4,
      complete: true,
    });
  });

  it('counts retries as attempts and refuses an over-budget retry before fetch', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 429 }));
    const meter = createResearchUsageMeter({
      maxRequests: 1,
      maxInputTokens: 10_000,
      maxOutputTokens: 9,
    });
    const client = createGeminiClient({
      apiKey: 'test',
      groundedRpm: 0,
      structureRpm: 0,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(client.ground('test', { usageMeter: meter })).rejects.toThrow(/request limit/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(meter.snapshot()).toMatchObject({ requests: 1, complete: false });
  });
});
