import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { unlockPreview } from './access';

/**
 * A share is one page with the research inside. These tests build real shares
 * from the app's own Share dialog, unzip them, serve the folder from a plain
 * static server, and open them like a recipient would: on a phone, with every
 * outside request blocked, walking card -> dashboard and deck -> card -> dashboard.
 */

/** Reads a stored (uncompressed) zip such as the one the app writes. */
function unzipStored(bytes: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let at = 0;
  while (bytes.readUInt32LE(at) === 0x04034b50) {
    const method = bytes.readUInt16LE(at + 8);
    const size = bytes.readUInt32LE(at + 18);
    const nameLength = bytes.readUInt16LE(at + 26);
    const extraLength = bytes.readUInt16LE(at + 28);
    const name = bytes.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    expect(method).toBe(0);
    const start = at + 30 + nameLength + extraLength;
    files.set(name, bytes.subarray(start, start + size));
    at = start + size;
  }
  return files;
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };

function serve(root: string): Promise<{ server: Server; origin: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
      if (path.endsWith('/')) path += 'index.html';
      try {
        const body = readFileSync(join(root, path));
        res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

async function downloadShare(page: Page): Promise<{ dir: string; id: string; files: Map<string, Buffer> }> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download the page (.zip)' }).click();
  const file = await (await download).path();
  const files = unzipStored(readFileSync(file));
  const dir = mkdtempSync(join(tmpdir(), 'stratemark-share-'));
  for (const [name, data] of files) {
    const target = join(dir, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  const id = [...files.keys()].find((n) => n.endsWith('/index.html'))!.split('/')[0]!;
  return { dir, id, files };
}

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com|example\.com/, (route) => route.abort());
  await unlockPreview(page);
});

