import type { Plugin } from 'vite';
import { allowsLocalSourceRequest } from './src/lib/repository/local-source-policy';

/**
 * Node 24's bundled HTTP client (undici) can throw `assert(!this.paused)` from a socket event when an upstream
 * connection ends while an aborted response is still being read. The throw is in an event handler, so no
 * try/catch around the fetch sees it: it ends the whole dev server. The app aborts requests on purpose (a search
 * past its deadline, a fallback line taking over), so a research run on the preview ended the server mid-run on
 * 2026-10-18 (this assertion is in the log of the second death), and the page then hung on refused connections.
 */
export function isUndiciPauseAssertion(error: unknown): boolean {
  return error instanceof Error && error.name === 'AssertionError' && /assert\(!this\.paused\)/.test(error.message)
    && /undici/i.test(error.stack ?? '');
}

let guarded = false;
/** Ignore exactly that assertion, once per process; every other uncaught error still ends the process as before. */
function guardDevServerFromUndiciAbort(): void {
  if (guarded) return;
  guarded = true;
  process.on('uncaughtException', (error) => {
    if (isUndiciPauseAssertion(error)) {
      console.warn('[stratemark-local-gemini] ignored a Node/undici socket assertion after an aborted request');
      return;
    }
    console.error(error);
    process.exit(1);
  });
}

/** Local development only; no generic URL proxy, key storage or request logging. */
export function localGeminiPlugin(upstream: typeof fetch = fetch): Plugin {
  let active = 0;
  return { name: 'stratemark-local-gemini', apply: 'serve', configureServer(server) {
    guardDevServerFromUndiciAbort();
    server.middlewares.use((req, res, next) => {
      const match = req.url?.match(/^\/__stratemark\/gemini\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,119}):generateContent$/);
      if (!match) return next();
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      const header = (name: string) => typeof req.headers[name] === 'string' ? req.headers[name] as string : undefined;
      if (!allowsLocalSourceRequest(req.method, header('host'), header('origin'), req.socket.remoteAddress, header('x-stratemark-source'))) {
        res.statusCode = 403; res.end('{}'); return;
      }
      const key = header('x-goog-api-key');
      if (header('content-type') !== 'application/json' || !key || key.length > 300 || /[^\x20-\x7e]/.test(key)) {
        res.statusCode = 400; res.end('{}'); return;
      }
      if (active >= 8) { res.statusCode = 429; res.end('{}'); return; }
      active++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      const disconnect = () => { if (!res.writableEnded) controller.abort(); };
      res.once('close', disconnect);
      void (async () => {
        try {
          let body = '';
          for await (const chunk of req) {
            body += String(chunk);
            if (Buffer.byteLength(body) > 1_048_576) { res.statusCode = 413; res.end('{}'); return; }
          }
          let input: unknown;
          try { input = JSON.parse(body); } catch { res.statusCode = 400; res.end('{}'); return; }
          if (!input || typeof input !== 'object' || Array.isArray(input)) { res.statusCode = 400; res.end('{}'); return; }
          const response = await upstream(`https://generativelanguage.googleapis.com/v1beta/models/${match[1]}:generateContent`, {
            method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body, signal: controller.signal,
          });
          const data = await response.text();
          if (controller.signal.aborted || res.destroyed) return;
          if (Buffer.byteLength(data) > 4_194_304) { res.statusCode = 502; res.end('{}'); return; }
          res.statusCode = response.status;
          const retryAfter = response.headers.get('retry-after');
          if (retryAfter && /^\d{1,4}$/.test(retryAfter)) res.setHeader('Retry-After', retryAfter);
          res.end(data);
        } catch { if (!res.destroyed) { res.statusCode = controller.signal.aborted ? 504 : 502; res.end('{}'); } }
        finally { clearTimeout(timer); res.removeListener('close', disconnect); active--; }
      })();
    });
  } };
}
