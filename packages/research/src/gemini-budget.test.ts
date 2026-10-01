import { describe, expect, it, vi } from 'vitest';
import { createGeminiClient } from './gemini';
import { createResearchUsageMeter } from './usage-meter';

describe('raw Gemini budget enforcement', () => {
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
