/** Real Electron UI -> IPC -> research pipeline -> native SQLite -> reopen.
 * Provider responses are explicitly synthetic; no live research or credentials.
 * Usage: node scripts/native-journey-smoke.mjs --output <absolute outside-repo directory>
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const webRequire = createRequire(path.join(root, 'apps/web/package.json'));
const desktopRequire = createRequire(path.join(root, 'apps/desktop/package.json'));
const { _electron: electron, expect } = webRequire('@playwright/test');
const outputArg = process.argv.indexOf('--output');
assert.ok(
  outputArg >= 0 && path.isAbsolute(process.argv[outputArg + 1] ?? ''),
  'Provide absolute --output directory.',
);
const outputRoot = path.resolve(process.argv[outputArg + 1]);
const relative = path.relative(root, outputRoot);
assert.ok(relative.startsWith(`..${path.sep}`), 'Store recordings outside the source checkout.');
mkdirSync(outputRoot, { recursive: true });
const output = mkdtempSync(path.join(outputRoot, 'native-journey-'));
const workspace = path.join(output, 'synthetic-vault');
const executablePath = desktopRequire('electron');
const env = {};
for (const name of [
  'SystemRoot',
  'WINDIR',
  'PATH',
  'Path',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
]) {
  if (process.env[name]) env[name] = process.env[name];
}
const startedAt = new Date().toISOString();
const steps = [];
const failures = [];
let application;
let page;
let video;
let deckPath;
let savedSource;
let sourceCardId;
const mark = (name) => {
  steps.push({ name, at: new Date().toISOString() });
  process.stdout.write(`JOURNEY ${name}\n`);
};
// Presentation holds make the actual screen recording readable, not a timing assertion.
const hold = (milliseconds = 1200) => page.waitForTimeout(milliseconds);
async function launch(fixture, name) {
  application = await electron.launch({
    executablePath,
    args: [
      path.join(root, 'apps/desktop'),
      `--native-vault-dir=${workspace}`,
      ...(fixture ? ['--native-fixture'] : []),
    ],
    env,
    timeout: 30000,
    slowMo: 180,
    recordVideo: { dir: output, size: { width: 1440, height: 960 } },
  });
  page = await application.firstWindow({ timeout: 30000 });
  video = page.video();
  assert.ok(video, 'Electron video capture must be active.');
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(1440, 960);
    window.webContents.setBackgroundThrottling(false);
  });
  page.on('pageerror', (error) => failures.push(error.message));
  // Keep every external source/logo/provider URL offline, while retaining app:// assets.
  await application.context().route(/^https?:\/\//, (route) => route.abort());
  await expect(page.getByRole('heading', { name: 'All decks', exact: true })).toBeVisible();
  mark(name);
  await hold();
}
async function close(name) {
  await application.close();
  await video.saveAs(path.join(output, name));
  application = null;
}
async function createDeck(goal) {
  await page.getByRole('link', { name: 'New Deck', exact: true }).click();
  await page.getByLabel('Market and research question').fill(goal);
  await page.getByRole('button', { name: 'Review scope', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review this research pass' })).toBeVisible();
  mark('Scope reviewed before any dispatch');
  await hold();
  await page.getByRole('button', { name: 'Approve and start research' }).click();
  await expect(page.getByText('Research running', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCSS(
    'border-radius',
    '9999px',
  );
  mark('Accepted native run has visible progress and controls');
}
try {
  await launch(true, 'Actual desktop opened with labeled synthetic provider');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic fixture connection' })).toBeVisible();
  for (const tab of ['Data controls', 'Usage & limits', 'About']) {
    const control = page.getByRole('button', { name: tab, exact: true });
    await expect(control).toBeVisible();
    await control.click();
    await hold(800);
  }
  await page.keyboard.press('Escape');
  mark('Settings visited without credentials or false live connection');
  await createDeck('Synthetic independent repair software and tooling');
  deckPath = await page.evaluate(() => location.hash);
  await expect(page.getByText('Research failed', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: /Alder Works.*card/ })).toBeVisible();
  sourceCardId = await page.evaluate(async () => {
    const run = (await window.mi.listNativeRuns())[0];
    return (await window.mi.listCards(run.deckId)).find(
      (entry) => entry.company?.name === 'Alder Works',
    ).card.id;
  });
  savedSource = await page.evaluate(
    async (cardId) => (await window.mi.getNativeCardEvidence(cardId)).sources[0],
    sourceCardId,
  );
  assert.equal(
    savedSource.retrievalStatus,
    'retrieved',
    'Synthetic source must be retained, not just linked.',
  );
  assert.equal(savedSource.support, 'unreviewed', 'Fetching text is not semantic verification.');
  assert.ok(savedSource.sourceId && savedSource.passageId && savedSource.fetchedAt);
  await page.getByText('Research activity', { exact: true }).click();
  await expect(page.getByText(/Could not complete Birch Works/)).toBeVisible();
  await page.screenshot({ path: path.join(output, 'partial-research.png') });
  mark('One failed company preserved the successful card and activity');
  await hold(1800);
  await page.getByRole('button', { name: /Alder Works.*card/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Synthetic fixture source — not live research' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Show retained text', exact: true }).click();
  await expect(page.getByText(/Synthetic source text — not live research\./)).toBeVisible();
  await page.getByRole('button', { name: 'Save card', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove from saved', exact: true })).toBeEnabled();
  assert.equal((await page.evaluate(() => window.mi.listSavedCards())).length, 1);
  mark('Saved the exact researched card from its local evidence reader');
  await page.screenshot({ path: path.join(output, 'retained-source-leads.png') });
  await hold(1800);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Resume remaining work', exact: true }).click();
  await expect(page.getByText('Research completed', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('button', { name: /Birch Works.*card/ })).toBeVisible();
  await page.getByRole('button', { name: 'Infrastructure', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Infrastructure', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: /Alder Works.*card/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'All cards', exact: true }).click();
  await expect(page.getByRole('button', { name: 'All cards', exact: true })).toHaveCSS(
    'border-radius',
    '9999px',
  );
  assert.notEqual(
    await page
      .getByRole('button', { name: 'All cards', exact: true })
      .evaluate((button) => getComputedStyle(button).backgroundColor),
    await page
      .getByRole('button', { name: 'Infrastructure', exact: true })
      .evaluate((button) => getComputedStyle(button).backgroundColor),
    'The selected filter must have a distinct visual state.',
  );
  await page.getByText('Research activity', { exact: true }).click();
  await page.getByRole('button', { name: /Alder Works.*card/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'completed-deck.png') });
  mark('Retry completed original unfinished company; filters read persisted cards');
  await hold(1800);
  const beforeCollection = await page.evaluate(() => window.mi.listNativeRuns());
  await page.getByRole('button', { name: /Birch Works.*card/ }).click();
  await page.getByRole('button', { name: 'Save card', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove from saved', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Saved Cards', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved cards', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Alder Works.*card/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Birch Works.*card/ })).toBeVisible();
  await page.screenshot({ path: path.join(output, 'saved-collection.png') });
  await hold(1800);
  await page.evaluate((cardId) => {
    location.hash = `#/saved?card=${encodeURIComponent(cardId)}`;
  }, sourceCardId);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Remove from saved', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo removal', exact: true })).toBeEnabled();
  assert.equal((await page.evaluate(() => window.mi.listSavedCards())).length, 1);
  assert.ok(await page.evaluate((cardId) => window.mi.getCard(cardId), sourceCardId));
  await page.getByRole('button', { name: 'Show retained text', exact: true }).click();
  await expect(page.getByText(/Synthetic source text — not live research\./)).toBeVisible();
  mark(
    'Removal changes only the collection; the open research and retained sources remain readable',
  );
  await hold();
  await page.getByRole('button', { name: 'Undo removal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove from saved', exact: true })).toBeEnabled();
  assert.equal((await page.evaluate(() => window.mi.listSavedCards())).length, 2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Saved cards', exact: true })).toBeFocused();
  await page.getByRole('button', { name: /Alder Works.*card/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Alder Works.*card/ })).toBeFocused();
  await page
    .locator('article')
    .filter({ has: page.getByRole('button', { name: /Alder Works.*card/ }) })
    .getByRole('link', { name: 'Open source deck' })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  assert.deepEqual(
    await page.evaluate(() => window.mi.listNativeRuns()),
    beforeCollection,
    'Collection browsing/save/remove/undo must not change research runs or request usage.',
  );
  mark(
    'Undo restores the exact card; source-deck navigation and return focus work without research requests',
  );
  await createDeck('Second synthetic market to verify fresh run controls');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Research cancelled', { exact: true })).toBeVisible();
  mark('Second deck has fresh controls; cancellation is persisted');
  await hold();
  await close('01-native-research-and-recovery.webm');

  await launch(false, 'Reopened the same native vault without fixture provider or a key');
  assert.deepEqual(
    await page.evaluate(() => ({
      provenance: window.mi.researchProvenance,
      writable: window.mi.nativeResearchWritable,
    })),
    { provenance: 'synthetic_fixture', writable: false },
    'Retained fixture identity survives keyless reopen; live dispatch is disabled.',
  );
  assert.equal(
    await page.evaluate(() => window.miSecure.getApiKeyStatus().then((result) => result.hasKey)),
    false,
  );
  await page.evaluate((hash) => {
    location.hash = hash;
  }, deckPath);
  await expect(page.getByText('Research completed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Alder Works.*card/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Birch Works.*card/ })).toBeVisible();
  await page.screenshot({ path: path.join(output, 'reopened-without-key.png') });
  mark('Both saved cards reopened without constructing a provider');
  const beforeRead = await page.evaluate(() => window.mi.listNativeRuns());
  const reopenedSource = await page.evaluate(
    async (cardId) => (await window.mi.getNativeCardEvidence(cardId)).sources[0],
    sourceCardId,
  );
  assert.deepEqual(
    reopenedSource,
    savedSource,
    'Exact source text and capture identity survive restart.',
  );
  await page.getByRole('button', { name: /Alder Works.*card/ }).click();
  await page.getByRole('button', { name: 'Show retained text', exact: true }).click();
  await expect(page.getByText(/Synthetic source text — not live research\./)).toBeVisible();
  await hold(1800);
  await page.screenshot({ path: path.join(output, 'reopened-retained-source.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'Saved source reader must fit a narrow window.',
  );
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByText(/Synthetic source text — not live research\./).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'narrow-retained-source.png') });
  await hold();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.keyboard.press('Escape');
  assert.deepEqual(
    await page.evaluate(() => window.mi.listNativeRuns()),
    beforeRead,
    'Opening saved evidence must not cause provider/source requests or change runs.',
  );
  mark(
    'Retained source text reopened offline with no provider/source dispatch; support remains unreviewed',
  );
  await page.getByRole('link', { name: 'Saved Cards', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved cards', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Alder Works.*card/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Birch Works.*card/ })).toBeVisible();
  assert.equal((await page.evaluate(() => window.mi.listSavedCards())).length, 2);
  await page.getByRole('button', { name: /Alder Works.*card/ }).click();
  await expect(page.getByRole('button', { name: 'Remove from saved', exact: true })).toBeDisabled();
  const deniedChange = await page.evaluate(async (cardId) => {
    try {
      await window.mi.unsaveCard(cardId);
      return null;
    } catch (error) {
      return error.message;
    }
  }, sourceCardId);
  assert.match(
    deniedChange,
    /Changes are disabled.*provenance-preserving/i,
    'The host must deny collection changes even when a caller bypasses disabled UI.',
  );
  assert.equal((await page.evaluate(() => window.mi.listSavedCards())).length, 2);
  await page.getByRole('button', { name: 'Show retained text', exact: true }).click();
  await expect(page.getByText(/Synthetic source text — not live research\./)).toBeVisible();
  await page.screenshot({ path: path.join(output, 'keyless-saved-collection-reader.png') });
  await hold(1800);
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => window.mi.listNativeRuns()), beforeRead);
  mark(
    'Exact saved collection reopened keyless and read-only, with retained source text and unchanged request usage',
  );
  await hold(1800);
  await page.evaluate(() => {
    location.hash = '#/design/cards';
  });
  await expect(page.getByRole('heading', { name: 'The seven-card family' })).toBeVisible();
  const previews = page.getByRole('button', { name: /^Preview / });
  const count = await previews.count();
  assert.equal(count, 9, 'Seven types and two edge cases.');
  for (let index = 0; index < count; index += 1) {
    await previews.nth(index).click();
    const sections = page.getByLabel('Preview sections');
    for (const label of [
      'Overview',
      'Offering',
      'Market position',
      'Evidence',
      'Updates',
      'Open questions',
    ]) {
      const control = sections.getByRole('button', { name: label, exact: true });
      if (await control.count()) {
        await control.click();
        await hold(500);
      }
    }
  }
  await page.screenshot({ path: path.join(output, 'seven-card-composition.png'), fullPage: true });
  mark(
    'All seven synthetic composition types and available sections visited; these are not wired R2 destinations',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'No horizontal overflow in narrow card composition.',
  );
  await page.screenshot({ path: path.join(output, 'narrow-reduced-motion.png'), fullPage: true });
  mark('Narrow composition and reduced-motion preference checked');
  await hold(1800);
  await close('02-reopen-and-seven-card-composition.webm');
  assert.deepEqual(failures, [], 'No renderer exceptions.');
} catch (error) {
  if (page && !page.isClosed())
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  failures.push(error instanceof Error ? error.message : String(error));
  if (application) await close('failed-journey.webm').catch(() => {});
  process.exitCode = 1;
} finally {
  let commit = 'unknown';
  const gitOptions = { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  const safeRepo = `safe.directory=${root.replaceAll('\\', '/')}`;
  let dirty = true;
  try {
    commit = execFileSync('git', ['-c', safeRepo, 'rev-parse', 'HEAD'], gitOptions).trim();
    dirty =
      execFileSync('git', ['-c', safeRepo, 'status', '--porcelain'], gitOptions).trim().length > 0;
  } catch {
    failures.push('Could not establish commit/working-tree provenance.');
    process.exitCode = 1;
  }
  writeFileSync(
    path.join(output, 'receipt.json'),
    JSON.stringify(
      {
        startedAt,
        finishedAt: new Date().toISOString(),
        commit,
        dirty,
        storage: 'isolated native SQLite preview',
        provenance: 'synthetic fixture responses, actual desktop/IPC/pipeline/persistence',
        liveResearch: false,
        productionAcceptance: false,
        steps,
        failures,
        unavailable: [
          'claim-level semantic support review',
          'normal native cutover',
          'R2 real portals/story destinations',
          'broad provider configuration',
          'sharing',
          'questions',
          'monitoring',
          'MCP',
          'signed packaging',
        ],
      },
      null,
      2,
    ),
  );
  process.stdout.write(`JOURNEY_OUTPUT ${output}\n`);
  if (failures.length) process.stderr.write(`${failures.join('\n')}\n`);
}
