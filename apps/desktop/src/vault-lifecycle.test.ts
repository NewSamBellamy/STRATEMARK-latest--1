import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { legacyRetentionFixture } from './legacy-retention-fixture';
import { openAssetStore } from './vault-assets';
import {
  createStagedBackup,
  garbageCollectStagedAssets,
  restoreStagedBackup,
  verifyStagedBackup,
} from './vault-lifecycle';
import { openStagedVault } from './staged-vault-reader';
import { stageLegacySnapshot, verifyStagedCandidate } from './vault-staging';
import { openVault } from './vault';

const roots: string[] = [];
const at = '2026-10-01T18:00:00.000Z';

function root() {
  const directory = mkdtempSync(path.join(tmpdir(), 'stratemark-lifecycle-test-'));
  roots.push(directory);
  return directory;
}

function fixture(parent: string, vaultId = 'vault_lifecycle') {
  return stageLegacySnapshot(
    `${JSON.stringify(legacyRetentionFixture(2), null, 2)}\n`,
    parent,
    vaultId,
    at,
  );
}

function multiAssetFixture(parent: string) {
  const source = legacyRetentionFixture(2);
  source.reports[0]!.markdown = 'm'.repeat(8 * 1024 * 1024 + 32);
  return stageLegacySnapshot(JSON.stringify(source), parent, 'vault_multi_asset', at);
}

function sha256(file: string) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

