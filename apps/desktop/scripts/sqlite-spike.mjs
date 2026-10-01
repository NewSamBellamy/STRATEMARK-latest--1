import assert from 'node:assert/strict';
import { lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--'))
    throw new Error(`required option: ${name} <path>`);
  return args[index + 1];
}

const electron = path.resolve(option('--electron'));
const modulePath = option('--module');
assert.equal(lstatSync(electron).isFile(), true, 'Electron executable must be a file');

function start(mode, directory) {
  const child = spawn(electron, [modulePath, '--sqlite-spike-worker', mode, directory], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  let pending = '';
  const lines = [];
  const waiters = [];
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
    pending += chunk;
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end).replace(/\r$/, '');
      pending = pending.slice(end + 1);
      lines.push(line);
      for (const waiter of [...waiters]) if (line.startsWith(waiter.prefix)) waiter.resolve(line);
    }
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr += chunk;
  });
  const closed = new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const waitForLine = (prefix, timeoutMs = 30000) => {
    const existing = lines.find((line) => line.startsWith(prefix));
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {
        prefix,
        resolve: (line) => {
          clearTimeout(timer);
          waiters.splice(waiters.indexOf(waiter), 1);
          resolve(line);
        },
      };
      const timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(new Error(`timed out waiting for ${prefix}`));
      }, timeoutMs);
      waiters.push(waiter);
      closed.then((result) => {
        if (waiters.includes(waiter)) {
          clearTimeout(timer);
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`worker exited before ${prefix}: ${JSON.stringify(result)}\n${stderr}`));
        }
      });
    });
  };
  const waitForClose = (timeoutMs = 30000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`worker did not exit\n${stderr}`));
      }, timeoutMs);
      closed.then((result) => {
        clearTimeout(timer);
        if (result.error) reject(result.error);
        else resolve(result);
      });
    });
  return {
    child,
    lines,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    waitForLine,
    waitForClose,
  };
}

function record(worker, prefix) {
  const matches = worker.lines.filter((line) => line.startsWith(`${prefix} `));
  assert.equal(
    matches.length,
    1,
    `expected one ${prefix} marker\n${worker.stdout}\n${worker.stderr}`,
  );
  return JSON.parse(matches[0].slice(prefix.length + 1));
}

async function successWorker(mode, directory, phase) {
  const worker = start(mode, directory);
  const result = await worker.waitForClose();
  assert.equal(result.code, 0, `${mode} worker failed\n${worker.stdout}\n${worker.stderr}`);
  const data = record(worker, 'SQLITE_SPIKE_OK');
  assert.equal(data.phase, phase);
  return data;
}

