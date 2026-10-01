/** Actual Electron app/IPC/native-vault journey. Synthetic data; no providers or install. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const webRequire = createRequire(path.join(root, 'apps/web/package.json'));
const { _electron: electron, expect } = webRequire('@playwright/test');
const args = process.argv.slice(2);
function option(name) {
  const i = args.indexOf(name);
  assert.ok(i >= 0 && args[i + 1] && !args[i + 1].startsWith('--'), `missing ${name}`);
  return path.resolve(args[i + 1]);
}
const executable = option('--electron');
const moduleFile = option('--module');
const appDir = args.includes('--app') ? option('--app') : null;
const screenshotDir = args.includes('--screenshots') ? option('--screenshots') : null;
if (screenshotDir) assert.equal(lstatSync(screenshotDir).isDirectory(), true);
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
const temp = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'stratemark-ui-proof-'));
function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
function stagedFingerprint(directory, includeBackup = false) {
  const manifestFile = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  return {
    database: digest(path.join(directory, 'vault.sqlite')),
    manifest: digest(manifestFile),
    assets: manifest.originalSourceChunks.map((ref) => ({
      ...ref,
      verifiedSha256: digest(path.join(directory, 'assets', ref.sha256)),
    })),
    ...(includeBackup ? { backup: digest(path.join(directory, 'backup.json')) } : {}),
  };
}
let application;
let preparer;
try {
  const generated = await new Promise((resolve, reject) => {
    preparer = spawn(executable, [moduleFile, '--sqlite-spike-worker', 'prepare-preview', temp], {
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      preparer.kill();
      reject(new Error('Synthetic preview preparation timed out.'));
    }, 30000);
    preparer.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    preparer.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    preparer.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    preparer.once('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Synthetic preview preparation failed (${code}). ${stderr}`));
        return;
      }
      const lines = stdout
        .split(/\r?\n/)
        .filter((line) => line.startsWith('SQLITE_PREVIEW_READY '));
      if (lines.length !== 1) {
        reject(new Error('Missing synthetic preview receipt.'));
        return;
      }
      resolve(JSON.parse(lines[0].slice('SQLITE_PREVIEW_READY '.length)));
    });
  });
  assert.equal(path.dirname(generated.directory), temp);
  assert.match(path.basename(generated.directory), /^stratemark-restored-/);
  assert.equal(path.dirname(generated.sourceDirectory), temp);
  assert.match(path.basename(generated.sourceDirectory), /^stratemark-stage-/);
  assert.equal(path.dirname(generated.backupDirectory), temp);
  assert.match(path.basename(generated.backupDirectory), /^stratemark-backup-/);
  assert.match(generated.backupHash, /^[a-f0-9]{64}$/);
  assert.equal(generated.lifecycleRestored, true);
  assert.equal(generated.sourceCandidatePreservedByLifecycle, true);
  assert.equal(generated.backupPreservedByRestore, true);
  const sourceBefore = stagedFingerprint(generated.sourceDirectory);
  const backupBefore = stagedFingerprint(generated.backupDirectory, true);
  const restoredBefore = stagedFingerprint(generated.directory);
  application = await electron.launch({
    executablePath: executable,
    args: [
      ...(appDir ? [appDir] : []),
      `--staged-vault-dir=${generated.directory}`,
      '--staged-preview-hidden',
    ],
    env,
    timeout: 30000,
  });
  const page = await application.firstWindow({ timeout: 30000 });
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const externalRequests = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) externalRequests.push(request.url());
  });
  async function screenshot(name) {
    if (!screenshotDir) return;
    let png;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        png = await application.evaluate(async ({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];
          const image = await window.webContents.capturePage(undefined, {
            stayHidden: true,
            stayAwake: true,
          });
          return image.toPNG().toString('base64');
        });
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        await page.waitForTimeout(250);
      }
    }
    writeFileSync(path.join(screenshotDir, `${name}.png`), Buffer.from(png, 'base64'));
  }
  await expect(page.getByText('Read-only migration preview', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open Synthetic Market a', exact: true }),
  ).toBeVisible();
  await screenshot('library');
  await page.getByRole('button', { name: 'Open Synthetic Market a', exact: true }).click();
  await expect(page.getByTestId('role-nav')).toBeVisible();
  await page
    .getByTestId('role-nav')
    .getByRole('button', { name: /distribution/i })
    .click();
  const identity = page.getByRole('button', { name: /Synthetic Fixture Labs/ });
  await expect(
    page.getByTestId('role-nav').getByRole('button', { name: /distribution/i }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(identity).toHaveCount(1);
  await screenshot('deck');
  await identity.click();
  const reader = page.getByRole('dialog');
  await expect(reader).toBeVisible();
  await expect(reader.getByText(/legacy research has not been reviewed/i)).toBeVisible();
  await reader.getByRole('link', { name: /explore research/i }).click();
  await expect(reader).toBeHidden();
  await expect(page.getByRole('button', { name: 'Back to card', exact: true })).toBeVisible();
  await screenshot('company');
  const metrics = page.getByRole('link', { name: 'Metrics', exact: true });
  await metrics.click();
  await expect(page.getByRole('button', { name: 'Back to card', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to card', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByText('Read-only migration preview', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Synthetic Fixture Labs/ })).toHaveCount(1);
  const results = await page.evaluate(async () => {
    const api = window.mi;
    const secure = window.miSecure;
    const denied = async (operation) => {
      try {
        await operation();
        return false;
      } catch {
        return true;
      }
    };
    return {
      mode: api.storageMode,
      forceDenied: await denied(() => api.getDashboardTab('co_shared', 'overview', true)),
      researchDenied: await denied(() => api.refreshDeck('mkt_a')),
      editDenied: await denied(() => api.saveCard('card_0')),
      keyDenied: await denied(() => secure.getApiKey()),
      importDenied: await denied(() => secure.importResearch('{}')),
      jobs: await api.listResearchJobs(),
      metrics: await api.getCompanyMetrics('co_shared'),
    };
  });
  assert.deepEqual(results, {
    mode: 'staged_readonly',
    forceDenied: true,
    researchDenied: true,
    editDenied: true,
    keyDenied: true,
    importDenied: true,
    jobs: [],
    metrics: [],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  await application.close();
  application = null;
  assert.deepEqual(stagedFingerprint(generated.sourceDirectory), sourceBefore);
  assert.deepEqual(stagedFingerprint(generated.backupDirectory, true), backupBefore);
  assert.deepEqual(stagedFingerprint(generated.directory), restoredBefore);
  assert.equal(existsSync(path.join(generated.directory, 'repo.json')), false);
  console.log(
    JSON.stringify({
      journey: 'library-deck-reader-company-metrics-back-reload',
      nativeIPC: true,
      readOnlyDenials: true,
      noActiveJobsOrPromotedMetrics: true,
      assetAwareBackupRestore: true,
      originalCandidateUnchanged: true,
      backupUnchanged: true,
      restoredCandidateUnchanged: true,
      pageErrors: 0,
      externalRequests: 0,
      screenshots: screenshotDir,
    }),
  );
} finally {
  if (application) await application.close();
  if (preparer && preparer.exitCode === null && preparer.signalCode === null) preparer.kill();
  const real = realpathSync(temp);
  assert.equal(lstatSync(temp).isSymbolicLink(), false);
  assert.equal(path.dirname(real).toLowerCase(), realpathSync(os.tmpdir()).toLowerCase());
  assert.match(path.basename(real), /^stratemark-ui-proof-/);
  rmSync(real, { recursive: true, force: true });
}
