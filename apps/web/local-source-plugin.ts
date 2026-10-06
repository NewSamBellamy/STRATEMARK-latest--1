import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
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
    },
  };
}
