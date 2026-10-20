// Render the print report of the sample deck to PDF and rasterise every page to PNG.
// Usage: pnpm --filter @mi/web render:pdf -- --kind deck|company [--port 4410] [--offline] [--letter] [--out <dir>]
// See README-render-pdf.md. The PDF is the browser's own print of PrintDocument.tsx (print.css).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function fail(msg) {
  console.error(`render-pdf: ${msg}`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const a = { kind: 'deck', port: 4410, offline: false, letter: false, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === '--') continue;
    else if (v === '--kind') a.kind = argv[++i];
    else if (v === '--port') a.port = Number(argv[++i]);
    else if (v === '--out') a.out = argv[++i];
    else if (v === '--offline') a.offline = true;
    else if (v === '--letter') a.letter = true;
    else throw new Error(`unknown argument "${v}"`);
  }
  if (!['deck', 'company'].includes(a.kind)) throw new Error('--kind must be deck or company');
  if (!Number.isInteger(a.port) || a.port < 1) throw new Error('--port must be a number');
  return a;
}

const CASES = {
  deck: { route: '/#/markets/mkt_frontier-ai-ecosystem_s248s/deck', wait: '[data-testid="card-grid"]', item: /^Deck report/ },
  company: { route: '/#/company/cmp_openai_5sz16/dashboard/overview', wait: 'text=Key figures', item: /^Company report/ },
};

function portFree(port) {
  return new Promise((ok) => {
    const s = createServer();
    s.once('error', () => ok(false));
    s.listen(port, '127.0.0.1', () => s.close(() => ok(true)));
  });
}

async function waitForServer(url, child, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`dev server exited early (code ${child.exitCode})`);
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`dev server did not answer at ${url} within ${ms / 1000}s`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const c = CASES[args.kind];
  const outDir = resolve(args.out ?? `${WEB}/pdf-shots/${args.kind}`);

  // unpdf's exports map hides package.json, so go through the workspace link (apps/web/node_modules/unpdf).
  const pdfjsPath = resolve(WEB, 'node_modules/unpdf/dist/pdfjs.mjs');
  if (!existsSync(pdfjsPath)) throw new Error(`pdf.js not found at ${pdfjsPath} - run \`pnpm install\` (devDependency "unpdf")`);
  const pdfjs = readFileSync(pdfjsPath);

  let port = args.port;
  for (let n = 0; !(await portFree(port)); n += 1) {
    if (n > 20) throw new Error('no free port found');
    port += 1;
  }
  const base = `http://localhost:${port}`;
  const viteBin = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  const server = spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort'], {
    cwd: WEB,
    env: { ...process.env, VITE_OPEN_ACCESS: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });

  let browser;
  try {
    await waitForServer(base, server, 60_000);
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      locale: args.letter ? 'en-US' : 'en-GB',
    });
    const page = await context.newPage();
    if (args.offline) await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.addInitScript(() => {
      try {
        localStorage.setItem('mi.access.v1', JSON.stringify({ name: 'E2E', kind: 'test', unlockedAt: new Date().toISOString() }));
      } catch { /* opaque origin */ }
      window.print = () => { window.__printing = true; };
    });
    // Seed the sample deck the way the e2e specs do: land on the deck list and open it, then deep-link.
    await page.goto(`${base}/#/history`);
    await page.getByRole('button', { name: /Frontier AI Ecosystem/ }).first().click();
    await page.waitForSelector('[data-testid="card-grid"]', { timeout: 60_000 });
    await page.goto(base + c.route);
    await page.waitForSelector(c.wait, { timeout: 60_000 });
    await page.getByRole('button', { name: /Share . export/i }).first().click();
    await page.getByRole('menuitem', { name: c.item }).click();
    await page.waitForFunction(() => window.__printing === true, null, { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });

    mkdirSync(outDir, { recursive: true });
    for (const f of readdirSync(outDir)) if (/^page-\d+\.png$/.test(f) || f === 'report.pdf') rmSync(resolve(outDir, f));
    writeFileSync(resolve(outDir, 'report.pdf'), pdf);

    // Rasterise with pdf.js in a second page (no system PDF rasteriser needed).
    const r = await context.newPage();
    await r.route('http://render.local/**', (route) => {
      const u = route.request().url();
      if (u.endsWith('pdfjs.mjs')) return route.fulfill({ body: pdfjs, contentType: 'text/javascript' });
      if (u.endsWith('doc.pdf')) return route.fulfill({ body: pdf, contentType: 'application/pdf' });
      return route.fulfill({ body: '<html><body style="margin:0;background:#888"><canvas id=c></canvas></body></html>', contentType: 'text/html' });
    });
    await r.goto('http://render.local/');
    const pages = await r.evaluate(async () => {
      const lib = await import('http://render.local/pdfjs.mjs');
      const data = new Uint8Array(await (await fetch('http://render.local/doc.pdf')).arrayBuffer());
      window.__doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
      return window.__doc.numPages;
    });
    for (let i = 1; i <= pages; i += 1) {
      await r.evaluate(async (n) => {
        const p = await window.__doc.getPage(n);
        const vp = p.getViewport({ scale: 110 / 72 }); // ~110 dpi
        const cv = document.getElementById('c');
        cv.width = vp.width;
        cv.height = vp.height;
        await p.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      }, i);
      await r.locator('#c').screenshot({ path: resolve(outDir, `page-${String(i).padStart(2, '0')}.png`) });
    }
    console.log(`render-pdf: ${args.kind} -> ${pages} pages, PNGs + report.pdf in ${outDir}`);
  } catch (e) {
    fail(`${e instanceof Error ? e.message : e}`);
    if (serverLog) console.error(`--- dev server output (tail) ---\n${serverLog.slice(-1500)}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server.pid && server.exitCode === null) server.kill();
  }
}

main().catch((e) => {
  fail(e instanceof Error ? e.message : String(e));
});
