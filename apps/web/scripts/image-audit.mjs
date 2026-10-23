// Image hit-rate audit. NOT part of the default e2e run.
//
// Opens the bundled demo deck against a running Vite dev server with the
// network ALLOWED (so logos, og images and screenshot services are really
// fetched), walks the deck and every dashboard tab of each company, waits for
// images to settle, then reads the in-app counters (window.__imgAudit, see
// src/lib/media/imageAudit.ts) and prints per-surface hit rate and the top
// failing hosts. Hit = a real picture loaded; monogram / EditorialCover /
// MarketCardArt fallbacks are misses.
//
//   pnpm exec vite --port 4611 --strictPort          (in apps/web)
//   node scripts/image-audit.mjs                     (BASE=http://localhost:4611)
//
// Env: BASE, COMPANIES (max companies, default all), SETTLE_MS (per tab, default
// 6000), OUT (write JSON here), TABS (comma list to restrict).
//
// What the dev bridge CANNOT measure: pages are read by the Vite dev plugin
// from this machine (no Cloudflare egress, no edge cache, no /v1/image proxy
// referrer/UA behaviour, no origin/quota rules), so story covers here reflect
// the parser and the publisher's willingness to answer one machine, not the
// hosted Worker. See docs/NEXT-SPRINT-AUDIT-2-2026-10-22.md (WS-D).
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:4611';
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 6000);
const MAX_COMPANIES = Number(process.env.COMPANIES ?? 99);
const MARKET = process.env.MARKET ?? 'mkt_frontier-ai-ecosystem_s248s';
const TABS = (process.env.TABS ?? 'overview,metrics,team_org,history,products_roadmap,live_intel,mission_governance,live_landing')
  .split(',').map((t) => t.trim()).filter(Boolean);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.__imgAuditOn = true;
  localStorage.setItem('mi.imgAudit', '1');
});
const page = await ctx.newPage();
// Only Google FONTS are blocked (no images); everything else is live.
await page.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, (r) => r.abort());

const dom = []; // supplemental, uncounted-by-app view: <img> elements per tab

async function scrollAll() {
  await page.evaluate(async () => {
    const step = Math.max(300, window.innerHeight * 0.8);
    const scrollers = [document.scrollingElement, ...document.querySelectorAll('main, [data-scroll], .overflow-y-auto')];
    for (const el of scrollers) {
      if (!el) continue;
      for (let y = 0; y < el.scrollHeight + step; y += step) {
        el.scrollTo?.(0, y);
        await new Promise((r) => setTimeout(r, 250));
      }
      el.scrollTo?.(0, 0);
    }
  });
}

async function domStats(label) {
  const s = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')].filter((i) => i.src && !i.src.startsWith('data:') && !/\/assets\//.test(i.src));
    const ok = imgs.filter((i) => i.complete && i.naturalWidth > 0).length;
    return { total: imgs.length, ok };
  });
  dom.push({ label, ...s });
}

async function visit(label, hash) {
  try {
    await page.goto(`${BASE}/#${hash}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await scrollAll();
    await page.waitForTimeout(SETTLE_MS);
    await scrollAll();
    await page.waitForTimeout(1500);
    await domStats(label);
    console.log('walked', label);
  } catch (e) {
    console.log('FAILED', label, String(e.message).slice(0, 120));
  }
}

await visit('deck', `/markets/${MARKET}/deck`);
// Company ids come from the grid's own links when present, else the bundled snapshot.
const ids = (await (await fetch(`${BASE}/src/sample/frontier-snapshot.json`)).json())
  .companies.map((c) => c.id).slice(0, MAX_COMPANIES);
for (const id of ids) {
  for (const tab of TABS) await visit(`${id.replace(/^cmp_/, '').slice(0, 16)}/${tab}`, `/company/${id}/dashboard/${tab}`);
}

const snap = await page.evaluate(() => window.__imgAudit?.snapshot() ?? {});
await browser.close();

const pct = (c) => {
  const settled = c.loaded + c.fallback;
  return settled ? `${((c.loaded / settled) * 100).toFixed(0)}%` : 'n/a';
};
console.log('\n=== IMAGE HIT RATE (loaded / settled) ===');
console.log('surface'.padEnd(16), 'hit'.padStart(5), 'loaded'.padStart(7), 'fallback'.padStart(9), 'requested'.padStart(10), 'unsettled'.padStart(10));
let tl = 0, tf = 0;
for (const [surface, v] of Object.entries(snap).sort()) {
  const c = v.total;
  tl += c.loaded; tf += c.fallback;
  console.log(surface.padEnd(16), pct(c).padStart(5), String(c.loaded).padStart(7), String(c.fallback).padStart(9), String(c.requested).padStart(10), String(Math.max(0, c.requested - c.loaded - c.fallback)).padStart(10));
}
console.log('ALL'.padEnd(16), pct({ loaded: tl, fallback: tf }).padStart(5), String(tl).padStart(7), String(tf).padStart(9));

const failing = [];
for (const [surface, v] of Object.entries(snap)) {
  for (const [host, c] of Object.entries(v.hosts)) if (c.fallback > 0) failing.push({ surface, host, fallback: c.fallback, loaded: c.loaded });
}
failing.sort((a, b) => b.fallback - a.fallback);
console.log('\n=== TOP FAILING HOSTS (by fallback count) ===');
for (const f of failing.slice(0, 25)) console.log(String(f.fallback).padStart(4), 'fallbacks', String(f.loaded).padStart(4), 'loaded ', f.surface.padEnd(14), f.host);

const totalImgs = dom.reduce((n, d) => n + d.total, 0), okImgs = dom.reduce((n, d) => n + d.ok, 0);
console.log(`\nDOM cross-check: ${okImgs}/${totalImgs} <img> elements (non-bundled) rendered with real pixels across ${dom.length} views`);
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ at: new Date().toISOString(), base: BASE, snap, dom }, null, 2));
