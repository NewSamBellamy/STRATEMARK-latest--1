/** Asset-aware lifecycle for verified staged candidates. No live cutover authority. */
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { openAssetStore, type AssetRef } from './vault-assets';
import { openVault } from './vault';
import { verifyStagedCandidate, type StageManifest } from './vault-staging';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const assetSchema = z
  .object({
    sha256: hashSchema,
    byteLength: z
      .number()
      .int()
      .min(0)
      .max(8 * 1024 * 1024),
  })
  .strict();
const fileSchema = z
  .object({
    sha256: hashSchema,
    byteLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const backupManifestSchema = z
  .object({
    format: z.literal('stratemark-backup-v1'),
    createdAt: z.string().datetime(),
    vaultId: z.string().min(1).max(200),
    schemaVersion: z.number().int().positive(),
    vaultRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    authority: z.literal('disabled'),
    candidateManifest: fileSchema,
    database: fileSchema,
    assets: z.array(assetSchema).min(1).max(200_000),
  })
  .strict();

export type StagedBackupManifest = z.infer<typeof backupManifestSchema>;
export type StagedBackupReceipt = {
  directory: string;
  backupHash: string;
  manifest: StagedBackupManifest;
};
export type BackupProgress = {
  phase: 'database_copied' | 'assets_copied' | 'verified' | 'published';
  directory: string;
};
export type RestoreProgress = {
  phase: 'database_copied' | 'assets_copied' | 'generation_fenced' | 'verified' | 'published';
  directory: string;
};

export class VaultLifecycleError extends Error {
  constructor(
    message: string,
    readonly directory: string | null,
  ) {
    super(message);
    this.name = 'VaultLifecycleError';
  }
}

function samePath(left: string, right: string) {
  const normalize = (value: string) => {
    const result = path.normalize(value);
    return process.platform === 'win32' ? result.toLowerCase() : result;
  };
  return normalize(left) === normalize(right);
}

function localDirectory(directory: string) {
  if (!path.isAbsolute(directory) || directory.startsWith('\\\\'))
    throw new Error('Lifecycle storage must use an absolute local directory.');
  const stat = lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('Lifecycle storage directory is invalid.');
  const actual = realpathSync.native(directory);
  if (actual.startsWith('\\\\')) throw new Error('Network lifecycle storage is unsupported.');
  const expected = path.join(
    realpathSync.native(path.dirname(directory)),
    path.basename(directory),
  );
  if (!samePath(actual, expected)) throw new Error('Lifecycle storage directory was redirected.');
  return { actual, dev: stat.dev, ino: stat.ino };
}

function ensureParent(directory: string) {
  if (!path.isAbsolute(directory) || directory.startsWith('\\\\'))
    throw new Error('Lifecycle destination must be an absolute local directory.');
  if (!existsSync(directory)) {
    const parent = localDirectory(path.dirname(directory));
    mkdirSync(directory, { mode: 0o700 });
    const created = localDirectory(directory);
    if (!samePath(path.dirname(created.actual), parent.actual))
      throw new Error('Lifecycle destination parent changed.');
  }
  return localDirectory(directory);
}

function captureDirectory(directory: string) {
  const initial = localDirectory(directory);
  return () => {
    const current = localDirectory(directory);
    if (
      current.dev !== initial.dev ||
      current.ino !== initial.ino ||
      !samePath(current.actual, initial.actual)
    )
      throw new Error('Lifecycle storage directory was replaced.');
  };
}

function safeRead(file: string, maxBytes: number) {
  const before = lstatSync(file, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1n ||
    before.size < 1n ||
    before.size > BigInt(maxBytes)
  )
    throw new Error('Lifecycle manifest file is invalid.');
  const descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      throw new Error('Lifecycle manifest file changed.');
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      bytes.byteLength !== Number(opened.size)
    )
      throw new Error('Lifecycle manifest file changed.');
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function hashFile(file: string) {
  const before = lstatSync(file, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1n ||
    before.size < 1n ||
    before.size > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error('Lifecycle file is invalid.');
  const descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      throw new Error('Lifecycle file changed.');
    const digest = createHash('sha256');
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < Number(opened.size)) {
      const count = readSync(descriptor, chunk, 0, chunk.byteLength, position);
      if (count <= 0) throw new Error('Lifecycle file ended unexpectedly.');
      digest.update(chunk.subarray(0, count));
      position += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size)
      throw new Error('Lifecycle file changed.');
    return { sha256: digest.digest('hex'), byteLength: position };
  } finally {
    closeSync(descriptor);
  }
}

function manifestBytes(manifest: StagedBackupManifest) {
  return Buffer.from(JSON.stringify(backupManifestSchema.parse(manifest)), 'utf8');
}

function receipt(directory: string, manifest: StagedBackupManifest): StagedBackupReceipt {
  return {
    directory: realpathSync.native(directory),
    backupHash: createHash('sha256').update(manifestBytes(manifest)).digest('hex'),
    manifest,
  };
}

function copyAssets(sourceRoot: string, destinationRoot: string, refs: AssetRef[]) {
  const source = openAssetStore(sourceRoot, () => {
    throw new Error('Lifecycle source assets are read-only.');
  });
  const destination = openAssetStore(destinationRoot, () => {});
  for (const ref of refs) {
    const copied = destination.publish(source.read(ref));
    if (copied.sha256 !== ref.sha256 || copied.byteLength !== ref.byteLength)
      throw new Error('Lifecycle asset copy changed content.');
  }
}

function uniqueAssetNames(refs: AssetRef[]) {
  return [...new Set(refs.map((ref) => ref.sha256))].sort();
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function verifyStagedBackup(directory: string): StagedBackupReceipt {
  try {
    const root = localDirectory(directory);
    const assertRoot = captureDirectory(root.actual);
    const bytes = safeRead(path.join(root.actual, 'backup.json'), 256 * 1024);
    if (!Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes))
      throw new Error('Backup manifest must be UTF-8.');
    const manifest = backupManifestSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (
      JSON.stringify(manifest) !== JSON.stringify(JSON.parse(bytes.toString('utf8'))) ||
      JSON.stringify(hashFile(path.join(root.actual, 'manifest.json'))) !==
        JSON.stringify(manifest.candidateManifest) ||
      JSON.stringify(hashFile(path.join(root.actual, 'vault.sqlite'))) !==
        JSON.stringify(manifest.database)
    )
      throw new Error('Backup files do not match their manifest.');
    const candidate = verifyStagedCandidate(root.actual);
    if (
      candidate.vaultId !== manifest.vaultId ||
      candidate.schemaVersion !== manifest.schemaVersion ||
      candidate.vaultRevision !== manifest.vaultRevision ||
      candidate.authority !== 'disabled' ||
      JSON.stringify(candidate.originalSourceChunks) !== JSON.stringify(manifest.assets)
    )
      throw new Error('Backup candidate does not match its manifest.');
    const assetDirectory = path.join(root.actual, 'assets');
    const expected = uniqueAssetNames(manifest.assets);
    const actual = readdirSync(assetDirectory).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error('Backup asset set does not match its manifest.');
    const assets = openAssetStore(assetDirectory, () => {
      throw new Error('Backup verification is read-only.');
    });
    for (const ref of manifest.assets) assets.verify(ref);
    assertRoot();
    return receipt(root.actual, manifest);
  } catch (error) {
    if (error instanceof VaultLifecycleError) throw error;
    throw new VaultLifecycleError('Backup verification failed.', null);
  }
}

export async function createStagedBackup(
  candidateDirectory: string,
  backupParent: string,
  createdAt = new Date().toISOString(),
  onProgress?: (progress: BackupProgress) => void,
): Promise<StagedBackupReceipt> {
  let partial: string | null = null;
  try {
    z.string().datetime().parse(createdAt);
    if (onProgress !== undefined && typeof onProgress !== 'function')
      throw new Error('Invalid backup progress callback.');
    const candidate = verifyStagedCandidate(candidateDirectory);
    const sourceManifestFile = hashFile(path.join(candidateDirectory, 'manifest.json'));
    const parent = ensureParent(backupParent);
    const assertParent = captureDirectory(parent.actual);
    partial = mkdtempSync(path.join(parent.actual, '.stratemark-backup-partial-'));
    const assertPartial = captureDirectory(partial);
    const progress = (phase: BackupProgress['phase']) => {
      assertParent();
      assertPartial();
      onProgress?.({ phase, directory: partial! });
      assertParent();
      assertPartial();
    };
    const sourceVault = openVault(
      path.join(candidateDirectory, 'vault.sqlite'),
      candidate.vaultId,
      'reader',
    );
    try {
      if (sourceVault.status().revision !== candidate.vaultRevision)
        throw new Error('Candidate changed before backup.');
      await sourceVault.backup(path.join(partial, 'vault.sqlite'));
      if (sourceVault.status().revision !== candidate.vaultRevision)
        throw new Error('Candidate changed during backup.');
    } finally {
      sourceVault.close();
    }
    progress('database_copied');
    copyAssets(
      path.join(candidateDirectory, 'assets'),
      path.join(partial, 'assets'),
      candidate.originalSourceChunks,
    );
    progress('assets_copied');
    const currentCandidate = verifyStagedCandidate(candidateDirectory);
    if (
      !sameJson(currentCandidate, candidate) ||
      !sameJson(hashFile(path.join(candidateDirectory, 'manifest.json')), sourceManifestFile)
    )
      throw new Error('Candidate changed during backup.');
    const candidateManifestBytes = safeRead(path.join(candidateDirectory, 'manifest.json'), 65_536);
    writeFileSync(path.join(partial, 'manifest.json'), candidateManifestBytes, {
      flag: 'wx',
      mode: 0o600,
      flush: true,
    });
    const manifest = backupManifestSchema.parse({
      format: 'stratemark-backup-v1',
      createdAt,
      vaultId: candidate.vaultId,
      schemaVersion: candidate.schemaVersion,
      vaultRevision: candidate.vaultRevision,
      authority: 'disabled',
      candidateManifest: hashFile(path.join(partial, 'manifest.json')),
      database: hashFile(path.join(partial, 'vault.sqlite')),
      assets: candidate.originalSourceChunks,
    });
    writeFileSync(path.join(partial, 'backup.json'), manifestBytes(manifest), {
      flag: 'wx',
      mode: 0o600,
      flush: true,
    });
    verifyStagedBackup(partial);
    progress('verified');
    const finalDirectory = path.join(
      parent.actual,
      `stratemark-backup-${randomBytes(12).toString('hex')}`,
    );
    assertParent();
    assertPartial();
    renameSync(partial, finalDirectory);
    partial = null;
    const result = verifyStagedBackup(finalDirectory);
    try {
      onProgress?.({ phase: 'published', directory: result.directory });
    } catch {
      // Publication already committed; an observer cannot turn success into a false failure.
    }
    return result;
  } catch {
    throw new VaultLifecycleError(
      'Backup creation failed. The candidate was not changed and no recovery point was published.',
      partial,
    );
  }
}

export async function restoreStagedBackup(
  backupDirectory: string,
  expectedBackupHash: string,
  restoreParent: string,
  restoredAt = new Date().toISOString(),
  onProgress?: (progress: RestoreProgress) => void,
) {
  let partial: string | null = null;
  try {
    z.string().datetime().parse(restoredAt);
    const backup = verifyStagedBackup(backupDirectory);
    if (
      !hashSchema.safeParse(expectedBackupHash).success ||
      backup.backupHash !== expectedBackupHash
    )
      throw new Error('Approved backup hash does not match.');
    const assertBackupCurrent = () => {
      const current = verifyStagedBackup(backupDirectory);
      if (current.backupHash !== expectedBackupHash || !sameJson(current.manifest, backup.manifest))
        throw new Error('Approved backup changed during restore.');
    };
    const parent = ensureParent(restoreParent);
    const assertParent = captureDirectory(parent.actual);
    partial = mkdtempSync(path.join(parent.actual, '.stratemark-restore-partial-'));
    const assertPartial = captureDirectory(partial);
    const progress = (phase: RestoreProgress['phase']) => {
      assertParent();
      assertPartial();
      onProgress?.({ phase, directory: partial! });
      assertParent();
      assertPartial();
    };
    const sourceVault = openVault(
      path.join(backup.directory, 'vault.sqlite'),
      backup.manifest.vaultId,
      'reader',
    );
    try {
      await sourceVault.backup(path.join(partial, 'vault.sqlite'));
    } finally {
      sourceVault.close();
    }
    progress('database_copied');
    copyAssets(
      path.join(backup.directory, 'assets'),
      path.join(partial, 'assets'),
      backup.manifest.assets,
    );
    progress('assets_copied');
    assertBackupCurrent();
    const candidateManifest = safeRead(path.join(backup.directory, 'manifest.json'), 65_536);
    writeFileSync(path.join(partial, 'manifest.json'), candidateManifest, {
      flag: 'wx',
      mode: 0o600,
      flush: true,
    });
    const owner = openVault(path.join(partial, 'vault.sqlite'), backup.manifest.vaultId, 'owner');
    const writerGeneration = owner.status().writerGeneration;
    owner.close();
    progress('generation_fenced');
    verifyStagedCandidate(partial);
    progress('verified');
    assertBackupCurrent();
    assertParent();
    assertPartial();
    const finalDirectory = path.join(
      parent.actual,
      `stratemark-restored-${randomBytes(12).toString('hex')}`,
    );
    renameSync(partial, finalDirectory);
    partial = null;
    const manifest: StageManifest = verifyStagedCandidate(finalDirectory);
    const result = {
      directory: realpathSync.native(finalDirectory),
      backupHash: backup.backupHash,
      restoredAt,
      writerGeneration,
      manifest,
    };
    try {
      onProgress?.({ phase: 'published', directory: result.directory });
    } catch {
      // Publication already committed; an observer cannot turn success into a false failure.
    }
    return result;
  } catch {
    throw new VaultLifecycleError(
      'Backup restore failed. The backup was not changed and no restored candidate was published.',
      partial,
    );
  }
}

export function garbageCollectStagedAssets(candidateDirectory: string) {
  const manifest = verifyStagedCandidate(candidateDirectory);
  const vault = openVault(path.join(candidateDirectory, 'vault.sqlite'), manifest.vaultId, 'owner');
  let result: { retainedAssets: number; removedAssets: number; removedBytes: number };
  try {
    const assertCurrent = vault.writer().assertCurrent;
    const assetRoot = path.join(candidateDirectory, 'assets');
    const assets = openAssetStore(assetRoot, assertCurrent);
    const retained = new Set(uniqueAssetNames(manifest.originalSourceChunks));
    for (const ref of manifest.originalSourceChunks) assets.verify(ref);
    let removedAssets = 0;
    let removedBytes = 0;
    for (const name of readdirSync(assetRoot).sort()) {
      if (!/^[a-f0-9]{64}$/.test(name) || retained.has(name)) continue;
      assertCurrent();
      const file = path.join(assetRoot, name);
      const before = lstatSync(file, { bigint: true });
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.nlink !== 1n ||
        before.size < 0n ||
        before.size > BigInt(8 * 1024 * 1024)
      )
        throw new VaultLifecycleError('Asset cleanup failed closed.', null);
      const ref = { sha256: name, byteLength: Number(before.size) };
      assets.verify(ref);
      assertCurrent();
      const after = lstatSync(file, { bigint: true });
      if (
        after.dev !== before.dev ||
        after.ino !== before.ino ||
        after.size !== before.size ||
        after.nlink !== 1n
      )
        throw new VaultLifecycleError('Asset cleanup failed closed.', null);
      unlinkSync(file);
      removedAssets += 1;
      removedBytes += ref.byteLength;
    }
    for (const ref of manifest.originalSourceChunks) assets.verify(ref);
    result = {
      retainedAssets: retained.size,
      removedAssets,
      removedBytes,
    };
  } finally {
    vault.close();
  }
  verifyStagedCandidate(candidateDirectory);
  return result;
}
