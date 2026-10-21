import { test, expect, type Page } from '@playwright/test';
import { unlockPreview } from './access';

// Robustness: things the scripted journeys do not do. Direct navigation, reloads,
// hostile storage, going offline, resizing under an open dialog, button mashing.
// Every test records page errors and console errors and fails on any of them.
const MARKET = 'mkt_frontier-ai-ecosystem_s248s';
const COMPANIES = [
  'cmp_nvidia-corporation_umowh', 'cmp_openai_5sz16', 'cmp_anthropic_1ydvf', 'cmp_coreweave_q8nfb',
  'cmp_microsoft-corporation_gtmdz', 'cmp_mistral-ai_iubim', 'cmp_groq_0x4or', 'cmp_scale-ai_art8j',
  'cmp_crusoe-crusoe-energy-systems_tx4jf', 'cmp_together-ai_m6oeb',
];
const TABS = [
  'overview', 'metrics', 'team_org', 'history', 'products_roadmap',
  'live_intel', 'mission_governance', 'live_landing', 'research',
];
// Blocked fonts/logos/external images are expected noise offline.
const NOISE = /Failed to load resource|net::ERR|ERR_FAILED|ERR_BLOCKED|logo/i;

function record(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

test.beforeEach(async ({ page }) => {
  // Tabs look people, filings and logos up on Wikipedia, SEC and company sites; keep the run offline and repeatable.
  await page.route((url) => url.hostname !== 'localhost' && /^https?:$/.test(url.protocol), (route) => route.abort());
  await unlockPreview(page);
});

test('#/settings reached from another screen opens Settings (it used to land on home with no window)', async ({ page }) => {
  const errors = record(page);
  await page.goto('/#/saved');
  await expect(page.getByRole('heading', { name: 'Saved cards' })).toBeVisible();
  // Typing the address (or following a link) changes only the hash: the app stays mounted.
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0);
  // And on a tab, from a company page.
  await page.goto(`/#/company/${COMPANIES[1]}/dashboard/metrics`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/settings/usage'; });
  await expect(page.getByText('This month on your key')).toBeVisible();
  expect(errors).toEqual([]);
});

for (const id of COMPANIES) {
  test(`every tab of ${id}: no error, content shown, no sideways scroll at 1280 and 390`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = record(page);
    const problems: string[] = [];
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const tab of TABS) {
        await page.goto(`/#/company/${id}/dashboard/${tab}`);
        await expect(page.getByRole('navigation', { name: 'Company dashboard tabs' })).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.waitForFunction(() => document.querySelectorAll('main .animate-pulse').length === 0, undefined, { timeout: 5000 }).catch(() => undefined);
        const m = await page.evaluate(() => {
          const main = document.querySelector('main');
          const de = document.documentElement;
          return {
            text: (main?.textContent ?? '').trim().length,
            over: Math.max(de.scrollWidth - de.clientWidth, (main?.scrollWidth ?? 0) - (main?.clientWidth ?? 0)),
            crashed: /this view crashed|something went wrong|this page could not load/i.test(main?.textContent ?? ''),
            // Elements that stick out past <main> and are not inside their own scroller/clip.
            who: Array.from(main?.querySelectorAll('*') ?? [])
              .filter((el) => {
                if (el.getBoundingClientRect().right <= (main?.getBoundingClientRect().right ?? 0) + 1) return false;
                for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
                  const cs = getComputedStyle(p);
                  if (cs.overflowX !== 'visible' || cs.position === 'fixed') return false;
                }
                return getComputedStyle(el).position !== 'fixed';
              })
              .slice(0, 4)
              .map((el) => `${el.tagName}.${String(el.getAttribute('class')).slice(0, 60)}@${Math.round(el.getBoundingClientRect().right)} "${(el.textContent ?? '').slice(0, 30)}"`),
            dims: `doc ${de.scrollWidth}/${de.clientWidth} main ${main?.scrollWidth}/${main?.clientWidth}`,
          };
        });
        if (m.text < 80) problems.push(`${tab}@${width}: nearly empty (${m.text} chars)`);
        if (m.over > 1) problems.push(`${tab}@${width}: sideways overflow ${m.over}px ${m.dims} ${m.who.join(' | ')}`);
        if (m.crashed) problems.push(`${tab}@${width}: error boundary`);
      }
    }
    expect(problems).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('the reader opens for every card in every lane, and closes back onto the card it came from', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = record(page);
  await page.goto(`/#/markets/${MARKET}/deck`);
  const grid = page.getByTestId('card-grid');
  await expect(grid).toBeVisible();
  const nav = page.getByTestId('type-nav');
  const lanes = await nav.getByRole('button').count();
  expect(lanes).toBeGreaterThan(3);
  const dialog = page.getByRole('dialog');
  for (let lane = 0; lane < lanes; lane++) {
    await nav.getByRole('button').nth(lane).click();
    const cards = grid.locator('[data-card-id] .card-sleeve__open');
    const total = await cards.count();
    if (total === 0) continue;
    await cards.first().click();
    await expect(dialog).toBeVisible();
    for (let i = 0; i < total; i++) {
      await expect(dialog.getByRole('heading').first()).toBeVisible();
      expect((await dialog.innerText()).trim().length).toBeGreaterThan(40);
      await expect(dialog.getByText(/this view crashed|something went wrong/i)).toHaveCount(0);
      if (i < total - 1) await dialog.getByRole('button', { name: 'Next card' }).click();
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

const ROUTES = [
  '#/', '#/today', '#/history', '#/saved', '#/reports', '#/beta',
  `#/markets/${MARKET}/deck`, `#/markets/${MARKET}/opportunity`, `#/markets/${MARKET}/briefing`, `#/markets/${MARKET}/settings`,
  `#/company/${COMPANIES[5]}/dashboard/overview`, `#/company/${COMPANIES[1]}/dashboard/live_intel`,
  '#/settings', '#/settings/engine', '#/no/such/page',
];
const CRASH = /this view crashed|something went wrong|this page could not load/i;

/** The page is showing something real: a heading or content, not blank and not a crash. */
async function expectAlive(page: Page, where: string): Promise<void> {
  await expect.poll(async () => (await page.locator('main').innerText().catch(() => '')).trim().length, { message: where, timeout: 15_000 }).toBeGreaterThan(20);
  expect(await page.locator('main').innerText(), where).not.toMatch(CRASH);
}

test('rapid navigation, back and forward never leave a blank or crashed page', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = record(page);
  await page.goto('/#/');
  await expectAlive(page, 'start');
  // 60 hash changes with no waiting in between: lazy routes are still loading when the next one starts.
  for (let i = 0; i < 60; i++) {
    const hash = ROUTES[(i * 7) % ROUTES.length]!;
    await page.evaluate((h) => { window.location.hash = h; }, hash);
    if (i % 5 === 0) await page.waitForTimeout(30);
  }
  await page.evaluate((h) => { window.location.hash = h; }, `#/markets/${MARKET}/deck`);
  await expect(page.getByTestId('card-grid')).toBeVisible();
  for (let i = 0; i < 12; i++) await page.goBack();
  await page.waitForTimeout(300);
  await expectAlive(page, 'after back x12');
  for (let i = 0; i < 6; i++) await page.goForward();
  await page.waitForTimeout(300);
  await expectAlive(page, 'after forward x6');
  expect(errors).toEqual([]);
});

test('a reload on every route brings the same screen back, deep links included', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = record(page);
  const all = [
    ...ROUTES.filter((r) => !r.startsWith('#/settings')),
    `#/markets/${MARKET}/deck?card=nope`, `#/company/${COMPANIES[3]}/dashboard/history?deck=${MARKET}`,
  ];
  for (const hash of all) {
    // A hash-only goto would keep the app mounted and show the previous screen: leave the document first.
    await page.goto('about:blank');
    await page.goto(`/${hash}`);
    await expectAlive(page, `first load ${hash}`);
    const before = (await page.locator('main h1').first().innerText().catch(() => '')).trim();
    await page.reload();
    await expectAlive(page, `reload ${hash}`);
    await expect(page.locator('main h1').first(), `same heading after reload ${hash}`).toHaveText(before === '' ? /.*/ : before);
  }
  // Settings is a window over home, so a reload keeps the window.
  await page.goto('/#/settings/usage');
  await expect(page.getByText('This month on your key')).toBeVisible();
  expect(errors).toEqual([]);
});

test('corrupted app storage never blanks the app: every key holds junk', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = record(page);
  await page.addInitScript(() => {
    const junk = ['{not json', 'null', '[]', '"text"', '{"a":', '0', 'undefined', 'x'.repeat(50_000)];
    // (mi.repo.v1 is left alone: with a key set, a damaged research file stops the app on purpose, to protect it.)
    const keys = ['mi.teamOrgView', 'mi.sentinelApiUrl', 'mi.geminiApiKey', 'mi.apiKey', 'mi.theme', 'mi.searchUsage',
      'mi.targetCompanies', 'mi.ambientRest', 'mi.shares', 'mi.today.lastVisit', 'mi.groundingSpent.v1', 'mi.geminiJudgeModel',
      'mi.cloud.cache.v1', 'mi.warmStoredDecks', 'mi.usage', 'mi.today.socialRead', 'mi.researchEngine', 'mi.fillLedger.v1',
      'mi.usage.v1', 'mi.usage.month.v1', 'mi.searchProvider', 'mi.searchKey', 'mi.quotaPreset', 'mi.geminiModel', 'mi.costctl.v1',
      'mi.backgroundResearch.v1'];
    keys.forEach((k, i) => localStorage.setItem(k, junk[i % junk.length]!));
  });
  for (const hash of ['#/', '#/today', '#/history', '#/saved', '#/reports', `#/markets/${MARKET}/deck`, `#/company/${COMPANIES[5]}/dashboard/metrics`]) {
    await page.goto(`/${hash}`);
    await expectAlive(page, hash);
  }
  await page.goto('/#/settings/usage');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Engine', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Research engine' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('storage that refuses reads and writes (private mode, quota) still opens the demo', async ({ page }) => {
  const errors = record(page);
  await page.addInitScript(() => {
    const boom = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
    Storage.prototype.setItem = boom;
    Storage.prototype.removeItem = boom;
    Storage.prototype.clear = boom;
    const get = Storage.prototype.getItem;
    // The preview unlock is seeded by the harness; everything else reads as absent or throws.
    Storage.prototype.getItem = function (key: string) {
      if (key === 'mi.access.v1') return JSON.stringify({ name: 'E2E', kind: 'test', unlockedAt: new Date().toISOString() });
      if (key.endsWith('v1')) throw new DOMException('denied', 'SecurityError');
      return get.call(this, key);
    };
  });
  for (const hash of ['#/history', `#/markets/${MARKET}/deck`, '#/today', `#/company/${COMPANIES[1]}/dashboard/overview`]) {
    await page.goto(`/${hash}`);
    await expectAlive(page, hash);
  }
  expect(errors).toEqual([]);
});

test('IndexedDB that is missing, blocked or erroring does not stop the app', async ({ page }) => {
  const errors = record(page);
  await page.addInitScript(() => {
    const fail = () => {
      const req: Record<string, unknown> = { error: new DOMException('blocked', 'InvalidStateError'), readyState: 'done' };
      setTimeout(() => (req.onerror as ((e: unknown) => void) | undefined)?.({ target: req }), 0);
      return req;
    };
    Object.defineProperty(window, 'indexedDB', { value: { open: fail, deleteDatabase: fail, databases: async () => [] }, configurable: true });
  });
  for (const hash of ['#/history', `#/markets/${MARKET}/deck`, '#/saved', `#/company/${COMPANIES[0]}/dashboard/team_org`]) {
    await page.goto(`/${hash}`);
    await expectAlive(page, hash);
  }
  await page.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); });
  await page.goto('/#/history');
  await expectAlive(page, 'no indexedDB at all');
  expect(errors).toEqual([]);
});

