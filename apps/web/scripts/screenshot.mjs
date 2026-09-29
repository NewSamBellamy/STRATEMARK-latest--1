// Captures screenshots of the real app (production build via `vite preview`).
// External requests (Google Fonts, example.com iframes) are aborted so shots
// are deterministic and don't depend on sandbox egress.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const MARKET = 'mkt_ca-christian-apparel';
const COMPANY = 'cmp_gracewear-global';

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

await page.route('**/*', (route) => {
  const url = route.request().url();
  if (/fonts\.(googleapis|gstatic)\.com|example\.com/.test(url)) return route.abort();
  return route.continue();
});

async function shot(name, { url, waitFor, click, settle = 900 }) {
  try {
    if (url) await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 8000 });
    if (click) {
      await page.click(click);
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(settle);
    await page.screenshot({ path: `${OUT}${name}.png` });
    console.log('captured', name);
  } catch (err) {
    console.error('FAILED', name, err.message);
  }
}

await shot('01-markets', { url: `${BASE}/#/`, waitFor: 'text=Markets' });
await shot('02-deck-full', {
  url: `${BASE}/#/markets/${MARKET}/deck`,
  waitFor: '[data-testid="card-grid"]',
});
await shot('03-card-reader', {
  url: `${BASE}/#/markets/${MARKET}/deck`,
  waitFor: '[data-testid="card-grid"] button',
  click: '[data-testid="card-grid"] button',
});
await shot('04-subdecks', {
  url: `${BASE}/#/markets/${MARKET}/deck?split=types`,
  waitFor: 'text=Barrier to Entry',
});
await shot('05-tier-split', {
  url: `${BASE}/#/markets/${MARKET}/deck?split=company`,
  waitFor: 'text=Market Defining',
});
await shot('06-dashboard-overview', {
  url: `${BASE}/#/company/${COMPANY}/dashboard/overview`,
  waitFor: 'text=What they do',
});
await shot('07-dashboard-metrics', {
  url: `${BASE}/#/company/${COMPANY}/dashboard/metrics`,
  waitFor: 'text=Cap table',
  settle: 1400,
});
await shot('08-dashboard-team', {
  url: `${BASE}/#/company/${COMPANY}/dashboard/team_org`,
  waitFor: '.react-flow',
  settle: 1400,
});
await shot('09-dashboard-landing', {
  url: `${BASE}/#/company/${COMPANY}/dashboard/live_landing`,
  waitFor: 'text=blocks embedding',
});

await browser.close();
console.log('done');
