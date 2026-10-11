import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { OriginalSourceReceipt, OriginalSourceScope } from '@mi/research';
import { allowsLocalSourceRequest } from './src/lib/repository/local-source-policy';
import type * as WebSearchModule from '../../packages/research/src/web-search';
import type * as NewsSearchModule from '../../packages/research/src/news-search';

type Header = (name: string) => string | undefined;
interface JsonReply { status?: number; json: unknown }

/**
 * One local JSON route: same-origin policy, JSON content type, a shared
 * concurrency cap and a bounded body. The handler gets the parsed body and
 * returns the reply; a throw is a 400. Responses are never cached.
 */
interface JsonRoute {
  path: string;
  maxBody: number;
  handle(body: unknown, header: Header): Promise<JsonReply>;
}

const MAX_ACTIVE = 6;

async function readBody(req: IncomingMessage, maxBody: number): Promise<string | null> {
  let body = '';
  for await (const chunk of req) {
    body += String(chunk);
    if (Buffer.byteLength(body) > maxBody) return null;
  }
  return body;
}

function mountJsonRoutes(server: ViteDevServer, routes: readonly JsonRoute[]): void {
  let active = 0;
  server.middlewares.use((req, res, next) => {
    const route = routes.find((r) => r.path === req.url);
    if (!route) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    const header: Header = (name) => typeof req.headers[name] === 'string' ? req.headers[name] as string : undefined;
    const reply = ({ status = 200, json }: JsonReply) => { res.statusCode = status; res.end(JSON.stringify(json)); };
    if (!allowsLocalSourceRequest(req.method, header('host'), header('origin'), req.socket.remoteAddress, header('x-stratemark-source'))) {
      return reply({ status: 403, json: {} });
    }
    if (header('content-type') !== 'application/json') return reply({ status: 415, json: {} });
    if (active >= MAX_ACTIVE) return reply({ status: 429, json: {} });
    active++;
    void (async () => {
      try {
        const body = await readBody(req, route.maxBody);
        reply(body === null ? { status: 413, json: {} } : await route.handle(JSON.parse(body), header));
      } catch {
        reply({ status: 400, json: {} });
      } finally {
        active--;
      }
    })();
  });
}

function validScope(scope: unknown): scope is OriginalSourceScope | undefined {
  if (scope === undefined) return true;
  const s = scope as Partial<OriginalSourceScope> | null;
  return !!s && typeof s.companyName === 'string' && s.companyName.length <= 300 &&
    typeof s.companyId === 'string' && s.companyId.length <= 300 &&
    (s.metricType === undefined || (typeof s.metricType === 'string' && s.metricType.length <= 100));
}

/** No production hook: this bridge exists only on Vite's local dev server. */
export function localSourcePlugin(): Plugin {
  return {
    name: 'stratemark-local-source', apply: 'serve',
    configureServer(server) {
      // Load workspace TypeScript through Vite, not Node's extensionless ESM resolver.
      const research = (file: string) => fileURLToPath(new URL(`../../packages/research/src/${file}`, import.meta.url));
      mountJsonRoutes(server, [
        {
          path: '/__stratemark/source', maxBody: 8192,
          async handle(body) {
            const input = body as { url?: unknown; scope?: unknown };
            if (typeof input.url !== 'string' || input.url.length > 2048 || !validScope(input.scope)) return { status: 400, json: {} };
            const reader = await server.ssrLoadModule(research('original-source.node.ts')) as {
              retrieveOriginalSource: (url: string, io: undefined, scope?: OriginalSourceScope) => Promise<OriginalSourceReceipt>;
            };
            return { json: await reader.retrieveOriginalSource(input.url, undefined, input.scope) };
          },
        },
        {
          path: '/__stratemark/asset-source', maxBody: 8192,
          async handle(body) {
            const url = (body as { url?: unknown }).url;
            return { json: await readRawAssetPage(typeof url === 'string' ? url : '') };
          },
        },
        {
          // Provider APIs are not all browser-callable (CORS). The user's key
          // arrives in X-Search-Key for this one request; without it a
          // <PROVIDER>_API_KEY in the dev environment stands in. Never logged.
          path: '/__stratemark/search', maxBody: 4096,
          async handle(body, header) {
            const search = await server.ssrLoadModule(research('web-search.ts')) as typeof WebSearchModule;
            const input = search.parseSearchRelayRequest(body);
            if (!input) return { status: 400, json: {} };
            const key = header('x-search-key') ?? process.env[`${input.provider.toUpperCase()}_API_KEY`];
            if (!search.isPlausibleSearchKey(key)) return { status: 401, json: { error: 'No search key is connected. Add one in Settings.' } };
            try {
              return { json: { results: await search.runProviderSearch(input.provider, key, input.query, fetch, undefined, input) } };
            } catch (error) {
              const status = error instanceof search.WebSearchError ? error.status : 502;
              return { status: status >= 400 && status < 600 ? status : 502,
                json: { error: error instanceof search.WebSearchError ? error.message : 'Search failed.' } };
            }
          },
        },
        {
          // Free news lane: no key. Failures are an empty result, never an error.
          path: '/__stratemark/news', maxBody: 1024,
          async handle(body) {
            const news = await server.ssrLoadModule(research('news-search.ts')) as typeof NewsSearchModule;
            const input = news.parseNewsRelayRequest(body);
            if (!input) return { status: 400, json: {} };
            return { json: { results: await news.runNewsSearch(input.query, fetch) } };
          },
        },
      ]);
    },
  };
}


/** Dev-only bridge for the asset lane: fetch a page's RAW HTML (the main
 * reader strips tags, which logo/headshot parsing needs). Same policy class as
 * the node reader — https only, public DNS, bounded size and time. */
async function readRawAssetPage(raw: string): Promise<OriginalSourceReceipt> {
  const unavailable = (reason: string): OriginalSourceReceipt => ({
    requestedUrl: raw.slice(0, 2048), status: 'unavailable', retrievedAt: new Date().toISOString(), reason,
  });
  let url: URL;
  try {
    url = new URL(raw);
  } catch { return unavailable('Unsafe source URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || raw.length > 2048) {
    return unavailable('Unsafe source URL');
  }
  let addresses: string[];
  try {
    addresses = await dnsLookup(url.hostname, { all: true, verbatim: true }).then((r) => r.map((a) => a.address));
  } catch { return unavailable('Source address could not be resolved'); }
  if (!addresses.length || addresses.some((ip) => isPrivateAddress(ip))) {
    return unavailable('Non-public or unsupported source address');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url.href, {
      redirect: 'follow', signal: controller.signal,
      headers: { 'User-Agent': 'Stratemark-Research/1.0 (+https://getstratemark.com)', Accept: 'text/html' },
    });
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (response.status !== 200 || !['text/html', 'application/xhtml+xml'].includes(type)) {
      return { ...unavailable('Source did not return a readable public page'), httpStatus: response.status };
    }
    const body = await response.text();
    if (body.length > 2_000_000) return unavailable('Source exceeds the document limit');
    return {
      requestedUrl: raw.slice(0, 2048), finalUrl: response.url || url.href, status: 'retrieved',
      retrievedAt: new Date().toISOString(), httpStatus: response.status, text: body, truncated: false,
    };
  } catch {
    return unavailable('Source retrieval failed');
  } finally { clearTimeout(timer); }
}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const lowered = ip.toLowerCase();
    return lowered === '::1' || lowered === '::' || lowered.startsWith('fc') || lowered.startsWith('fd') ||
      lowered.startsWith('fe80') || lowered.startsWith('::ffff:127.');
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || !parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}