const tempRoot = realpathSync(os.tmpdir());
const directory = mkdtempSync(path.join(tempRoot, 'stratemark-sqlite-spike-'));
let crashWorker;
let stageCrashWorker;
let summary;
try {
  const prepared = await successWorker('prepare', directory, 'prepare');
  for (const key of ['electron', 'node', 'sqlite'])
    assert.match(prepared.versions[key], /^\d+\.\d+\.\d+/);
  assert.equal(
    prepared.engine?.version,
    prepared.versions.sqlite,
    'SQL engine version must match the embedded runtime',
  );
  assert.match(
    prepared.engine?.sourceId ?? '',
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [a-f0-9]{64}$/,
  );
  assert.deepEqual(prepared.nativeVault, {
    twoMarketSharedIdentity: true,
    retainedHistory: true,
    staleWriteRejected: true,
    pagedSearch: true,
    backupReopened: true,
    versionOneUpgrade: true,
    retainedEvidenceBackup: true,
    periodAndZeroRetained: true,
    falseHashRejected: true,
    oldCapabilityFenced: true,
    ownerGenerationAdvanced: true,
    retainedResearchVersions: true,
    historicalReportInputs: true,
    privateResearchRejected: true,
  });
  assert.deepEqual(prepared.legacyInspection, {
    allKnownFormats: true,
    exactOriginalRetained: true,
    historyNotResumed: true,
    attributionNotAuthority: true,
    sharedMembershipsPreserved: true,
    duplicateAndFutureRejected: true,
  });
  assert.deepEqual(prepared.inventoryContext, {
    v4UpgradeRetained: true,
    companyProfileAndHints: true,
    mixedIdentitySearch: true,
    scopeAndSeedsRetained: true,
    seedForeignKeysAndHistory: true,
    contextBackupReopened: true,
    assetsPublishedAndVerified: true,
    assetLateWriteRejected: true,
    corruptAssetRefused: true,
  });
  assert.deepEqual(prepared.legacyRetention, {
    allFamiliesRetained: true,
    rawNestedHistory: true,
    minimalJobOmissions: true,
    attributionNotAuthority: true,
    idempotentSource: true,
    oldCapabilityFenced: true,
    consistentBackupReopened: true,
    closedVaultReopened: true,
  });
  assert.deepEqual(prepared.stagedNavigation, {
    allKnownFormats: true,
    exactOriginalAssets: true,
    originalFileUntouched: true,
    sharedCompanyNavigation: true,
    noUnsupportedMetrics: true,
    incompleteCandidateRefused: true,
    originalHistoryRetainedAfterInterruption: true,
  });
  for (const key of ['fts5Match', 'walReopen', 'backupFromOpenWal', 'backupReopen'])
    assert.equal(prepared[key], true);
  assert.deepEqual(prepared.backupValues, {
    committed: 'survives-crash',
    walSnapshot: 'captured-while-open',
  });

  crashWorker = start('crash', directory);
  const ready = JSON.parse(
    (await crashWorker.waitForLine('SQLITE_SPIKE_CRASH_READY ')).slice(
      'SQLITE_SPIKE_CRASH_READY '.length,
    ),
  );
  assert.equal(
    ready.pid,
    crashWorker.child.pid,
    'only the expected crash worker may be terminated',
  );
  assert.equal(path.resolve(ready.databasePath), path.join(directory, 'source.sqlite'));
  assert.equal(path.resolve(ready.ownedDatabasePath), path.join(directory, 'owned.sqlite'));
  assert.equal(ready.writerGeneration, 1);
  assert.ok(ready.walBytes > 32 && ready.pendingRows > 0);
  const contention = await successWorker('contend', directory, 'contend');
  assert.equal(contention.secondOwnerRejected, true);
  assert.equal(contention.committedReaderWorked, true);
  assert.equal(
    crashWorker.child.kill('SIGKILL'),
    true,
    'failed to force-terminate the transaction worker',
  );
  const crashExit = await crashWorker.waitForClose();
  assert.equal(
    crashWorker.lines.some((line) => line.startsWith('SQLITE_SPIKE_CRASH_DONE ')),
    false,
  );

  const recovered = await successWorker('recover', directory, 'recover');
  assert.equal(recovered.committedSurvived, true);
  assert.equal(recovered.uncommittedAbsent, true);
  assert.equal(recovered.integrityCheck, 'ok');
  assert.equal(recovered.crashedOwnerReplaced, true);
  assert.equal(recovered.replacementGeneration, 2);
  stageCrashWorker = start('stage-crash', directory);
  const stageReady = JSON.parse(
    (await stageCrashWorker.waitForLine('SQLITE_STAGE_CRASH_READY ')).slice(
      'SQLITE_STAGE_CRASH_READY '.length,
    ),
  );
  assert.equal(stageReady.pid, stageCrashWorker.child.pid);
  assert.equal(path.dirname(stageReady.directory), directory);
  assert.match(path.basename(stageReady.directory), /^stratemark-stage-/);
  assert.match(stageReady.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(stageCrashWorker.child.kill('SIGKILL'), true);
  const stageCrashExit = await stageCrashWorker.waitForClose();
  const stageRecovery = await successWorker('stage-recover', directory, 'stage-recover');
  assert.deepEqual(stageRecovery, {
    phase: 'stage-recover',
    originalUntouched: true,
    originalAssetsRetained: true,
    passiveHistoryRetained: true,
    incompleteCandidateRefused: true,
    noInventoryApproved: true,
    replacementGeneration: 2,
  });
  summary = {
    ...prepared,
    contention,
    crash: {
      forced: true,
      exitCode: crashExit.code,
      signal: crashExit.signal,
      uncommittedWalBytes: ready.walBytes,
    },
    recovery: recovered,
    stageCrash: { forced: true, exitCode: stageCrashExit.code, signal: stageCrashExit.signal },
    stageRecovery,
  };
} finally {
  if (crashWorker && crashWorker.child.exitCode === null && crashWorker.child.signalCode === null)
    crashWorker.child.kill();
  if (
    stageCrashWorker &&
    stageCrashWorker.child.exitCode === null &&
    stageCrashWorker.child.signalCode === null
  )
    stageCrashWorker.child.kill();
  const realDirectory = realpathSync(directory);
  const expectedParent = realpathSync(os.tmpdir());
  assert.equal(lstatSync(directory).isSymbolicLink(), false);
  assert.equal(path.dirname(realDirectory).toLowerCase(), expectedParent.toLowerCase());
  assert.match(path.basename(realDirectory), /^stratemark-sqlite-spike-/);
  rmSync(realDirectory, { recursive: true, force: true });
}
console.log(`SQLITE_SPIKE_SUCCESS ${JSON.stringify(summary)}`);
