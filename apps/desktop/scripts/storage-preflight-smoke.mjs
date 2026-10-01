/** Actual Electron/IPC journey for storage status and read-only migration preflight. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const webRequire = createRequire(path.join(root, 'apps/web/package.json'));
const { _electron: electron, expect } = webRequire('@playwright/test');
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  assert.ok(index >= 0 && args[index + 1] && !args[index + 1].startsWith('--'), `missing ${name}`);
  return path.resolve(args[index + 1]);
}

const executable = option('--electron');
const appDir = option('--app');
const env = {};
for (const key of [
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
  if (process.env[key]) env[key] = process.env[key];
}

const temp = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'stratemark-preflight-proof-'));
const researchFile = path.join(temp, 'research', 'repo.json');
const fingerprint = () => ({
  sha256: createHash('sha256').update(readFileSync(researchFile)).digest('hex'),
  size: statSync(researchFile).size,
  modified: statSync(researchFile).mtimeMs,
});

let application;
try {
  application = await electron.launch({
    executablePath: executable,
    args: [appDir, `--preview-data-dir=${temp}`],
    env,
    timeout: 30000,
  });
  const page = await application.firstWindow({ timeout: 30000 });
  const errors = [];
  const providerRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/generativelanguage\.googleapis\.com/i.test(request.url())) {
      providerRequests.push(request.url());
    }
  });

  const openDataControls = async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('button', { name: 'Data controls', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Data safety', exact: true })).toBeVisible();
  };

  await openDataControls();
  await expect(page.getByText('Bundled sample research only', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Check migration readiness', exact: true }),
  ).toBeDisabled();

  // Turn the bundled sample into a valid synthetic workspace inside this disposable profile.
  await page.evaluate(async () => {
    const json = await window.miSecure.exportResearch();
    if (!json) throw new Error('Expected bundled sample research.');
    const snapshot = JSON.parse(json);
    snapshot.markets[0].name = `${snapshot.markets[0].name} — local smoke copy`;
    await window.miSecure.importResearch(JSON.stringify(snapshot));
  });
  await page.reload();
  await openDataControls();
  await expect(page.getByText(/\d+ decks · \d+ markets · \d+ KB/)).toBeVisible();
  const readinessButton = page.getByRole('button', {
    name: 'Check migration readiness',
    exact: true,
  });
  await expect(readinessButton).toBeEnabled();

  const before = fingerprint();
  page.once('dialog', (dialog) => dialog.accept());
  await readinessButton.click();
  await expect(page.getByRole('status')).toContainText('Readiness check passed');
  await expect(page.getByRole('status')).toContainText('migration remains disabled');
  const after = fingerprint();
  assert.deepEqual(after, before);

  const result = await page.evaluate(async () => ({
    storage: await window.miSecure.getResearchStorageInfo(),
    readiness: await window.miSecure.preflightResearchMigration(),
  }));
  assert.equal(result.storage.engine, 'legacy_json');
  assert.equal(result.storage.health, 'ready');
  assert.equal(result.storage.contentKind, 'workspace');
  assert.equal(result.readiness.state, 'ready');
  assert.equal(result.readiness.canApply, false);
  assert.equal(result.readiness.performedWrites, false);
  assert.deepEqual(errors, []);
  assert.deepEqual(providerRequests, []);

  console.log(
    JSON.stringify({
      journey: 'desktop-settings-data-status-migration-preflight',
      isolatedProfile: true,
      nativeIPC: true,
      demoGuard: true,
      workspaceReadiness: true,
      performedWrites: false,
      providerRequests: 0,
      pageErrors: 0,
    }),
  );
} finally {
  if (application) await application.close();
  const real = realpathSync(temp);
  assert.equal(lstatSync(temp).isSymbolicLink(), false);
  assert.equal(path.dirname(real).toLowerCase(), realpathSync(os.tmpdir()).toLowerCase());
  assert.match(path.basename(real), /^stratemark-preflight-proof-/);
  rmSync(real, { recursive: true, force: true });
}