afterEach(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('asset-aware staged vault lifecycle', () => {
  it('backs up every referenced asset and restores a damaged candidate into a new fenced generation', async () => {
    const workspace = root();
    const candidate = fixture(workspace);
    const backupParent = path.join(workspace, 'backups');
    const restoreParent = path.join(workspace, 'restores');
    const originalGeneration = openVault(
      path.join(candidate.directory, 'vault.sqlite'),
      candidate.manifest.vaultId,
      'reader',
    );
    const beforeGeneration = originalGeneration.status().writerGeneration;
    originalGeneration.close();

    const backup = await createStagedBackup(candidate.directory, backupParent, at);
    const verified = verifyStagedBackup(backup.directory);
    expect(verified).toEqual(backup);
    expect(path.dirname(backup.directory)).toBe(backupParent);
    expect(path.basename(backup.directory)).toMatch(/^stratemark-backup-/);
    expect(backup.backupHash).toMatch(/^[a-f0-9]{64}$/);
    expect(backup.manifest.assets).toEqual(candidate.manifest.originalSourceChunks);
    expect(backup.manifest.vaultRevision).toBe(candidate.manifest.vaultRevision);

    const backupFilesBefore = {
      database: sha256(path.join(backup.directory, 'vault.sqlite')),
      candidateManifest: sha256(path.join(backup.directory, 'manifest.json')),
      backupManifest: sha256(path.join(backup.directory, 'backup.json')),
    };
    unlinkSync(
      path.join(candidate.directory, 'assets', candidate.manifest.originalSourceChunks[0]!.sha256),
    );
    expect(() => verifyStagedCandidate(candidate.directory)).toThrow();

    const restored = await restoreStagedBackup(
      backup.directory,
      backup.backupHash,
      restoreParent,
      at,
    );
    expect(path.dirname(restored.directory)).toBe(restoreParent);
    expect(path.basename(restored.directory)).toMatch(/^stratemark-restored-/);
    expect(restored.backupHash).toBe(backup.backupHash);
    expect(verifyStagedCandidate(restored.directory)).toEqual(candidate.manifest);
    expect(verifyStagedBackup(backup.directory)).toEqual(backup);
    expect({
      database: sha256(path.join(backup.directory, 'vault.sqlite')),
      candidateManifest: sha256(path.join(backup.directory, 'manifest.json')),
      backupManifest: sha256(path.join(backup.directory, 'backup.json')),
    }).toEqual(backupFilesBefore);

    const restoredVault = openVault(
      path.join(restored.directory, 'vault.sqlite'),
      candidate.manifest.vaultId,
      'reader',
    );
    const restoredGeneration = restoredVault.status().writerGeneration;
    expect(typeof beforeGeneration).toBe('number');
    expect(typeof restoredGeneration).toBe('number');
    expect(Number(restoredGeneration)).toBeGreaterThan(Number(beforeGeneration));
    restoredVault.close();
    const app = openStagedVault(restored.directory);
    try {
      expect(app.listMarkets().items.map((market) => market.record.id)).toEqual(['mkt_a', 'mkt_b']);
      expect(app.status()).toMatchObject({ authority: 'disabled', canApply: false });
    } finally {
      app.close();
    }
  });

  it('rejects a swapped hash or damaged backup before creating a restore candidate', async () => {
    const workspace = root();
    const candidate = fixture(workspace, 'vault_restore_refusal');
    const backup = await createStagedBackup(
      candidate.directory,
      path.join(workspace, 'backups'),
      at,
    );
    const restoreParent = path.join(workspace, 'restores');

    await expect(
      restoreStagedBackup(backup.directory, '0'.repeat(64), restoreParent, at),
    ).rejects.toThrow(/backup/i);
    expect(existsSync(restoreParent) ? readdirSync(restoreParent) : []).toEqual([]);

    writeFileSync(path.join(backup.directory, 'vault.sqlite'), 'damaged backup');
    expect(() => verifyStagedBackup(backup.directory)).toThrow();
    await expect(
      restoreStagedBackup(backup.directory, backup.backupHash, restoreParent, at),
    ).rejects.toThrow(/backup/i);
    expect(existsSync(restoreParent) ? readdirSync(restoreParent) : []).toEqual([]);
  });

  it('copies and verifies every source chunk and refuses backup when one referenced chunk is missing', async () => {
    const workspace = root();
    const candidate = multiAssetFixture(workspace);
    expect(candidate.manifest.originalSourceChunks.length).toBeGreaterThan(1);
    const backup = await createStagedBackup(
      candidate.directory,
      path.join(workspace, 'backups'),
      at,
    );
    expect(verifyStagedBackup(backup.directory).manifest.assets).toEqual(
      candidate.manifest.originalSourceChunks,
    );

    unlinkSync(
      path.join(
        candidate.directory,
        'assets',
        candidate.manifest.originalSourceChunks.at(-1)!.sha256,
      ),
    );
    const refusedParent = path.join(workspace, 'refused-backups');
    await expect(createStagedBackup(candidate.directory, refusedParent, at)).rejects.toThrow(
      /backup/i,
    );
    expect(existsSync(refusedParent)).toBe(false);
  });

  it('never publishes an interrupted backup or mistakes it for a valid recovery point', async () => {
    const workspace = root();
    const candidate = fixture(workspace, 'vault_backup_interruption');
    const backupParent = path.join(workspace, 'backups');
    const phases: string[] = [];

    await expect(
      createStagedBackup(candidate.directory, backupParent, at, (progress) => {
        phases.push(progress.phase);
        if (progress.phase === 'assets_copied') throw new Error('synthetic interruption');
      }),
    ).rejects.toThrow(/backup/i);
    expect(phases).toEqual(['database_copied', 'assets_copied']);
    const entries = readdirSync(backupParent);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^\.stratemark-backup-partial-/);
    expect(existsSync(path.join(backupParent, entries[0]!, 'backup.json'))).toBe(false);
    expect(() => verifyStagedBackup(path.join(backupParent, entries[0]!))).toThrow();
    expect(verifyStagedCandidate(candidate.directory)).toEqual(candidate.manifest);
  });

  it('refuses a source candidate that changes after backup begins', async () => {
    const workspace = root();
    const candidate = fixture(workspace, 'vault_backup_source_race');
    const backupParent = path.join(workspace, 'backups');

    await expect(
      createStagedBackup(candidate.directory, backupParent, at, (progress) => {
        if (progress.phase !== 'assets_copied') return;
        writeFileSync(
          path.join(candidate.directory, 'manifest.json'),
          JSON.stringify({ ...candidate.manifest, warnings: [] }),
        );
      }),
    ).rejects.toThrow(/backup/i);
    expect(readdirSync(backupParent).every((name) => name.startsWith('.'))).toBe(true);
  });

  it('never publishes an interrupted restore and leaves its verified backup reusable', async () => {
    const workspace = root();
    const candidate = fixture(workspace, 'vault_restore_interruption');
    const backup = await createStagedBackup(
      candidate.directory,
      path.join(workspace, 'backups'),
      at,
    );
    const restoreParent = path.join(workspace, 'restores');
    const phases: string[] = [];

    await expect(
      restoreStagedBackup(backup.directory, backup.backupHash, restoreParent, at, (progress) => {
        phases.push(progress.phase);
        if (progress.phase === 'assets_copied') throw new Error('synthetic restore interruption');
      }),
    ).rejects.toThrow(/restore/i);
    expect(phases).toEqual(['database_copied', 'assets_copied']);
    const entries = readdirSync(restoreParent);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^\.stratemark-restore-partial-/);
    expect(existsSync(path.join(restoreParent, entries[0]!, 'manifest.json'))).toBe(false);
    expect(() => verifyStagedCandidate(path.join(restoreParent, entries[0]!))).toThrow();
    expect(verifyStagedBackup(backup.directory)).toEqual(backup);

    const retried = await restoreStagedBackup(
      backup.directory,
      backup.backupHash,
      restoreParent,
      at,
    );
    expect(verifyStagedCandidate(retried.directory)).toEqual(candidate.manifest);
  });

  it('revalidates the approved backup immediately before restore publication', async () => {
    const workspace = root();
    const candidate = fixture(workspace, 'vault_restore_source_race');
    const backup = await createStagedBackup(
      candidate.directory,
      path.join(workspace, 'backups'),
      at,
    );
    const restoreParent = path.join(workspace, 'restores');

    await expect(
      restoreStagedBackup(backup.directory, backup.backupHash, restoreParent, at, (progress) => {
        if (progress.phase !== 'assets_copied') return;
        writeFileSync(
          path.join(backup.directory, 'manifest.json'),
          JSON.stringify({ ...candidate.manifest, warnings: [] }),
        );
      }),
    ).rejects.toThrow(/restore/i);
    expect(readdirSync(restoreParent).every((name) => name.startsWith('.'))).toBe(true);
  });

  it('removes only verified unreferenced managed assets while retained data and backups survive', async () => {
    const workspace = root();
    const candidate = fixture(workspace, 'vault_asset_gc');
    const backup = await createStagedBackup(
      candidate.directory,
      path.join(workspace, 'backups'),
      at,
    );
    const assetRoot = path.join(candidate.directory, 'assets');
    const store = openAssetStore(assetRoot, () => {});
    const orphan = store.publish(Buffer.from('verified but unreferenced local asset'));
    writeFileSync(path.join(assetRoot, '.keep-unmanaged'), 'not managed by the asset store');

    const receipt = garbageCollectStagedAssets(candidate.directory);
    expect(receipt).toEqual({
      retainedAssets: candidate.manifest.originalSourceChunks.length,
      removedAssets: 1,
      removedBytes: orphan.byteLength,
    });
    expect(existsSync(path.join(assetRoot, orphan.sha256))).toBe(false);
    expect(existsSync(path.join(assetRoot, '.keep-unmanaged'))).toBe(true);
    expect(verifyStagedCandidate(candidate.directory)).toEqual(candidate.manifest);
    expect(verifyStagedBackup(backup.directory)).toEqual(backup);
    expect(garbageCollectStagedAssets(candidate.directory)).toEqual({
      retainedAssets: candidate.manifest.originalSourceChunks.length,
      removedAssets: 0,
      removedBytes: 0,
    });
  });
});
