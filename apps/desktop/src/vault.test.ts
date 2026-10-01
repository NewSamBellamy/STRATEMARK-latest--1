import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type * as NodeSqlite from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openVault as openNativeVault } from './vault';

// Vite5 predates node:sqlite's builtin list; resolve through native Node, not Vite.
const { DatabaseSync } = createRequire(process.execPath)('node:sqlite') as typeof NodeSqlite;

const AT = '2026-09-30T12:00:00.000Z';
const directories: string[] = [];
const handles: ReturnType<typeof openNativeVault>[] = [];
function openVault(file: string, vaultId: string) {
  const handle = openNativeVault(file, vaultId);
  handles.push(handle);
  return { ...handle, ...handle.writer() };
}
function location() {
  const directory = mkdtempSync(path.join(tmpdir(), 'stratemark-vault-test-'));
  directories.push(directory);
  return path.join(directory, 'vault.sqlite');
}
function record(id: string, revision = 1, vaultId = 'vault_fixture') {
  return { contractVersion: '1' as const, vaultId, id, revision, createdAt: AT, updatedAt: AT };
}
function company(id = 'co_a', domain = 'a.example') {
  return { record: record(id), name: 'Fixture Labs', officialDomain: domain };
}
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe('offline native vault foundation (no product cutover)', () => {
  it('persists a company and its exact record version across close/reopen', () => {
    const file = location();
    let vault = openVault(file, 'vault_fixture');
    vault.saveCompany(company(), 0);
    expect(vault.status()).toMatchObject({ schemaVersion: 5, revision: 1 });
    vault.close();
    vault = openVault(file, 'vault_fixture');
    expect(vault.getCompany('co_a')).toEqual(company());
    expect(vault.integrity()).toBe('ok');
    vault.close();
  });

  it('uses IDs rather than names to keep distinct same-name companies', () => {
    const vault = openVault(location(), 'vault_fixture');
    vault.saveCompany(company('co_a', 'a.example'), 0);
    vault.saveCompany(company('co_b', 'b.example'), 0);
    expect(vault.searchCompanies('Fixture').items).toHaveLength(2);
    expect(vault.getCompany('co_a')?.officialDomain).toBe('a.example');
    vault.close();
  });

  it('one company can belong to two markets without duplicating its dossier', () => {
    const vault = openVault(location(), 'vault_fixture');
    vault.saveCompany(company(), 0);
    vault.saveMarket({ record: record('mkt_a'), name: 'Market A' }, 0);
    vault.saveMarket({ record: record('mkt_b'), name: 'Market B' }, 0);
    for (const marketId of ['mkt_a', 'mkt_b'])
      vault.saveMembership(
        { record: record(`mem_${marketId}`), marketId, companyId: 'co_a', roles: ['company'] },
        0,
      );
    expect(vault.listMarketCompanies('mkt_a').items).toEqual([company()]);
    expect(vault.listMarketCompanies('mkt_b').items).toEqual([company()]);
    vault.close();
  });

  it('rejects a dangling membership and rolls back the vault revision', () => {
    const vault = openVault(location(), 'vault_fixture');
    expect(() =>
      vault.saveMembership(
        {
          record: record('mem_bad'),
          marketId: 'missing',
          companyId: 'missing',
          roles: ['company'],
        },
        0,
      ),
    ).toThrow();
    expect(vault.status().revision).toBe(0);
    vault.close();
  });

  it('rejects foreign vault records before persisting them', () => {
    const vault = openVault(location(), 'vault_fixture');
    expect(() =>
      vault.saveCompany({ ...company(), record: record('co_a', 1, 'vault_other') }, 0),
    ).toThrow(/vault/i);
    expect(vault.getCompany('co_a')).toBeNull();
    expect(vault.status().revision).toBe(0);
    vault.close();
  });

  it('rejects stale record writes from two capabilities of the one owner and preserves history', () => {
    const file = location();
    const first = openVault(file, 'vault_fixture');
    first.saveCompany(company(), 0);
    const second = { ...first, ...first.writer() };
    const updated = { ...company(), name: 'Corrected Labs', record: record('co_a', 2) };
    second.saveCompany(updated, 1);
    expect(() =>
      first.saveCompany({ ...company(), name: 'Stale Labs', record: record('co_a', 2) }, 1),
    ).toThrow(/revision/i);
    expect(first.getCompany('co_a')).toEqual(updated);
    expect(first.companyHistory('co_a').items).toEqual([company(), updated]);
    expect(first.status().revision).toBe(2);
    first.close();
    second.close();
  });

  it('requires exact revision progression and immutable creation time', () => {
    const vault = openVault(location(), 'vault_fixture');
    vault.saveCompany(company(), 0);
    expect(() => vault.saveCompany({ ...company(), record: record('co_a', 3) }, 1)).toThrow(
      /revision/i,
    );
    expect(() =>
      vault.saveCompany(
        { ...company(), record: { ...record('co_a', 2), createdAt: '2026-09-29T12:00:00.000Z' } },
        1,
      ),
    ).toThrow(/creation/i);
    expect(vault.status().revision).toBe(1);
    vault.close();
  });

  it('does not allow a newer revision to move its update timestamp backwards', () => {
    const vault = openVault(location(), 'vault_fixture');
    vault.saveCompany(
      { ...company(), record: { ...record('co_a'), updatedAt: '2026-09-30T12:00:00.000002Z' } },
      0,
    );
    expect(() =>
      vault.saveCompany(
        {
          ...company(),
          record: { ...record('co_a', 2), updatedAt: '2026-09-30T12:00:00.000001Z' },
        },
        1,
      ),
    ).toThrow(/update time/i);
    expect(vault.status().revision).toBe(1);
  });

  it('rejects a stored body whose identity disagrees with its indexed company ID', () => {
    const file = location();
    openVault(file, 'vault_fixture').close();
    const db = new DatabaseSync(file);
    db.prepare('INSERT INTO companies(id,revision,body) VALUES(?,?,?)').run(
      'co_a',
      1,
      JSON.stringify(company('co_other')),
    );
    // Keep the v5 derived search row valid so this fixture still isolates
    // the mismatched indexed ID, rather than failing earlier for missing FTS.
    db.prepare('INSERT INTO company_identity_search VALUES(?,?,?)').run(
      'co_a',
      'Fixture Labs',
      'a.example',
    );
    db.close();
    const vault = openVault(file, 'vault_fixture');
    expect(() => vault.getCompany('co_a')).toThrow(/identity/i);
  });

  it('rejects a vault with broken foreign keys without attempting a repair', () => {
    const file = location();
    openVault(file, 'vault_fixture').close();
    const db = new DatabaseSync(file, { enableForeignKeyConstraints: false });
    const member = {
      record: record('mem_bad'),
      marketId: 'missing',
      companyId: 'missing',
      roles: ['company'],
    };
    db.prepare(
      'INSERT INTO memberships(id,revision,body,company_id,market_id) VALUES(?,?,?,?,?)',
    ).run('mem_bad', 1, JSON.stringify(member), 'missing', 'missing');
    db.close();
    const before = readFileSync(file);
    expect(() => openVault(file, 'vault_fixture')).toThrow(/foreign key/i);
    expect(readFileSync(file)).toEqual(before);
  });

  it('prevents replacing or deleting historical records even through a direct SQLite handle', () => {
    const file = location();
    const vault = openVault(file, 'vault_fixture');
    vault.saveCompany(company(), 0);
    const db = new DatabaseSync(file);
    try {
      expect(() => db.exec('UPDATE record_history SET revision=2')).toThrow(/append-only/i);
      expect(() => db.exec('DELETE FROM record_history')).toThrow(/append-only/i);
      expect(vault.companyHistory('co_a').items).toEqual([company()]);
    } finally {
      db.close();
    }
  });

  it('does not overwrite an existing backup or the active vault', async () => {
    const file = location();
    const vault = openVault(file, 'vault_fixture');
    const destination = location();
    openVault(destination, 'vault_other').close();
    const before = readFileSync(destination);
    await expect(vault.backup(destination)).rejects.toThrow(/new.*destination/i);
    await expect(vault.backup(file)).rejects.toThrow();
    expect(readFileSync(destination)).toEqual(before);
  });

  it('rejects a too-new vault without changing its bytes', () => {
    const file = location();
    const db = new DatabaseSync(file);
    db.exec('PRAGMA user_version=99; CREATE TABLE future_only(data TEXT);');
    db.close();
    const before = readFileSync(file);
    expect(() => openVault(file, 'vault_fixture')).toThrow(/newer|schema/i);
    expect(readFileSync(file)).toEqual(before);
  });

  it('does not adopt an unrelated unversioned SQLite file', () => {
    const file = location();
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE unrelated(data TEXT);');
    db.close();
    const before = readFileSync(file);
    expect(() => openVault(file, 'vault_fixture')).toThrow(/unrecognized/i);
    expect(readFileSync(file)).toEqual(before);
  });

  it('refuses a valid vault belonging to a different ID without rewriting it', () => {
    const file = location();
    openVault(file, 'vault_fixture').close();
    const before = readFileSync(file);
    expect(() => openVault(file, 'vault_other')).toThrow(/vault/i);
    expect(readFileSync(file)).toEqual(before);
  });

  it('treats search input as bounded literal terms, not SQL or FTS operators', () => {
    const vault = openVault(location(), 'vault_fixture');
    vault.saveCompany(company(), 0);
    expect(vault.searchCompanies('Fixture OR missing').items).toEqual([]);
    expect(() => vault.searchCompanies('"; DROP TABLE companies; --')).not.toThrow();
    expect(vault.getCompany('co_a')).toEqual(company());
    expect(() => vault.searchCompanies('x'.repeat(501))).toThrow();
    vault.close();
  });

  it('reports a continuation cursor instead of silently truncating company searches', () => {
    const vault = openVault(location(), 'vault_fixture');
    for (const id of ['co_a', 'co_b', 'co_c']) vault.saveCompany(company(id), 0);
    const first = vault.searchCompanies('Fixture', { limit: 2 });
    expect(first.items.map((item) => item.record.id)).toEqual(['co_a', 'co_b']);
    expect(first.nextCursor).toBe('co_b');
    expect(first.vaultRevision).toBe(3);
    const second = vault.searchCompanies('Fixture', { limit: 2, afterId: first.nextCursor! });
    expect(second.items.map((item) => item.record.id)).toEqual(['co_c']);
    expect(second.nextCursor).toBeNull();
    expect(() => vault.searchCompanies('Fixture', { limit: 101 })).toThrow();
  });

  it('rejects excessive search terms instead of silently ignoring the tail', () => {
    const vault = openVault(location(), 'vault_fixture');
    expect(() => vault.searchCompanies(Array(17).fill('term').join(' '))).toThrow(/terms/i);
  });

  it('creates a consistent online backup containing the latest committed data', async () => {
    const file = location();
    const vault = openVault(file, 'vault_fixture');
    vault.saveCompany(company(), 0);
    const backupFile = path.join(path.dirname(file), 'backup.sqlite');
    await vault.backup(backupFile);
    const restored = openVault(backupFile, 'vault_fixture');
    expect(restored.getCompany('co_a')).toEqual(company());
    expect(restored.integrity()).toBe('ok');
    restored.close();
    vault.close();
  });
});
