import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unlockPreview } from './access';

// Layout audit: objective numbers for "weird spacing and ratios". HARD checks
// fail the test; SOFT metrics are only printed and written to
// layout-audit.results.json (gitignored). See layout-audit.README.md.
const MARKET = 'mkt_frontier-ai-ecosystem_s248s';
const MISTRAL = 'cmp_mistral-ai_iubim';
const SPARSE = 'cmp_crusoe-crusoe-energy-systems_tx4jf';
const WIDTHS = [1440, 1024, 768, 390];
const TABS = [
  'overview', 'metrics', 'team_org', 'history', 'products_roadmap',
  'live_intel', 'mission_governance', 'live_landing', 'research',
];
const LANES = [/Culture/, /Vice/, /Insight/, /Barrier to Entry/];
const TRUNCATION_ALLOWANCE = 8;
// Known network noise: logos/fonts/external images are blocked in the audit.
const NOISE = /Failed to load resource|net::ERR|ERR_FAILED|ERR_BLOCKED|logo/i;

interface Surface {
  name: string;
  hash: string;
  /** Element that scrolls and is measured; the reader measures its dialog. */
  scroller?: string;
  ready: (page: Page) => Promise<void>;
}

const deckReady = async (page: Page) => {
  await expect(page.getByTestId('card-grid')).toBeVisible();
};
const dashReady = async (page: Page) => {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Company dashboard tabs' })).toBeVisible();
};

const SURFACES: Surface[] = [
  { name: 'new-deck', hash: '#/', ready: async (p) => { await expect(p.getByPlaceholder('Describe a market…')).toBeVisible(); } },
  { name: 'all-decks', hash: '#/history', ready: async (p) => { await expect(p.getByRole('heading', { name: 'All decks' })).toBeVisible(); } },
  { name: 'deck', hash: `#/markets/${MARKET}/deck`, ready: deckReady },
  ...LANES.map((lane, i): Surface => ({
    name: `deck-lane-${['culture', 'vice', 'insight', 'barrier'][i]}`,
    hash: `#/markets/${MARKET}/deck`,
    ready: async (p) => {
      await deckReady(p);
      await p.getByTestId('type-nav').getByRole('button', { name: lane }).first().click();
    },
  })),
  {
    name: 'card-reader',
    hash: `#/markets/${MARKET}/deck`,
    scroller: '[role=dialog]',
    ready: async (p) => {
      await deckReady(p);
      await p.getByTestId('card-grid').getByRole('button', { name: / — Company card/ }).first().click();
      await expect(p.getByRole('dialog')).toBeVisible();
    },
  },
  ...[MISTRAL, SPARSE].flatMap((id) =>
    TABS.map((tab): Surface => ({
      name: `dash-${id === MISTRAL ? 'mistral' : 'sparse'}-${tab}`,
      hash: `#/company/${id}/dashboard/${tab}`,
      ready: dashReady,
    })),
  ),
  { name: 'today', hash: '#/today', ready: async (p) => { await expect(p.locator('main')).not.toBeEmpty(); } },
  { name: 'saved', hash: '#/saved', ready: async (p) => { await expect(p.locator('main')).not.toBeEmpty(); } },
  { name: 'reports', hash: '#/reports', ready: async (p) => { await expect(p.locator('main')).not.toBeEmpty(); } },
  { name: 'beta', hash: '#/beta', ready: async (p) => { await expect(p.getByText(/December 1, 2026/).first()).toBeVisible(); } },
];

interface Measure {
  overflowX: boolean;
  docScrollW: number;
  docClientW: number;
  clipped: string[];
  truncated: number;
  maxGap: number;
  emptyRatio: number;
  colLeft: number;
  colMaxWidth: number;
  twoColRatio: number | null;
  twoColAt: string | null;
  fontSizes: number;
}

