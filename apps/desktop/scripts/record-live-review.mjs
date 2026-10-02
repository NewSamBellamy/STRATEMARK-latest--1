/** Reads an isolated completed live evaluation; never dispatches new research. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const [workspace, outputRoot] = process.argv.slice(2);
assert.ok(workspace && outputRoot && path.isAbsolute(workspace) && path.isAbsolute(outputRoot));
for (const directory of [workspace, outputRoot])
  assert.ok(
    path.relative(root, directory).startsWith(`..${path.sep}`),
    'Use isolated external output.',
  );
const evaluation = JSON.parse(readFileSync(path.join(workspace, 'result.json'), 'utf8'));
assert.equal(evaluation.liveResearch, true);
assert.equal(evaluation.run.status, 'completed');
const { _electron: electron, expect } = createRequire(path.join(root, 'apps/web/package.json'))(
  '@playwright/test',
);
const executablePath = createRequire(path.join(root, 'apps/desktop/package.json'))('electron');
mkdirSync(outputRoot, { recursive: true });
const output = mkdtempSync(path.join(outputRoot, 'live-review-'));
const env = Object.fromEntries(
  ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
const failures = [];
const steps = [];
let application;
let page;
let video;
try {
  application = await electron.launch({
    executablePath,
    args: [path.join(root, 'apps/desktop'), `--native-vault-dir=${workspace}`],
    env,
    timeout: 30000,
    slowMo: 180,
    recordVideo: { dir: output, size: { width: 1440, height: 960 } },
  });
  page = await application.firstWindow();
  video = page.video();
  page.on('pageerror', (error) => failures.push(error.message));
  await application.context().route(/^https?:\/\//, (route) => route.abort());
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 960),
  );
  await expect(page.getByRole('heading', { name: 'All decks', exact: true })).toBeVisible();
  steps.push(
    'Keyless desktop reopened completed live Gemini research; external renderer network disabled.',
  );
  await page.evaluate((marketId) => {
    location.hash = `/markets/${marketId}/deck`;
  }, evaluation.run.marketId);
  await expect(page.getByText('Research completed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /OpenAI.*card/ })).toBeVisible();
  await page.screenshot({ path: path.join(output, 'deck.png') });
  await page.waitForTimeout(1500);
  await page.getByLabel('Search this deck').fill('Mistral');
  await expect(page.getByText('Showing 1 of 3 cards')).toBeVisible();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  steps.push('Local search filtered the three live cards and restored the deck.');
  for (const name of ['OpenAI', 'Anthropic', 'Mistral AI']) {
    const saved = evaluation.cards.find((entry) => entry.company?.name.startsWith(name));
    assert.ok(saved, `Missing expected ${name} card in evaluation.`);
    const labels = {
      overview: 'Overview',
      offering: 'Products & business',
      position: 'Market position',
      updates: 'Updates',
    };
    const sections = (saved.researchBrief?.sections ?? []).map(
      (section) => labels[section.section],
    );
    await page.getByRole('button', { name: new RegExp(`${name}.*card`) }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(sections.length);
    for (const section of sections) {
      await page.getByRole('tab', { name: section, exact: true }).click();
      await expect(page.getByRole('tabpanel')).toBeVisible();
      await page.waitForTimeout(1400);
      if (section === 'Products & business')
        await page.screenshot({
          path: path.join(output, `${name.replaceAll(' ', '-')}-products.png`),
        });
    }
    const sources = page.getByRole('region', { name: 'Source evidence' });
    await sources.scrollIntoViewIfNeeded();
    await expect(sources.getByRole('heading', { name: 'Sources to inspect' })).toBeVisible();
    await page.waitForTimeout(800);
    steps.push(
      `${name}: inspected ${sections.length} retained sections (${sections.join(', ')}); missing sections are not backfilled. Honest source-capture states inspected.`,
    );
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, 'narrow-deck.png'), fullPage: true });
  await page.getByRole('button', { name: /OpenAI.*card/ }).click();
  await page.screenshot({ path: path.join(output, 'narrow-reader.png') });
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape');
  steps.push('Narrow deck has no horizontal overflow; reader opens and closes.');
  assert.deepEqual(failures, []);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
  if (page && !page.isClosed())
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await application?.close();
  await video?.saveAs(path.join(output, 'live-research-review.webm'));
  const git = (...args) =>
    execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  writeFileSync(
    path.join(output, 'receipt.json'),
    JSON.stringify(
      {
        commit: git('rev-parse', 'HEAD'),
        dirty: !!git('status', '--porcelain'),
        liveResearch: true,
        researchDispatch: 'Native service evaluation harness, not UI submission',
        recording: 'Actual desktop reading isolated live results; no new provider calls',
        productionAcceptance: false,
        steps,
        failures,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ output, failures }));
}
