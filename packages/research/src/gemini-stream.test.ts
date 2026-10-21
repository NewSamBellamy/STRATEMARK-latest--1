/** Streaming grounded answers (streamGenerateContent?alt=sse). */
import { describe, expect, it, vi } from 'vitest';
import { createGeminiClient, readGeminiSse } from './gemini';

const sse = (chunks: unknown[], split = false) => {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join('');
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Split mid-event to prove the reader reassembles events across reads.
      const parts = split ? [body.slice(0, 17), body.slice(17, 60), body.slice(60)] : [body];
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};
const chunk = (text: string, extra: Record<string, unknown> = {}) => ({ candidates: [{ content: { parts: [{ text }] }, ...extra }] });
const metadata = { groundingMetadata: { groundingChunks: [{ web: { uri: 'https://a.com/x', title: 'a.com' } }], webSearchQueries: ['q'] } };

describe('readGeminiSse', () => {
  it('concatenates text deltas, reports drafts and keeps the final grounding metadata', async () => {
    const drafts: string[] = [];
    const data = await readGeminiSse(sse([chunk('Plaid is '), chunk('valued at $8B.'), chunk('', metadata)], true), (t) => drafts.push(t));
    expect(drafts).toEqual(['Plaid is ', 'Plaid is valued at $8B.']);
    expect(data.candidates?.[0]?.content?.parts?.[0]?.text).toBe('Plaid is valued at $8B.');
    expect(data.candidates?.[0]?.groundingMetadata?.webSearchQueries).toEqual(['q']);
  });

  it('survives a throwing draft consumer', async () => {
    const data = await readGeminiSse(sse([chunk('ok')]), () => { throw new Error('ui'); });
    expect(data.candidates?.[0]?.content?.parts?.[0]?.text).toBe('ok');
  });
});

describe('streaming ground calls', () => {
  const client = (streaming: boolean, fetchImpl: typeof fetch) =>
    createGeminiClient({ apiKey: 'k', streaming, fetchImpl, groundedRpm: 0, structureRpm: 0 });

  it('streams only when the transport opts in and a draft consumer is given', async () => {
    const fetchImpl = vi.fn(async (url: string) => url.includes(':streamGenerateContent')
      ? sse([chunk('Answer '), chunk('text.', metadata)])
      : new Response(JSON.stringify(chunk('Answer text.', metadata)), { status: 200 }));
    const drafts: string[] = [];
    const streamed = await client(true, fetchImpl as unknown as typeof fetch).ground('q', { onText: (t) => drafts.push(t) });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain(':streamGenerateContent?alt=sse');
    expect(streamed.text).toBe('Answer text.');
    expect(streamed.citations).toEqual([{ title: 'a.com', url: 'https://a.com/x' }]);
    expect(drafts.at(-1)).toBe('Answer text.');

    await client(false, fetchImpl as unknown as typeof fetch).ground('q', { onText: () => {} });
    await client(true, fetchImpl as unknown as typeof fetch).ground('q');
    expect(fetchImpl.mock.calls.slice(1).every(([url]) => String(url).endsWith(':generateContent'))).toBe(true);
  });
});
