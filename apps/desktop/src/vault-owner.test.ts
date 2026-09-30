import { linkSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openVault } from './vault';
import { vaultFileFence } from './vault-owner';
import { createRequire } from 'node:module';
import type * as NodeSqlite from 'node:sqlite';
import { createHash } from 'node:crypto';
const { DatabaseSync } = createRequire(process.execPath)('node:sqlite') as typeof NodeSqlite;

const directories: string[] = [];
const handles: ReturnType<typeof openVault>[] = [];
const at = '2026-09-30T12:00:00Z';
const company = (revision = 1) => ({
  record: {
    contractVersion: '1' as const,
    vaultId: 'vault_test',
    id: 'co_a',
    revision,
    createdAt: at,
    updatedAt: at,
  },
  name: 'Fixture Labs',
  officialDomain: 'a.example',
});
function location() {
  const directory = mkdtempSync(path.join(tmpdir(), 'stratemark-owner-test-'));
  directories.push(directory);
  return path.join(directory, 'vault.sqlite');
}
function open(file: string, mode: 'owner' | 'reader' = 'owner') {
  const vault = openVault(file, 'vault_test', mode);
  handles.push(vault);
  return vault;
}
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe('one native vault owner and captured writer generations', () => {
  it('refuses a second writer while keeping committed research readable', () => {
    const file = location();
    const owner = open(file);
    owner.writer().saveCompany(company(), 0);
    expect(() => open(file)).toThrow(/owner|owned/i);
    const reader = open(file, 'reader');
    expect(reader.getCompany('co_a')).toEqual(company());
    expect(reader.status()).toMatchObject({ mode: 'reader', writerGeneration: 1 });
    expect(() => reader.writer()).toThrow(/read-only/i);
    expect(() => reader.advanceWriterGeneration()).toThrow(/read-only/i);
  });
  it('hands off only after close, advances generation, and fences captured old writers', () => {
    const file = location();
    const first = open(file);
    const oldWriter = first.writer();
    oldWriter.saveCompany(company(), 0);
    first.close();
    const next = open(file);
    expect(next.status().writerGeneration).toBe(2);
    expect(() => oldWriter.saveCompany(company(2), 1)).toThrow(/closed|owner|fenc/i);
    next.writer().saveCompany({ ...company(2), name: 'New owner' }, 1);
    expect(next.getCompany('co_a')?.name).toBe('New owner');
  });
  it('fences every earlier writer capability before a cutover preparation', () => {
    const vault = open(location());
    const oldWriter = vault.writer();
    oldWriter.saveCompany(company(), 0);
    const contentRevision = vault.status().revision;
    vault.advanceWriterGeneration();
    expect(vault.status()).toMatchObject({ writerGeneration: 2, revision: contentRevision });
    expect(() => oldWriter.saveCompany(company(2), 1)).toThrow(/generation|fenc/i);
    const text = 'Synthetic retained evidence.';
    expect(() =>
      oldWriter.saveSourceVersion(
        {
          ...company().record,
          id: 'src_a',
          canonicalUrl: null,
          originalUrl: null,
          contentHash: createHash('sha256').update(text).digest('hex'),
          fetchedAt: at,
          publishedAt: null,
          eventAt: null,
          retrievalStatus: 'retrieved',
          origin: 'user_provided',
          visibilityScope: { companyIds: ['co_a'], marketIds: [] },
        },
        text,
        0,
      ),
    ).toThrow(/generation|fenc/i);
    vault.writer().saveCompany({ ...company(2), name: 'Current generation' }, 1);
    expect(vault.getCompany('co_a')?.name).toBe('Current generation');
  });
  it('does not advance writer generations when opening an ordinary reader', () => {
    const file = location();
    const owner = open(file);
    const writer = owner.writer();
    for (let count = 0; count < 3; count++) open(file, 'reader').close();
    expect(owner.status().writerGeneration).toBe(1);
    writer.saveCompany(company(), 0);
  });
  it('refuses reader creation and reader-side upgrades without modifying data', () => {
    const absent = location();
    expect(() => open(absent, 'reader')).toThrow(/exist|read-only/i);
    const file = location();
    open(file).close();
    const before = readFileSync(file);
    const reader = open(file, 'reader');
    reader.close();
    expect(readFileSync(file)).toEqual(before);
  });
  it('refuses a hard-linked alias instead of allowing independent guard files', () => {
    const file = location();
    const owner = open(file);
    owner.writer().saveCompany(company(), 0);
    const alias = path.join(path.dirname(file), 'alias.sqlite');
    linkSync(file, alias);
    expect(() => open(alias)).toThrow(/link|path/i);
    expect(() => owner.writer().saveCompany(company(2), 1)).toThrow(/link|path|identity/i);
  });
  it('fences writes when the backing file is moved or replaced, not merely renamed in memory', () => {
    const file = location();
    const owner = open(file);
    const writer = owner.writer();
    writer.saveCompany(company(), 0);
    const destination = path.join(path.dirname(file), 'moved.sqlite');
    if (process.platform === 'win32') {
      // Native Windows SQLite handles forbid moving the live file before the fence is needed.
      expect(() => renameSync(file, destination)).toThrow(
        expect.objectContaining({ code: 'EBUSY' }),
      );
      expect(owner.getCompany('co_a')).toEqual(company());
    } else {
      renameSync(file, destination);
      expect(() => writer.saveCompany(company(2), 1)).toThrow(/path|file|identity/i);
    }
  });
  it('the file-identity guard refuses a moved file independently of OS rename protection', () => {
    const file = location();
    open(file).close();
    const check = vaultFileFence(file);
    renameSync(file, path.join(path.dirname(file), 'moved.sqlite'));
    expect(check).toThrow(/path|identity/i);
  });
  it('closed owners do not leak a guard that prevents reopening', () => {
    const file = location();
    const first = open(file);
    first.close();
    first.close();
    const second = open(file);
    second.writer().saveCompany(company(), 0);
    second.close();
    expect(open(file).status().writerGeneration).toBe(3);
  });
  it('never regains writer authority after a stored owner nonce changes, even if old metadata reappears', () => {
    const file = location();
    const vault = open(file);
    const writer = vault.writer();
    const db = new DatabaseSync(file);
    try {
      const original = db.prepare('SELECT owner_nonce FROM writer_state WHERE singleton=1').get()!
        .owner_nonce;
      if (typeof original !== 'string')
        throw new Error('Expected an active synthetic owner nonce.');
      db.prepare('UPDATE writer_state SET owner_nonce=? WHERE singleton=1').run(
        '00000000-0000-0000-0000-000000000000',
      );
      expect(() => writer.saveCompany(company(), 0)).toThrow(/fenc|owner/i);
      db.prepare('UPDATE writer_state SET owner_nonce=? WHERE singleton=1').run(original);
      expect(() => writer.saveCompany(company(), 0)).toThrow(/fenc|owner/i);
      expect(() => vault.writer()).toThrow(/fenc|owner/i);
      expect(vault.getCompany('co_a')).toBeNull();
    } finally {
      db.close();
    }
  });
  it('does not rewrite an unrelated guard database or leak ownership on a failed initialization', () => {
    const file = location();
    const guardFile = `${file}.owner.sqlite`;
    const unrelated = new DatabaseSync(guardFile);
    unrelated.exec('CREATE TABLE unrelated(value TEXT);');
    unrelated.close();
    const before = createHash('sha256').update(readFileSync(guardFile)).digest('hex');
    expect(() => open(file)).toThrow(/unrecognized/i);
    expect(createHash('sha256').update(readFileSync(guardFile)).digest('hex')).toBe(before);
    const db = new DatabaseSync(guardFile, { timeout: 0 });
    try {
      expect(() => db.exec('BEGIN IMMEDIATE; ROLLBACK;')).not.toThrow();
    } finally {
      db.close();
    }
  });
});