test('a shared card opens read-only on a phone and walks into its dashboard with no calls home', async ({ page, browser }) => {
  await page.goto('/#/history');
  await page.getByRole('button', { name: /Frontier AI Ecosystem/ }).first().click();
  await expect(page.getByTestId('card-grid')).toBeVisible();
  await page.getByTestId('card-grid').getByRole('button', { name: 'Share card' }).first().click();
  await expect(page.getByRole('dialog', { name: /Share/ })).toBeVisible();
  await page.getByLabel('Where you will host it (optional)').fill('https://share.example.com');
  const share = await downloadShare(page);

  // The package: page, preview picture, and the hosting settings.
  expect([...share.files.keys()].sort()).toEqual(['README.txt', 'firebase.json', `${share.id}/index.html`, `${share.id}/og.png`].sort());
  const html = share.files.get(`${share.id}/index.html`)!.toString('utf8');
  expect(html).toContain('property="og:title"');
  expect(html).toContain(`content="https://share.example.com/${share.id}/og.png"`);
  expect(share.files.get(`${share.id}/og.png`)!.subarray(0, 4).toString('hex')).toBe('89504e47');
  expect(share.files.get('firebase.json')!.toString('utf8')).toContain('"public": "."');
  expect(html).toMatch(/<script id="stratemark-share-data" type="application\/json">\{"snapshot":/);

  const { server, origin } = await serve(share.dir);
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const viewer = await phone.newPage();
  const outside: string[] = [];
  const keyed: string[] = [];
  // The visitor may well have their own Stratemark settings in this browser: a share must never see or send them.
  await viewer.addInitScript(() => {
    localStorage.setItem('mi.geminiApiKey', 'SENTINEL-VISITOR-KEY');
    localStorage.setItem('mi.apiKey', 'SENTINEL-VISITOR-KEY');
  });
  await viewer.route('**/*', (route) => {
    const request = route.request();
    const url = request.url();
    if (request.headers()['x-goog-api-key'] || url.includes('SENTINEL-VISITOR-KEY') || (request.postData() ?? '').includes('SENTINEL-VISITOR-KEY')) keyed.push(url);
    if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    outside.push(`${request.method()} ${url}`);
    return route.abort();
  });
  try {
    await viewer.goto(`${origin}/${share.id}/`);
    // The card, read-only: nothing to research, ask, save or share.
    await expect(viewer.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(viewer.getByText('Want to research more companies?')).toBeVisible();
    await expect(viewer.getByRole('link', { name: 'Sign up' }).first()).toHaveAttribute('href', 'https://getstratemark.com');
    await expect(viewer.getByRole('button', { name: /ask|research|share|save/i })).toHaveCount(0);

    await viewer.getByRole('link', { name: /View the full research/ }).click();
    await expect(viewer.getByRole('heading', { name: 'Key figures' })).toBeVisible();
    await viewer.getByRole('link', { name: 'Metrics' }).click();
    await expect(viewer.getByText('ARR').first()).toBeVisible();
    // The Products tab is where a saved key used to start picture generation.
    const productsHref = await viewer.getByRole('navigation', { name: 'Company dashboard tabs' }).getByRole('link', { name: /Products/ }).getAttribute('href');
    await viewer.evaluate((href) => { window.location.hash = href!.replace(/^#/, ''); }, productsHref);
    await viewer.waitForTimeout(1500);
    await expect(viewer.getByPlaceholder(/Research anything/)).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /Share & export|Chats/ })).toHaveCount(0);

    // Phone width: nothing spills sideways.
    const overflow = await viewer.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await phone.close();
    server.close();
  }
  // The shared page never contacts Stratemark, a model service or a sign-in service. It may still fetch public
  // pictures and reference lookups (Wikipedia portraits, page captures) from their public sources.
  expect(keyed).toEqual([]);
  expect(outside.filter((r) => /generativelanguage|googleapis\.com\/v1beta/i.test(r))).toEqual([]);
  expect(outside.filter((r) => /stratemark|run\.app|workers\.dev|firebase|generativelanguage|identitytoolkit|securetoken/i.test(r))).toEqual([]);
});

test('a shared deck opens on the deck and walks deck -> card -> dashboard', async ({ page, browser }) => {
  await page.goto('/#/history');
  await page.getByRole('button', { name: /Frontier AI Ecosystem/ }).first().click();
  await expect(page.getByTestId('card-grid')).toBeVisible();
  await page.getByRole('button', { name: 'Share & export' }).click();
  await page.getByRole('menuitem', { name: /share link/i }).click();
  const share = await downloadShare(page);

  const { server, origin } = await serve(share.dir);
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const viewer = await phone.newPage();
  await viewer.route('**/*', (route) => {
    const url = route.request().url();
    return url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
  });
  try {
    await viewer.goto(`${origin}/${share.id}/`);
    await expect(viewer.getByRole('heading', { name: /Frontier AI Ecosystem/ })).toBeVisible();
    await expect(viewer.getByTestId('card-grid')).toBeVisible();
    // Nothing to ask, compare, share or change in a shared copy.
    await expect(viewer.getByRole('button', { name: /^Ask|Share & export|More actions/ })).toHaveCount(0);
    await viewer.getByTestId('card-grid').getByRole('button', { name: /OpenAI — Company card/ }).first().click();
    const dialog = viewer.getByRole('dialog');
    await expect(dialog.getByRole('region', { name: 'Company summary' })).toBeVisible();
    await dialog.getByRole('link', { name: /open full company dashboard/i }).click();
    await expect(viewer.getByRole('heading', { name: 'Key figures' })).toBeVisible();
    const overflow = await viewer.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await phone.close();
    server.close();
  }
});

/** A hosted link opens share.html?s=<id>, which reads its research from the share Worker by id. The Worker is stood in for here. */
const HOSTED_ID = 'e2eshareidabcdefg'.slice(0, 16);

async function packedCardShare(page: Page): Promise<string> {
  await page.goto('/#/history');
  await page.getByRole('button', { name: /Frontier AI Ecosystem/ }).first().click();
  await expect(page.getByTestId('card-grid')).toBeVisible();
  await page.getByTestId('card-grid').getByRole('button', { name: 'Share card' }).first().click();
  await expect(page.getByRole('dialog', { name: /Share/ })).toBeVisible();
  const share = await downloadShare(page);
  const html = share.files.get(`${share.id}/index.html`)!.toString('utf8');
  const embedded = /<script id="stratemark-share-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  const { snapshot } = JSON.parse(embedded![1]!) as { snapshot: unknown };
  // The wire format the app uploads: "z" + deflated JSON as URL-safe base64.
  return `z${deflateRawSync(Buffer.from(JSON.stringify(snapshot))).toString('base64url')}`;
}

test('a hosted share link opens from its id with one read of its own research, then it is the same read-only app', async ({ page, browser, baseURL }) => {
  const packed = await packedCardShare(page);
  const phone = await browser.newContext({ baseURL: baseURL!, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const viewer = await phone.newPage();
  const outside: string[] = [];
  const reads: string[] = [];
  await viewer.addInitScript(() => {
    localStorage.setItem('mi.geminiApiKey', 'SENTINEL-VISITOR-KEY');
    localStorage.setItem('mi.apiKey', 'SENTINEL-VISITOR-KEY');
  });
  await viewer.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(baseURL!) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    outside.push(`${route.request().method()} ${url}`);
    return route.abort();
  });
  await viewer.route(`**/v1/share/${HOSTED_ID}`, (route) => {
    reads.push(route.request().method());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ v: 1, kind: 'card', data: packed }) });
  });
  try {
    await viewer.goto(`/share.html?s=${HOSTED_ID}`);
    await expect(viewer.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(viewer.getByText('Want to research more companies?')).toBeVisible();
    await expect(viewer.getByRole('button', { name: /ask|research|share|save/i })).toHaveCount(0);
    await expect(viewer).toHaveTitle(/sourced research on Stratemark/);
    await viewer.getByRole('link', { name: /View the full research/ }).click();
    await expect(viewer.getByRole('heading', { name: 'Key figures' })).toBeVisible();
    expect(await viewer.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  } finally {
    await phone.close();
  }
  expect(reads).toEqual(['GET']);
  expect(outside.filter((r) => /generativelanguage|googleapis\.com\/v1beta|identitytoolkit|securetoken/i.test(r))).toEqual([]);
});

