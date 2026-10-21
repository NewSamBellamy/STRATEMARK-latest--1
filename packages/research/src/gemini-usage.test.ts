import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createGeminiClient } from './gemini';
import { usageSince } from './deck-run';

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

it('splits the run by what each call was for, so the costly topic is visible', async () => {
  const fetchImpl = vi.fn(async () => grounded({ promptTokenCount: 1000, candidatesTokenCount: 100 }));
  const client = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl });
  await client.ground('p1', { researchContext: { topic: 'team_org' } });
  await client.ground('p2', { researchContext: { topic: 'team_org' } });
  await client.ground('p3', { researchContext: { topic: 'history' } });
  await client.ground('p4');
  const by = client.metrics!().byTopic!;
  expect(by.team_org!.calls).toBe(2);
  expect(by.history!.calls).toBe(1);
  expect(by.ground!.calls).toBe(1);
  expect(by.team_org!.estCostUsd).toBeGreaterThan(by.history!.estCostUsd);
  expect(Object.values(by).reduce((n, r) => n + r.estCostUsd, 0)).toBeCloseTo(client.metrics!().estCostUsd!, 9);
});

it('an explicit cost label wins over the research topic, and never reaches the request body', async () => {
  const bodies: string[] = [];
  const fetchImpl = vi.fn(async (_url: unknown, init?: { body?: string }) => { bodies.push(String(init?.body ?? '')); return grounded({ promptTokenCount: 10, candidatesTokenCount: 5 }); });
  const client = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl: fetchImpl as unknown as typeof fetch });
  await client.ground('p', { label: 'tab:history', researchContext: { topic: 'history' } });
  await client.ground('q', { label: 'market:discover' });
  const by = client.metrics!().byTopic!;
  expect(by['tab:history']!.calls).toBe(1);
  expect(by['market:discover']!.calls).toBe(1);
  expect(by.history).toBeUndefined();
  expect(bodies.join(' ')).not.toContain('market:discover');
  expect(bodies.join(' ')).not.toContain('tab:history');
});

it('a baseline taken before a deck started does not follow the counters afterwards (per-topic spend survives)', async () => {
  const client = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl: vi.fn(async () => grounded({ promptTokenCount: 1000, candidatesTokenCount: 100 })) });
  await client.ground('earlier chat', { label: 'chat' });
  const base = client.metrics!();
  await client.ground('p1', { label: 'tab:history' });
  await client.ground('p2', { label: 'tab:history' });
  await client.ground('p3', { label: 'tab:team_org' });
  // The baseline still says one call; it was not edited by the three that followed.
  expect(base.byTopic).toEqual({ chat: expect.objectContaining({ calls: 1 }) });
  const used = usageSince(client.metrics!(), base)!;
  expect(used.calls).toBe(3);
  expect(used.byTopic).toEqual({ 'tab:history': expect.objectContaining({ calls: 2 }), 'tab:team_org': expect.objectContaining({ calls: 1 }) });
});

it('an extraction call is booked to its cost label too, which never reaches the request body', async () => {
  const bodies: string[] = [];
  const fetchImpl = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    bodies.push(String(init?.body ?? ''));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }), { status: 200 });
  });
  const client = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl: fetchImpl as unknown as typeof fetch });
  await client.structure('p', z.object({ a: z.number() }), { label: 'tab:history' });
  expect(client.metrics!().byTopic!['tab:history']!.calls).toBe(1);
  expect(bodies.join(' ')).not.toContain('tab:history');
});