/** Runs in the browser. Everything is measured inside the scroller only. */
function measure(scrollerSel: string): Measure {
  const scroller = document.querySelector<HTMLElement>(scrollerSel);
  if (!scroller) throw new Error(`scroller ${scrollerSel} not found`);
  const sRect = scroller.getBoundingClientRect();
  const vis = (el: Element): DOMRect | null => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  };
  const label = (el: Element) => {
    const c = (el.getAttribute('class') ?? '').split(/\s+/).slice(0, 3).join('.');
    return `${el.tagName.toLowerCase()}${c ? '.' + c : ''}`;
  };
  const ownText = (el: Element) =>
    Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0);
  const all = Array.from(scroller.querySelectorAll('*')).filter((el) => !el.closest('svg') || el.tagName === 'svg');

  // Content root: descend through single-visible-child wrappers.
  let root: Element = scroller;
  for (let i = 0; i < 4; i++) {
    const kids = Array.from(root.children).filter((k) => vis(k));
    if (kids.length !== 1) break;
    root = kids[0]!;
  }
  const rr = root.getBoundingClientRect();
  const blocks = Array.from(root.children)
    .map((k) => vis(k))
    .filter((r): r is DOMRect => r !== null)
    .sort((a, b) => a.top - b.top);
  let maxGap = 0;
  for (let i = 1; i < blocks.length; i++) {
    maxGap = Math.max(maxGap, blocks[i]!.top - blocks[i - 1]!.bottom);
  }

  // Empty area: 24px grid over the content column, full scroll height.
  const CELL = 24;
  const top0 = rr.top;
  const colL = rr.left;
  const colW = Math.max(1, rr.width);
  const totalH = Math.max(1, rr.height);
  const cols = Math.ceil(colW / CELL);
  const rows = Math.ceil(totalH / CELL);
  const covered = new Uint8Array(cols * rows);
  for (const el of all) {
    if (el === root) continue;
    const r = vis(el);
    if (!r) continue;
    const cs = getComputedStyle(el);
    const replaced = ['IMG', 'SVG', 'svg', 'CANVAS', 'INPUT', 'TEXTAREA', 'SELECT', 'VIDEO'].includes(el.tagName);
    const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
    const border = ['Top', 'Right', 'Bottom', 'Left'].some(
      (s) => parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) > 0 && cs.getPropertyValue(`border-${s.toLowerCase()}-style`) !== 'none',
    );
    if (!(replaced || ownText(el) || bg || border || cs.backgroundImage !== 'none')) continue;
    const c0 = Math.max(0, Math.floor((r.left - colL) / CELL));
    const c1 = Math.min(cols - 1, Math.floor((r.right - colL - 0.01) / CELL));
    const r0 = Math.max(0, Math.floor((r.top - top0) / CELL));
    const r1 = Math.min(rows - 1, Math.floor((r.bottom - top0 - 0.01) / CELL));
    for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) covered[y * cols + x] = 1;
  }
  let empty = 0;
  for (const v of covered) if (!v) empty++;

  // Two-column groups: grid with 2+ tracks, or a row flex, with side-by-side children.
  let twoColRatio: number | null = null;
  let twoColAt: string | null = null;
  for (const el of all) {
    const cs = getComputedStyle(el);
    const isGrid = cs.display === 'grid' && cs.gridTemplateColumns.split(' ').length >= 2;
    const isRow = cs.display === 'flex' && cs.flexDirection === 'row';
    if (!isGrid && !isRow) continue;
    const kids = Array.from(el.children)
      .map((k) => vis(k))
      .filter((r): r is DOMRect => r !== null && r.width > 120 && r.height > 40);
    if (kids.length < 2) continue;
    const first = kids[0]!;
    const row = kids.filter((r) => Math.abs(r.top - first.top) < 8);
    if (row.length < 2) continue;
    const hs = row.map((r) => r.height);
    const tall = Math.max(...hs);
    if (tall < 120) continue;
    const ratio = Math.min(...hs) / tall;
    if (twoColRatio === null || ratio < twoColRatio) {
      twoColRatio = Math.round(ratio * 100) / 100;
      twoColAt = label(el);
    }
  }

  // Hard: clipped text without an accessible full text. Soft: truncation count.
  const clipped: string[] = [];
  let truncated = 0;
  for (const el of all) {
    if (!ownText(el)) continue;
    const r = vis(el);
    if (!r || r.width <= 1 || r.height <= 1) continue;
    const cs = getComputedStyle(el);
    const hasFull = Boolean(el.getAttribute('title') || el.getAttribute('aria-label'));
    const clamp = cs.getPropertyValue('-webkit-line-clamp') !== 'none' && cs.getPropertyValue('-webkit-line-clamp') !== '';
    const ellipsis = cs.textOverflow === 'ellipsis';
    const hidesX = cs.overflowX === 'hidden' && el.scrollWidth > el.clientWidth + 1;
    const hidesY = cs.overflowY === 'hidden' && el.scrollHeight > el.clientHeight + 1;
    if (clamp || ellipsis) {
      if (hidesX || hidesY) truncated++;
      continue;
    }
    if ((hidesX || hidesY) && !hasFull && !el.closest('[title],[aria-label]')) {
      clipped.push(`${label(el)}: "${(el.textContent ?? '').trim().slice(0, 40)}"`);
    }
  }

  // Distinct font sizes above the fold (first viewport of the scroller).
  const sizes = new Set<number>();
  for (const el of all) {
    if (!ownText(el)) continue;
    const r = vis(el);
    if (!r || r.top >= Math.min(sRect.bottom, window.innerHeight) || r.bottom <= sRect.top) continue;
    sizes.add(Math.round(parseFloat(getComputedStyle(el).fontSize) * 2) / 2);
  }

  const docEl = document.documentElement;
  return {
    overflowX: docEl.scrollWidth > docEl.clientWidth || scroller.scrollWidth > scroller.clientWidth + 1,
    docScrollW: Math.max(docEl.scrollWidth, scroller.scrollWidth),
    docClientW: Math.min(docEl.clientWidth, scroller.clientWidth || docEl.clientWidth),
    clipped: clipped.slice(0, 5),
    truncated,
    maxGap: Math.round(maxGap),
    emptyRatio: Math.round((empty / covered.length) * 100) / 100,
    colLeft: Math.round(colL - sRect.left),
    colMaxWidth: Math.round(rr.width),
    twoColRatio,
    twoColAt,
    fontSizes: sizes.size,
  };
}