test('a hosted link that was stopped or has expired says so instead of showing an empty app', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL: baseURL! });
  const viewer = await context.newPage();
  await viewer.route(`**/v1/share/${HOSTED_ID}`, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"gone"}' }));
  try {
    await viewer.goto(`/share.html?s=${HOSTED_ID}`);
    await expect(viewer.getByRole('alert')).toContainText('This link is no longer available');
    await expect(viewer.getByRole('alert')).toContainText('Ask whoever sent it for a fresh link');
    await expect(viewer.getByTestId('card-grid')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('a hosted link whose research is damaged says it cannot be opened', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL: baseURL! });
  const viewer = await context.newPage();
  await viewer.route(`**/v1/share/${HOSTED_ID}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ v: 1, kind: 'deck', data: 'zAAAA-not-a-share' }) }));
  try {
    await viewer.goto(`/share.html?s=${HOSTED_ID}`);
    await expect(viewer.getByRole('alert')).toContainText('could not be opened');
  } finally {
    await context.close();
  }
});

test('share.html with no id and no research says it has none', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL: baseURL! });
  const viewer = await context.newPage();
  try {
    await viewer.goto('/share.html');
    await expect(viewer.getByRole('alert')).toContainText('no shared research');
    await viewer.goto('/share.html?s=../../etc/passwd');
    await expect(viewer.getByRole('alert')).toContainText('no shared research');
  } finally {
    await context.close();
  }
});
