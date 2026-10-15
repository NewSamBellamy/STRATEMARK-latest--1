import { expect, it, vi } from 'vitest';
import { createGeminiClient } from './gemini';

const grounded = (usageMetadata?: unknown) => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: 'answer' }] },
    groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/a', title: 'A' } }], webSearchQueries: ['q one', 'q two', 'q three'] } }],
  ...(usageMetadata ? { usageMetadata } : {}),
}), { status: 200 });

it('reports the tokens and searches of each call and adds them up for the run', async () => {
  const onCallMetrics = vi.fn();
  const fetchImpl = vi.fn(async () => grounded({ promptTokenCount: 2000, toolUsePromptTokenCount: 6000, candidatesTokenCount: 500, thoughtsTokenCount: 100 }));
  const client = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl, onCallMetrics });
  await client.ground('prompt');
  const [metrics] = onCallMetrics.mock.calls.at(-1)!;
  expect(metrics.usage).toEqual({ inputTokens: 8000, outputTokens: 600 });
  expect(metrics.searchQueries).toBe(3);
  const total = client.metrics!();
  expect(total).toMatchObject({ calls: 1, inputTokens: 8000, outputTokens: 600, searchQueries: 3 });
  // Lite line: 8000 in at $0.30/M + 600 out at $2.50/M, plus 3 searches at $0.014 (above the one-prompt floor).
  expect(total.estCostUsd).toBeCloseTo(0.0024 + 0.0015 + 0.042, 6);
});

it('counts a response with no usage report as a call with no tokens, never as tokens made up', async () => {
  const onCallMetrics = vi.fn();
  const client = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl: vi.fn(async () => grounded()), onCallMetrics });
  await client.ground('prompt');
  const [metrics] = onCallMetrics.mock.calls.at(-1)!;
  expect(metrics.usage).toBeUndefined();
  expect(client.metrics!()).toMatchObject({ calls: 1, inputTokens: 0, outputTokens: 0, searchQueries: 3 });
});
