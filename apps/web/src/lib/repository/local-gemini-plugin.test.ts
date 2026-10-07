import { describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { localGeminiPlugin } from '../../../local-gemini-plugin';

describe('guarded development Gemini bridge', () => {
  async function run(action: (origin: string, upstream: ReturnType<typeof vi.fn>) => Promise<void>) {
    const upstream = vi.fn(async () => new Response('{"candidates":[]}', { status: 200 }));
    let handler: ((req: IncomingMessage, res: ServerResponse, next: () => void) => void) | undefined;
    const plugin = localGeminiPlugin(upstream);
    const configure = plugin.configureServer as (server: unknown) => void;
    configure({ middlewares: { use: (fn: typeof handler) => { handler = fn; } } });
    const server = createServer((req, res) => {
      handler!(req, res, () => { res.statusCode = 404; res.end(); });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    try { await action(origin, upstream); } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }
  const headers = (origin: string) => ({ Origin: origin, 'Content-Type': 'application/json',
    'X-Stratemark-Source': 'local-preview', 'X-Goog-Api-Key': 'test-placeholder' });

  it('forwards only a fixed Google generateContent route without persisting a key', () => run(async (origin, upstream) => {
    const response = await fetch(`${origin}/__stratemark/gemini/gemini-2.5-flash:generateContent`, {
      method: 'POST', headers: headers(origin), body: JSON.stringify({ contents: [] }),
    });
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      expect.objectContaining({ method: 'POST', redirect: 'error', headers: expect.objectContaining({ 'x-goog-api-key': 'test-placeholder' }) }));
    expect(response.headers.get('cache-control')).toBe('no-store');
  }));
  it.each(['https://evil.example', 'http://localhost:1234'])('rejects a foreign origin %s before forwarding credentials', alien => run(async (origin, upstream) => {
    const response = await fetch(`${origin}/__stratemark/gemini/gemini-2.5-flash:generateContent`, {
      method: 'POST', headers: headers(alien), body: '{}',
    });
    expect(response.status).toBe(403); expect(upstream).not.toHaveBeenCalled();
  }));
  it('rejects missing marker, invalid JSON, and non-Google paths', () => run(async (origin, upstream) => {
    const noMarker = { ...headers(origin), 'X-Stratemark-Source': '' };
    expect((await fetch(`${origin}/__stratemark/gemini/gemini-2.5-flash:generateContent`, { method: 'POST', headers: noMarker, body: '{}' })).status).toBe(403);
    expect((await fetch(`${origin}/__stratemark/gemini/gemini-2.5-flash:generateContent`, { method: 'POST', headers: headers(origin), body: 'invalid' })).status).toBe(400);
    expect((await fetch(`${origin}/__stratemark/gemini/arbitrary-host`, { method: 'POST', headers: headers(origin), body: '{}' })).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  }));
});
