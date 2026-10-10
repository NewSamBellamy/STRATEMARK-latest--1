import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { OriginalSourceReceipt } from '@mi/research';
import { allowsLocalSourceRequest } from './src/lib/repository/local-source-policy';
import type { OriginalSourceScope } from '@mi/research';

/** No production hook: this bridge exists only on Vite's local dev server. */
export function localSourcePlugin(): Plugin {
  let active = 0;
  return {
    name: 'stratemark-local-source', apply: 'serve',
    configureServer(server) {
      // Load workspace TypeScript through Vite, not Node's extensionless ESM resolver.
      const sourceModulePath = fileURLToPath(new URL('../../packages/research/src/original-source.node.ts', import.meta.url));
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__stratemark/source') return next();
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');
        const header = (name: string) => typeof req.headers[name] === 'string' ? req.headers[name] as string : undefined;
        if (!allowsLocalSourceRequest(req.method, header('host'), header('origin'),
          req.socket.remoteAddress, header('x-stratemark-source'))) {
          res.statusCode = 403; res.end('{}'); return;
        }
        if (header('content-type') !== 'application/json') {
          res.statusCode = 415; res.end('{}'); return;
        }
        if (active >= 6) { res.statusCode = 429; res.end('{}'); return; }
        active++;
        void (async () => {
          try {
            let body = '';
            for await (const chunk of req) {
              body += String(chunk);
              if (Buffer.byteLength(body) > 8192) { res.statusCode = 413; res.end('{}'); return; }
            }
            const input = JSON.parse(body) as { url?: unknown; scope?: OriginalSourceScope };
            if (typeof input.url !== 'string' || input.url.length > 2048 ||
              (input.scope && (typeof input.scope.companyName !== 'string' || input.scope.companyName.length > 300 ||
                typeof input.scope.companyId !== 'string' || input.scope.companyId.length > 300 ||
                (input.scope.metricType !== undefined && (typeof input.scope.metricType !== 'string' || input.scope.metricType.length > 100))))) {
              res.statusCode = 400; res.end('{}'); return;
            }
            const sourceModule = await server.ssrLoadModule(sourceModulePath) as {
              retrieveOriginalSource: (url: string, io: undefined, scope?: OriginalSourceScope) => Promise<OriginalSourceReceipt>;
            };
            const receipt = await sourceModule.retrieveOriginalSource(input.url, undefined, input.scope);
            res.end(JSON.stringify(receipt));
          } catch { res.statusCode = 400; res.end('{}'); }
          finally { active--; }
        })();
      });
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__stratemark/asset-source') return next();
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');
        const header = (name: string) => typeof req.headers[name] === 'string' ? req.headers[name] as string : undefined;
        if (!allowsLocalSourceRequest(req.method, header('host'), header('origin'),
          req.socket.remoteAddress, header('x-stratemark-source'))) {
          res.statusCode = 403; res.end('{}'); return;
        }
        if (header('content-type') !== 'application/json') {
          res.statusCode = 415; res.end('{}'); return;
        }
        if (active >= 6) { res.statusCode = 429; res.end('{}'); return; }
        active++;
        void (async () => {
          try {
            let body = '';
            for await (const chunk of req) {
              body += String(chunk);
              if (Buffer.byteLength(body) > 8192) { res.statusCode = 413; res.end('{}'); return; }
            }
            const input = JSON.parse(body) as { url?: unknown };
            const receipt = await readRawAssetPage(typeof input.url === 'string' ? input.url : '');
            res.end(JSON.stringify(receipt));
          } catch { res.statusCode = 400; res.end('{}'); }
          finally { active--; }
        })();
      });
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