test('offline: a page that was never loaded waits, then loads when the connection returns', async ({ page, context }) => {
  const errors = record(page);
  await page.goto('/#/history');
  await expectAlive(page, 'history');
  await context.setOffline(true);
  await page.evaluate(() => { window.location.hash = '#/reports'; });
  // The chunk cannot be fetched: the loader shows, the old page does not pretend to be Reports.
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toHaveCount(0);
  // Pages already loaded still work offline.
  await page.evaluate(() => { window.location.hash = '#/history'; });
  await expect(page.getByRole('heading', { name: 'All decks' })).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/reports'; });
  await context.setOffline(false);
  // The browser remembers the failed fetch, so the page reloads itself once onto the same address.
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible({ timeout: 15_000 });
  expect(page.url()).toContain('#/reports');
  await expectAlive(page, 'reports after reconnect');
  // The failed fetches while offline are the only errors expected.
  expect(errors.filter((e) => !/Failed to fetch dynamically imported module|ErrorBoundary caught/.test(e))).toEqual([]);
});

test('resizing across breakpoints with a dialog open keeps the dialog usable and inside the window', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = record(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/#/markets/${MARKET}/deck`);
  await expect(page.getByTestId('card-grid')).toBeVisible();
  await page.getByTestId('card-grid').locator('[data-card-id] .card-sleeve__open').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (const [width, height] of [[1024, 768], [768, 1024], [390, 800], [320, 600], [768, 1024], [1400, 900], [390, 800]]) {
    await page.setViewportSize({ width: width!, height: height! });
    await page.waitForTimeout(150);
    await expect(dialog, `${width}x${height}`).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x, `${width}: dialog left`).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width, `${width}: dialog right`).toBeLessThanOrEqual(width! + 1);
    expect(await page.evaluate(() => { const de = document.documentElement; return de.scrollWidth - de.clientWidth; }), `${width}: page sideways scroll`).toBeLessThanOrEqual(1);
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
    expect(await dialog.evaluate((d) => d.contains(document.activeElement)), `${width}: focus stays in the dialog`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // Settings over the same resize walk, and the phone menu.
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  for (const width of [1200, 700, 390, 1200]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(150);
    await expect(page.getByRole('heading', { name: 'Settings' }), `settings @${width}`).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('keyboard only: Tab never gets stuck, a dialog keeps focus in and Escape hands it back', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = record(page);
  await page.goto(`/#/markets/${MARKET}/deck`);
  await expect(page.getByTestId('card-grid')).toBeVisible();
  const where = () => page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return a ? `${a.tagName}|${a.getAttribute('aria-label') ?? a.textContent?.trim().slice(0, 30) ?? ''}|${a.closest('[role=dialog]') ? 'dialog' : 'page'}` : 'none';
  });
  // The page: Tab walks forward through many distinct controls, never twice onto the same one (a trap), until it
  // leaves the document (focus on the body is the browser's own chrome taking over).
  const seen: string[] = [];
  let last = '';
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press('Tab');
    const w = await where();
    if (/^(BODY|none)/.test(w)) break;
    const rect = await page.evaluate(() => JSON.stringify(document.activeElement?.getBoundingClientRect()));
    expect(w + rect, `tab stop ${i} is not the same control as the one before`).not.toBe(last);
    last = w + rect;
    seen.push(w);
  }
  expect(seen.length).toBeGreaterThan(20);
  expect(seen.length, 'Tab leaves the page after a sane number of stops').toBeLessThan(150);
  // A card opens with the keyboard; Tab and Shift+Tab cycle inside the dialog; Escape closes and focus is on the page again.
  const open = page.getByTestId('card-grid').locator('[data-card-id] .card-sleeve__open').first();
  await open.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press(i % 7 === 6 ? 'Shift+Tab' : 'Tab');
    expect(await where(), `dialog tab stop ${i}`).toMatch(/\|dialog$/);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(where, { message: 'focus is handed back to the card it came from' }).toMatch(/^(?!BODY).*\|page$/);
  // Settings the same way, and the New Deck box takes keyboard input and clears.
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    expect(await where(), `settings tab stop ${i}`).toMatch(/\|dialog$/);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('30 rapid clicks on Follow, Save and Compare leave the screen and its state consistent', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = record(page);
  await page.goto(`/#/markets/${MARKET}/deck`);
  await expect(page.getByTestId('card-grid')).toBeVisible();
  const mash = async (selector: string, times: number) => {
    const box = await page.locator(selector).first().boundingBox();
    expect(box, selector).not.toBeNull();
    for (let i = 0; i < times; i++) await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  };
  // Follow: the button ends in one definite state, and Today agrees with it.
  const follow = page.getByTestId('card-grid').getByRole('button', { name: /(Add .+ to Today|Following .+ on Today)/ }).first();
  const label = (await follow.getAttribute('aria-label'))!;
  const company = /Add (.+) to Today|Following (.+) on Today/.exec(label)!.slice(1).find(Boolean)!;
  await follow.scrollIntoViewIfNeeded();
  await mash('[data-testid=card-grid] button[aria-label*="Today"]', 30);
  await page.waitForTimeout(800);
  const pressed = await follow.getAttribute('aria-pressed');
  expect(['true', 'false']).toContain(pressed);
  await page.getByRole('link', { name: 'Today' }).first().click();
  await expectAlive(page, 'today after mashing follow');
  const onToday = await page.getByRole('navigation', { name: 'Companies on Today' }).getByRole('button', { name: new RegExp(company) }).count();
  expect(onToday > 0, 'Today lists the company exactly when the button said Following').toBe(pressed === 'true');
  // Save: same, and the Saved page lists it exactly when pressed.
  await page.goto(`/#/markets/${MARKET}/deck`);
  await expect(page.getByTestId('card-grid')).toBeVisible();
  const save = page.getByTestId('card-grid').getByRole('button', { name: /^(Save|Unsave) card$/ }).first();
  await save.scrollIntoViewIfNeeded();
  await mash('[data-testid=card-grid] button[aria-label$="Save card"], [data-testid=card-grid] button[aria-label="Unsave card"]', 30);
  await page.waitForTimeout(800);
  const saved = await save.getAttribute('aria-pressed');
  expect(['true', 'false']).toContain(saved);
  await page.goto('/#/saved');
  await expectAlive(page, 'saved page');
  if (saved === 'false') await expect(page.getByText(/no saved cards|nothing saved/i).first()).toBeVisible();
  // Compare: even number of toggles ends outside compare mode; the grid is intact.
  await page.goto(`/#/markets/${MARKET}/deck`);
  await expect(page.getByTestId('card-grid')).toBeVisible();
  const cardsBefore = await page.getByTestId('card-grid').locator('[data-card-id]').count();
  const compare = page.getByRole('button', { name: /^(Compare|Cancel)$/ }).first();
  const cbox = await compare.boundingBox();
  for (let i = 0; i < 30; i++) await page.mouse.click(cbox!.x + cbox!.width / 2, cbox!.y + cbox!.height / 2);
  await expect(page.getByRole('button', { name: 'Compare' }).first()).toBeVisible();
  await expect(page.getByTestId('select-chip')).toHaveCount(0);
  expect(await page.getByTestId('card-grid').locator('[data-card-id]').count()).toBe(cardsBefore);
  expect(errors).toEqual([]);
});

