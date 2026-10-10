import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { GenerateContentResponse } from '@google/genai';
import { createGenAiClient, zodToGenAiSchema, type GenAiLike } from '../genai';
import { enrichmentOutSchema, metricOutSchema, verifyMetricOutSchema } from '../schemas';
import type { LlmClient } from '../types';

/**
 * Minimal SDK response shaped like the real one.
 *
 * Loosely typed on purpose: the SDK's response is a class with getters and
 * branded enums, and reconstructing that faithfully in a test would assert
 * things about the SDK rather than about our adapter.
 */
function res(partial: Record<string, unknown>): GenerateContentResponse {
  return partial as unknown as GenerateContentResponse;
}

/** The call signature the adapter uses — annotated so spies infer their args. */
type GenerateContent = GenAiLike['models']['generateContent'];
type GenerateArgs = Parameters<GenerateContent>[0];

function stub(impl: GenerateContent): GenAiLike {
  return { models: { generateContent: impl } };
}

describe('createGenAiClient', () => {
  it('refuses to construct without credentials — never runs unauthenticated', () => {
    expect(() => createGenAiClient({})).toThrow(/apiKey or vertex/);
  });

  it('satisfies the LlmClient contract the ADK task graph depends on', () => {
    // Compile-time proof: if the shape drifts, typecheck fails before tests do.
    const client: LlmClient = createGenAiClient({
      apiKey: 'k',
      groundedRpm: 0,
      structureRpm: 0,
      clientImpl: stub(async () => res({ text: '' })),
    });
    expect(typeof client.ground).toBe('function');
    expect(typeof client.structure).toBe('function');
  });

  it('sends the Google Search tool on every grounded call', async () => {
    const spy = vi.fn(async (_p: GenerateArgs) => res({ text: 'grounded answer' }));
    const client = createGenAiClient({
      apiKey: 'k',
      groundedRpm: 0,
      structureRpm: 0,
      clientImpl: stub(spy),
    });
    await client.ground('who leads the market?', { system: 'be terse' });

    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.config?.tools).toEqual([{ googleSearch: {} }]);
    expect(arg?.config?.systemInstruction).toBe('be terse');
  });

  it('extracts citations and search queries from grounding metadata', async () => {
    const client = createGenAiClient({
      apiKey: 'k',
      groundedRpm: 0,
      structureRpm: 0,
      clientImpl: stub(async () =>
        res({
          text: '  spaced  ',
          candidates: [
            {
              groundingMetadata: {
                groundingChunks: [
                  { web: { uri: 'https://a.com', title: 'A' } },
                  { web: { title: 'no uri — dropped' } },
                  { web: { uri: 'https://b.com' } },
                ],
                webSearchQueries: ['market leaders 2026'],
              },
            },
          ],
        }),
      ),
    });

    const out = await client.ground('q');
    expect(out.text).toBe('spaced');
    // A chunk with no URI is not a citation — it cannot be verified.
    expect(out.citations).toEqual([
      { title: 'A', url: 'https://a.com' },
      { title: 'https://b.com', url: 'https://b.com' },
    ]);
    expect(out.queries).toEqual(['market leaders 2026']);
  });

  it('throws when the prompt is blocked rather than returning empty research', async () => {
    const client = createGenAiClient({
      apiKey: 'k',
      groundedRpm: 0,
      structureRpm: 0,
      clientImpl: stub(async () => res({ text: '', promptFeedback: { blockReason: 'SAFETY' } })),
    });
    await expect(client.ground('q')).rejects.toThrow(/blocked.*SAFETY/);
  });

  it('structures JSON against a Zod schema', async () => {
    const client = createGenAiClient({
      apiKey: 'k',
      groundedRpm: 0,
      structureRpm: 0,
      clientImpl: stub(async () => res({ text: '{"name":"OpenAI","tier":8}' })),
    });
    const out = await client.structure('extract', z.object({ name: z.string(), tier: z.number() }));
    expect(out).toEqual({ name: 'OpenAI', tier: 8 });
  });

  it('requests JSON mode and passes native responseSchema when structuring', async () => {
    const spy = vi.fn(async (_p: GenerateArgs) => res({ text: '{"ok":true}' }));
    const client = createGenAiClient({
      apiKey: 'k',
      groundedRpm: 0,
      structureRpm: 0,
      clientImpl: stub(spy),
    });
    await client.structure('x', z.object({ ok: z.boolean() }));
    const cfg = spy.mock.calls[0]?.[0]?.config;
    expect(cfg?.responseMimeType).toBe('application/json');
    expect(cfg?.responseSchema).toEqual({
      type: 'OBJECT',
      properties: {
        ok: { type: 'BOOLEAN' },
      },
      required: ['ok'],
    });
  });

  it('retries a malformed structuring response exactly once, then fails loudly', async () => {
    const spy = vi.fn(async (_p: GenerateArgs) => res({ text: 'not json at all' }));
    const client = createGenAiClient({
      apiKey: 'k',
      groundedRpm: 0,
      structureRpm: 0,
      clientImpl: stub(spy),
    });
    await expect(client.structure('x', z.object({ ok: z.boolean() }))).rejects.toThrow(
      /Failed to structure/,
    );
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('reports the model and kind of every call so spend can be metered', async () => {
    const onCall = vi.fn();
    const client = createGenAiClient({
      apiKey: 'k',
      groundedRpm: 0,
      structureRpm: 0,
      model: 'gemini-3.7-flash',
      structureModel: 'gemini-3.5-flash-lite',
      onCall,
      clientImpl: stub(async () => res({ text: '{"ok":true}' })),
    });

    await client.ground('q');
    await client.structure('x', z.object({ ok: z.boolean() }));

    expect(onCall).toHaveBeenNthCalledWith(1, { model: 'gemini-3.7-flash', kind: 'ground' });
    expect(onCall).toHaveBeenNthCalledWith(2, { model: 'gemini-3.5-flash-lite', kind: 'structure' });
  });

  it('surfaces token usage telemetry to onCall when available', async () => {
    const onCall = vi.fn();
    const client = createGenAiClient({
      apiKey: 'k',
      groundedRpm: 0,
      structureRpm: 0,
      onCall,
      clientImpl: stub(async () =>
        res({
          text: 'grounded output',
          usageMetadata: {
            promptTokenCount: 150,
            candidatesTokenCount: 50,
            totalTokenCount: 200,
          },
        }),
      ),
    });

    await client.ground('test telemetry');
    expect(onCall).toHaveBeenCalledWith({
      model: expect.any(String),
      kind: 'ground',
      usage: {
        promptTokens: 150,
        candidatesTokens: 50,
        totalTokens: 200,
      },
    });
  });

  it('preserves the HTTP status from SDK errors so backoff behaves', async () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 });
    let calls = 0;
    const client = createGenAiClient({
      apiKey: 'k',
      groundedRpm: 0,
      structureRpm: 0,
      clientImpl: stub(async () => {
        calls += 1;
        if (calls === 1) throw err;
        return res({ text: 'recovered' });
      }),
    });
    const out = await client.ground('q');
    expect(out.text).toBe('recovered');
    expect(calls).toBe(2);
  });
});

