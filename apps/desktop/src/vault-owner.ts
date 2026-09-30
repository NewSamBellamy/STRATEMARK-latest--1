/** Local SQLite guard, not a network lease, process-ID file or clock-based timeout. */
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type * as NodeSqlite from 'node:sqlite';

const { DatabaseSync } = createRequire(process.execPath)('node:sqlite') as typeof NodeSqlite;
const GUARD_APPLICATION_ID = 0x534d4f57;

function identity(file: string) {
  const stat = lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n)
    throw new Error('Vault path must be a regular file without symbolic or hard links.');
  return `${stat.dev}:${stat.ino}`;
}
export function canonicalVaultPath(file: string) {
  if (!path.isAbsolute(file)) throw new Error('Vault path must be an absolute local path.');
  const canonical = path.join(realpathSync(path.dirname(file)), path.basename(file));
  if (existsSync(canonical)) {
    identity(canonical);
    return realpathSync(canonical);
  }
  return canonical;
}

export function acquireVaultOwner(file: string) {
  const guardFile = `${file}.owner.sqlite`;
  const existed = existsSync(guardFile);
  if (existed) identity(guardFile);
  const guard = new DatabaseSync(guardFile, { defensive: true, allowExtension: false, timeout: 0 });
  let guardIdentity: string;
  try {
    guard.exec('PRAGMA trusted_schema=OFF; BEGIN IMMEDIATE;');
    const applicationId = guard.prepare('PRAGMA application_id').get()?.application_id;
    const version = guard.prepare('PRAGMA user_version').get()?.user_version;
    const tables = guard
      .prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")
      .get()?.count;
    if (applicationId === 0 && version === 0 && tables === 0) {
      guard.exec(`CREATE TABLE owner_guard(singleton INTEGER PRIMARY KEY CHECK(singleton=1)) STRICT;
        INSERT INTO owner_guard VALUES(1); PRAGMA application_id=${GUARD_APPLICATION_ID}; PRAGMA user_version=1;`);
    } else if (
      applicationId !== GUARD_APPLICATION_ID ||
      version !== 1 ||
      guard.prepare('SELECT singleton FROM owner_guard').get()?.singleton !== 1
    )
      throw new Error('Unrecognized vault owner guard. Original data was not changed.');
    guard.exec('COMMIT; BEGIN IMMEDIATE;');
    guardIdentity = identity(guardFile);
  } catch (error) {
    if (guard.isTransaction) guard.exec('ROLLBACK;');
    guard.close();
    if (typeof error === 'object' && error !== null && 'errcode' in error && error.errcode === 5)
      throw new Error('Vault is already owned by another writer.');
    throw error;
  }
  let closed = false;
  return {
    assertOwned() {
      if (closed || !guard.isTransaction) throw new Error('Vault owner guard is closed.');
      if (!existsSync(guardFile) || identity(guardFile) !== guardIdentity)
        throw new Error('Vault owner guard file identity changed.');
    },
    close() {
      if (!closed) {
        if (guard.isTransaction) guard.exec('ROLLBACK;');
        guard.close();
        closed = true;
      }
    },
  };
}

/** Remember the actual file, not merely its pathname; a replaced file is another vault instance. */
export function vaultFileFence(file: string) {
  const original = identity(file);
  return () => {
    if (!existsSync(file) || identity(file) !== original)
      throw new Error('Vault file path or identity changed. This writer is fenced.');
  };
}