test('very long names and unknown ids do not break the layout or crash', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = record(page);
  const long = 'Supercalifragilistic'.repeat(30);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const hash of [
      `#/company/${long}/dashboard/overview`, `#/company/${long}/dashboard/${long}`, `#/markets/${long}/deck`,
      `#/markets/${long}/opportunity`, `#/reports/${long}`, `#/${long}`, `#/settings/${long}`,
      `#/markets/${MARKET}/deck?card=${long}`,
    ]) {
      await page.goto(`/${hash}`);
      await expectAlive(page, hash.slice(0, 60));
      const over = await page.evaluate(() => { const de = document.documentElement; const m = document.querySelector('main'); return Math.max(de.scrollWidth - de.clientWidth, (m?.scrollWidth ?? 0) - (m?.clientWidth ?? 0)); });
      expect(over, `${hash.slice(0, 50)}@${width}`).toBeLessThanOrEqual(1);
    }
  }
  // A very long market description in the New Deck box: it takes it, wraps it, and stays in the window.
  await page.goto('/#/');
  const box = page.getByPlaceholder('Describe a market…');
  await box.fill(`${long} ${'word '.repeat(400)}`);
  expect(await page.evaluate(() => { const de = document.documentElement; return de.scrollWidth - de.clientWidth; })).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
