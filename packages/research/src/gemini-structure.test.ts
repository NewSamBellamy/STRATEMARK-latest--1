import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createGeminiClient } from './gemini';
import { verifyMetricOutSchema } from './schemas';

describe('Gemini structured-output repair', () => {
  it('tells the retry which required field was missing without accepting the invalid response', async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body));
      const output = bodies.length === 1 ? { marketName: 'Software' } : { marketName: 'Software', vertical: 'Software' };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const client = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl });
    expect(await client.structure('Define this market', z.object({ marketName: z.string(), vertical: z.string() })))
      .toEqual({ marketName: 'Software', vertical: 'Software' });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toContain('vertical');
    expect(bodies[1]).toContain('validation');
  });
});

describe('judge model routing (LLM as judge)', () => {
  /** The URL path names the model line, so recorded URLs are the dispatch record. */
  function recordingFetch(urls: string[]): typeof fetch {
    return vi.fn(async (url: unknown) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  }

  it('dispatches verification-class calls to the judge model and marks them judge', async () => {
    const urls: string[] = [];
    const onCall = vi.fn();
    const client = createGeminiClient({
      apiKey: 'test-placeholder',
      model: 'filler-ground',
      structureModel: 'filler-structure',
      judgeModel: 'judge-x',
      groundedRpm: 0,
      structureRpm: 0,
      onCall,
      fetchImpl: recordingFetch(urls),
    });

    await client.ground('fill this dashboard');
    await client.ground('recheck the figure', { researchContext: { topic: 'verify:arr' } });
    await client.ground('RED-TEAM these stored figures');
    await client.structure('notes', verifyMetricOutSchema);
    await client.structure('extract', z.object({ ok: z.boolean() }));

    const lines = urls.map((url) => /\/([^/]+):generateContent$/.exec(url)?.[1]);
    expect(lines).toEqual(['filler-ground', 'judge-x', 'judge-x', 'judge-x', 'filler-structure']);
    expect(onCall.mock.calls.map((c) => (c[0] as { kind: string }).kind))
      .toEqual(['ground', 'judge', 'judge', 'judge', 'structure']);
  });

  it('with no judge configured, verification calls ride today’s lines byte-identically', async () => {
    const urls: string[] = [];
    const onCall = vi.fn();
    const client = createGeminiClient({
      apiKey: 'test-placeholder',
      model: 'filler-ground',
      structureModel: 'filler-structure',
      groundedRpm: 0,
      structureRpm: 0,
      onCall,
      fetchImpl: recordingFetch(urls),
    });

    await client.ground('fill this dashboard');
    await client.ground('recheck the figure', { researchContext: { topic: 'verify:arr' } });
    await client.ground('RED-TEAM these stored figures');
    await client.structure('notes', verifyMetricOutSchema);
    await client.structure('extract', z.object({ ok: z.boolean() }));

    const lines = urls.map((url) => /\/([^/]+):generateContent$/.exec(url)?.[1]);
    expect(lines).toEqual([
      'filler-ground', 'filler-ground', 'filler-ground', 'filler-structure', 'filler-structure',
    ]);
    expect(onCall.mock.calls.map((c) => (c[0] as { model: string; kind: string }).kind))
      .toEqual(['ground', 'ground', 'ground', 'structure', 'structure']);
  });
});
