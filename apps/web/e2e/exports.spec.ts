import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { unlockPreview } from './access';

// Every way out of a deck: the CSV, the PowerPoint, the PDF (the browser's print) and the share link. They all run on the
// seed deck with no key, so nothing here researches anything.
const DECK = '/#/markets/mkt_frontier-ai-ecosystem_s248s/deck';

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com|example\.com/, (route) => route.abort());
  await unlockPreview(page);
});

async function openExportMenu(page: Page) {
  await page.goto(DECK);
  await page.waitForSelector('[data-testid="card-grid"]');
  await page.getByRole('button', { name: /Share & export/i }).click();
}

/** Minimal RFC 4180 reader: quoted cells, doubled quotes, CRLF rows. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

test('the CSV is a clean, honest table: one header, equal rows, no stray values, every figure with its source', async ({ page }) => {
  await openExportMenu(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Data \(CSV\)/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^frontier-ai-ecosystem-metrics-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = readFileSync((await download.path())!, 'utf8');
  expect(text.charCodeAt(0)).toBe(0xfeff); // the byte-order mark Excel needs to read UTF-8
  const rows = parseCsv(text.slice(1)).filter((r) => r.length > 1 || r[0] !== '');
  const [header, ...data] = rows;
  expect(header).toEqual(expect.arrayContaining(['market', 'company', 'metric', 'value', 'confidence', 'as_of', 'source_title', 'source_url']));
  expect(data.length).toBeGreaterThan(20);
  for (const row of data) expect(row, row.join('|')).toHaveLength(header!.length);
  expect(text).not.toMatch(/undefined|NaN|\[object/);
  const col = (name: string) => header!.indexOf(name);
  for (const row of data) {
    const known = row[col('confidence')] !== 'unknown';
    // An unknown figure is a blank value; a known one is a number with a named source: never a figure without its source.
    if (known) {
      expect(Number.isFinite(Number(row[col('value')])), row.join('|')).toBe(true);
      expect(row[col('source_title')], row.join('|')).not.toBe('');
      expect(row[col('source_url')], row.join('|')).toMatch(/^https?:\/\//);
    } else {
      expect(row[col('value')], row.join('|')).toBe('');
    }
  }
});

test('the PowerPoint is a real .pptx with slides in it', async ({ page }) => {
  await openExportMenu(page);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('menuitem', { name: /PowerPoint/ }).click()]);
  expect(download.suggestedFilename()).toBe('frontier-ai-ecosystem-deck.pptx');
  const bytes = readFileSync((await download.path())!);
  expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304'); // a zip, which is what Office Open XML is
  expect(bytes.length).toBeGreaterThan(50_000);
  // File names inside a zip sit uncompressed in its local headers.
  for (const part of ['[Content_Types].xml', 'ppt/presentation.xml', 'ppt/slides/slide1.xml']) expect(bytes.includes(Buffer.from(part)), part).toBe(true);
});

test('the PDF is the browser print of a report with contents and every company, titled for the file', async ({ page }) => {
  // The print dialog is the browser's; what the app hands it is what a PDF would hold.
  await page.addInitScript(() => {
    const w = window as unknown as { print: () => void; __printed?: { title: string; text: string; exporting: boolean } };
    w.print = () => {
      const doc = document.querySelector('.sm-print-doc') as HTMLElement | null;
      w.__printed = { title: document.title, text: doc?.innerText ?? '', exporting: document.body.classList.contains('sm-exporting') };
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await openExportMenu(page);
  await page.getByRole('menuitem', { name: /Deck report \(PDF\)/ }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { __printed?: unknown }).__printed));
  const printed = await page.evaluate(() => (window as unknown as { __printed: { title: string; text: string; exporting: boolean } }).__printed);
  expect(printed.title).toBe('Frontier AI Ecosystem - Stratemark market report');
  expect(printed.exporting).toBe(true); // the print stylesheet shows only the report while it prints
  expect(printed.text).toMatch(/Contents/);
  expect(printed.text).toMatch(/Anthropic/);
  expect(printed.text).toMatch(/never guessed or filled in/);
  // Afterwards the page is itself again: title restored, report gone.
  await expect(page.locator('.sm-print-doc')).toHaveCount(0);
  await expect(page).toHaveTitle(/^(?!.*market report)/);
});

test('the share link is one address that opens a read-only copy', async ({ page, browser }) => {
  await openExportMenu(page);
  await page.getByRole('menuitem', { name: /Share link/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Share — Frontier AI Ecosystem')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Copy link/ })).toBeVisible();
  const link = await dialog.locator('input').first().inputValue();
  expect(link).toMatch(/#\/share\/[A-Za-z0-9_-]+$/);
  // A visitor with nothing stored opens it and sees the deck, not a gate.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.route(/fonts\.(googleapis|gstatic)\.com|example\.com/, (route) => route.abort());
  await visitor.goto(link);
  await expect(visitor.getByText('Frontier AI Ecosystem').first()).toBeVisible({ timeout: 15_000 });
  await visitor.context().close();
});
