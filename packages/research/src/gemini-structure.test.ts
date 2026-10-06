import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createGeminiClient } from './gemini';

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