test('layout audit: every surface at every width', async ({ browser }) => {
  test.setTimeout(1_200_000);
  const results: Array<Record<string, unknown>> = [];
  const hardFailures: string[] = [];

  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`);
    });
    // Offline audit: block every non-local request (fonts, logos, images).
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
    await unlockPreview(page);

    for (const s of SURFACES) {
      errors.length = 0;
      try {
        await page.goto(`/${s.hash}`);
        await s.ready(page);
        // Settle: skeletons gone, fonts loaded, then a short quiet period.
        await page.waitForFunction(() => document.querySelectorAll('main .animate-pulse').length === 0, undefined, { timeout: 4000 }).catch(() => undefined);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500);
        const m = await page.evaluate(measure, s.scroller ?? 'main');
        results.push({ surface: s.name, width, ...m });
        const id = `${s.name}@${width}`;
        if (m.overflowX) hardFailures.push(`${id}: horizontal overflow ${m.docScrollW} > ${m.docClientW}`);
        for (const c of m.clipped) hardFailures.push(`${id}: clipped text ${c}`);
        for (const e of errors) hardFailures.push(`${id}: ${e}`);
      } catch (err) {
        hardFailures.push(`${s.name}@${width}: surface did not load: ${(err as Error).message.split('\n')[0]}`);
      }
    }
    await context.close();
  }

  writeFileSync(join(process.cwd(), 'e2e', 'layout-audit.results.json'), JSON.stringify(results, null, 2));
  const cols = ['surface', 'width', 'maxGap', 'emptyRatio', 'colLeft', 'colMaxWidth', 'twoColRatio', 'fontSizes', 'truncated'];
  console.log(cols.join(' | '));
  for (const r of results) console.log(cols.map((c) => String(r[c] ?? '-')).join(' | '));
  const truncOver = results.filter((r) => (r.truncated as number) > TRUNCATION_ALLOWANCE);
  if (truncOver.length) console.log(`truncation above allowance (${TRUNCATION_ALLOWANCE}): ${truncOver.map((r) => `${r.surface}@${r.width}=${r.truncated}`).join(', ')}`);

  expect(hardFailures, 'hard layout failures').toEqual([]);
});