describe('judge model routing (LLM as judge)', () => {
  it('dispatches verification-class calls to the judge model and marks them judge', async () => {
    const seen: Array<{ model: string; kind: string }> = [];
    const spy = vi.fn(async (_p: GenerateArgs) => res({ text: '{"ok":true}' }));
    const client = createGenAiClient({
      apiKey: 'k',
      model: 'filler-ground',
      structureModel: 'filler-structure',
      judgeModel: 'judge-x',
      groundedRpm: 0,
      structureRpm: 0,
      onCall: (info) => seen.push(info),
      clientImpl: stub(spy),
    });

    // Metric verification: the verify passes tag their evidence topic `verify:*`.
    await client.ground('recheck the figure', { researchContext: { topic: 'verify:arr' } });
    // The red-team pass predates the evidence-topic taxonomy and marks its prompt.
    await client.ground('RED-TEAM these stored figures');
    // Verdict steps validate against the verification output schemas.
    await client.structure('notes', verifyMetricOutSchema);

    const models = spy.mock.calls.map((c) => c[0]?.model);
    expect(models).toEqual(['judge-x', 'judge-x', 'judge-x']);
    expect(seen.map((c) => c.kind)).toEqual(['judge', 'judge', 'judge']);
  });

  it('keeps fill calls on the filler lines, and an unset judge byte-identical to today', async () => {
    const seen: Array<{ model: string; kind: string }> = [];
    const client = createGenAiClient({
      apiKey: 'k',
      model: 'filler-ground',
      structureModel: 'filler-structure',
      groundedRpm: 0,
      structureRpm: 0,
      onCall: (info) => seen.push(info),
      clientImpl: stub(async () => res({ text: '{"ok":true}' })),
    });

    // Dashboard-fill calls are not verification-class: they stay on the filler.
    await client.ground('fill this dashboard');
    await client.structure('x', z.object({ ok: z.boolean() }));
    // Verification-class calls with no judge configured ride today's lines.
    await client.ground('recheck', { researchContext: { topic: 'verify:arr' } });
    await client.structure('notes', verifyMetricOutSchema);

    expect(seen).toEqual([
      { model: 'filler-ground', kind: 'ground' },
      { model: 'filler-structure', kind: 'structure' },
      { model: 'filler-ground', kind: 'ground' },
      { model: 'filler-structure', kind: 'structure' },
    ]);
  });
});

describe('zodToGenAiSchema — the native responseSchema handed to Gemini (issue #48)', () => {
  it('emits a real enum for a constrained field, not a free string', () => {
    const schema = zodToGenAiSchema(z.object({ verdict: z.enum(['supported', 'contradicted']) }));
    const verdict = (schema.properties as Record<string, Record<string, unknown>>).verdict!;
    expect(verdict.enum).toEqual(['supported', 'contradicted']);
  });

  it('excludes user_verified from the confidence a model can even emit', () => {
    // The gate is cheapest at generation time: if the enum never offers
    // `user_verified`, a conforming model cannot forge a human sign-off.
    const schema = zodToGenAiSchema(metricOutSchema);
    const confidence = (schema.properties as Record<string, Record<string, unknown>>).confidence!;
    expect(confidence.enum).toEqual(['verified', 'estimated', 'unknown']);
    expect(confidence.enum).not.toContain('user_verified');
  });

  it('constrains the funding round type a model may report', () => {
    const schema = zodToGenAiSchema(enrichmentOutSchema);
    const props = schema.properties as Record<string, Record<string, unknown>>;
    const facts = props.facts!.properties as Record<string, Record<string, unknown>>;
    const round = facts.lastFundingRound!.properties as Record<string, Record<string, unknown>>;
    expect(round.roundType!.enum).toContain('series_a');
    expect(round.roundType!.type).toBe('STRING');
  });
});
