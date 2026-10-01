import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type * as NodeSqlite from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openVault, type VaultCompany } from './vault';
const { DatabaseSync } = createRequire(process.execPath)('node:sqlite') as typeof NodeSqlite;

const AT = '2026-09-30T12:00:00.000Z';
const roots: string[] = [];
const handles: ReturnType<typeof openVault>[] = [];
const record = (id: string, revision = 1) => ({
  contractVersion: '1' as const,
  vaultId: 'vault_fixture',
  id,
  revision,
  createdAt: AT,
  updatedAt: AT,
});
const company = (id = 'co_a') => ({
  record: record(id),
  name: 'Fixture Labs',
  officialDomain: 'fixture.example',
});
const scopeDraft = () => ({
  goal: 'Find industrial robotics suppliers',
  inclusions: ['Manufacturers'],
  exclusions: ['Consultants'],
  region: 'North America',
  depth: 'standard' as const,
  seeds: [{ companyId: 'co_a', name: 'Fixture Labs', domain: 'fixture.example' }],
});
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'stratemark-context-test-'));
  roots.push(root);
  const file = path.join(root, 'vault.sqlite');
  const vault = openVault(file, 'vault_fixture');
  handles.push(vault);
  return { file, vault, writer: vault.writer() };
}
afterEach(() => {
  for (const vault of handles.splice(0)) vault.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});
describe('typed inventory context (offline, not approved research)', () => {
  it('refuses accidental omission of retained context on replacement saves', () => {
    const { vault, writer } = fixture();
    const rich = { ...company(), identityHints: { aliases: ['Prior Labs'], domains: [] } };
    writer.saveCompany(rich, 0);
    expect(() => writer.saveCompany({ ...company(), record: record('co_a', 2) }, 1)).toThrow(
      /context/i,
    );
    expect(vault.getCompany('co_a')).toEqual(rich);
    const market = { record: record('mkt_a'), name: 'Robots', scopeDraft: scopeDraft() };
    writer.saveMarket(market, 0);
    expect(() => writer.saveMarket({ record: record('mkt_a', 2), name: 'Robots' }, 1)).toThrow(
      /context/i,
    );
    expect(vault.getMarket('mkt_a')).toEqual(market);
    expect(vault.status().revision).toBe(2);
  });
  it('refuses a damaged identity search index without silently hiding retained companies', () => {
    const { file, vault, writer } = fixture();
    writer.saveCompany(
      { ...company(), identityHints: { aliases: ['Prior Labs'], domains: [] } },
      0,
    );
    vault.close();
    const db = new DatabaseSync(file);
    db.prepare('DELETE FROM company_identity_search WHERE company_id=?').run('co_a');
    db.close();
    expect(() => {
      const unexpected = openVault(file, 'vault_fixture');
      handles.push(unexpected);
    }).toThrow(/search.*index/i);
  });
  it('retains a reported company profile and identity hints across backup/reopen without merging names', async () => {
    const { file, vault, writer } = fixture();
    const rich = {
      ...company(),
      profile: {
        oneLiner: 'Precision robots',
        hqLocation: 'Detroit',
        websiteUrl: 'https://fixture.example/about',
        logoUrl: 'https://fixture.example/logo.svg',
        brandTheme: null,
      },
      identityHints: { aliases: ['Prior Robotics'], domains: ['old-fixture.example'] },
    };
    writer.saveCompany(rich, 0);
    writer.saveCompany({ ...company('co_b'), officialDomain: 'different.example' }, 0);
    expect(vault.getCompany('co_a')).toEqual(rich);
    const backup = path.join(path.dirname(file), 'backup.sqlite');
    await vault.backup(backup);
    const restored = openVault(backup, 'vault_fixture');
    handles.push(restored);
    expect(restored.getCompany('co_a')).toEqual(rich);
    expect(restored.searchCompanies('Fixture').items).toHaveLength(2);
    expect(restored.searchCompanies('Prior Robotics').items.map((x) => x.record.id)).toEqual([
      'co_a',
    ]);
    expect(restored.searchCompanies('old-fixture').items.map((x) => x.record.id)).toEqual(['co_a']);
  });
  it('updates searchable identity hints atomically, while preserving prior profiles', () => {
    const { vault, writer } = fixture();
    const first = { ...company(), identityHints: { aliases: ['Old Alias'], domains: [] } };
    const second = {
      ...first,
      record: record('co_a', 2),
      identityHints: { aliases: ['New Alias'], domains: [] },
    };
    writer.saveCompany(first, 0);
    writer.saveCompany(second, 1);
    expect(vault.companyHistory('co_a').items).toEqual([first, second]);
    expect(vault.searchCompanies('Old').items).toEqual([]);
    expect(vault.searchCompanies('New').items).toEqual([second]);
    expect(() =>
      writer.saveCompany(
        {
          ...second,
          record: record('co_a', 2),
          identityHints: { aliases: ['Stale'], domains: [] },
        },
        1,
      ),
    ).toThrow(/revision/i);
    expect(vault.searchCompanies('New').items).toEqual([second]);
    expect(vault.searchCompanies('Stale').items).toEqual([]);
    expect(vault.searchCompanies('Fixture New').items).toEqual([second]);
  });
  it('preserves scope drafts, seed IDs and original legacy scope separately across revisions', () => {
    const { vault, writer } = fixture();
    writer.saveCompany(company(), 0);
    const market = {
      record: record('mkt_a'),
      name: 'Robotics',
      scopeDraft: scopeDraft(),
      legacyScope: { vertical: 'Industrial robots', geography: 'US', notes: 'Original framing' },
    };
    writer.saveMarket(market, 0);
    expect(vault.getMarket('mkt_a')).toEqual(market);
    const edited = {
      ...market,
      record: record('mkt_a', 2),
      scopeDraft: { ...scopeDraft(), region: 'Europe' },
    };
    writer.saveMarket(edited, 1);
    expect(vault.marketHistory('mkt_a').items).toEqual([market, edited]);
    expect(vault.getMarket('mkt_a')).toEqual(edited);
    expect(vault.status().revision).toBe(3);
    // A scope is retained data, not an approved budget, schedule or grant.
    expect('approveBudget' in writer).toBe(false);
  });
  it('rejects a scope that references missing seed IDs and leaves all versions intact', () => {
    const { vault, writer } = fixture();
    expect(() =>
      writer.saveMarket({ record: record('mkt_a'), name: 'Robotics', scopeDraft: scopeDraft() }, 0),
    ).toThrow(/seed/i);
    expect(vault.getMarket('mkt_a')).toBeNull();
    expect(vault.marketHistory('mkt_a').items).toEqual([]);
    expect(vault.status().revision).toBe(0);
  });
  it('provides bounded market pages and exact membership history without copying shared dossiers', () => {
    const { vault, writer } = fixture();
    writer.saveCompany(company(), 0);
    for (const id of ['mkt_a', 'mkt_b', 'mkt_c'])
      writer.saveMarket({ record: record(id), name: id }, 0);
    const member = {
      record: record('mem_a'),
      companyId: 'co_a',
      marketId: 'mkt_a',
      roles: ['company' as const],
    };
    writer.saveMembership(member, 0);
    const edited = {
      ...member,
      record: record('mem_a', 2),
      roles: ['company' as const, 'infrastructure' as const],
    };
    writer.saveMembership(edited, 1);
    expect(vault.getMembership('mem_a')).toEqual(edited);
    expect(vault.membershipHistory('mem_a').items).toEqual([member, edited]);
    const first = vault.listMarkets({ limit: 2 });
    expect(first.items.map((x) => x.record.id)).toEqual(['mkt_a', 'mkt_b']);
    expect(first.nextCursor).toBe('mkt_b');
    expect(
      vault.listMarkets({ limit: 2, afterId: first.nextCursor! }).items.map((x) => x.record.id),
    ).toEqual(['mkt_c']);
    expect(() => vault.listMarkets({ limit: 101 })).toThrow();
  });
  it('rejects unsafe profile URLs, duplicate hints and invented authority without partial writes', () => {
    const { vault, writer } = fixture();
    for (const extra of [
      {
        profile: {
          oneLiner: 'Robots',
          hqLocation: null,
          websiteUrl: 'file:///private',
          logoUrl: null,
          brandTheme: null,
        },
      },
      { identityHints: { aliases: ['SAME', 'same'], domains: [] } },
      { identityHints: { aliases: [], domains: ['same.example', 'SAME.example'] } },
      { identityHints: { aliases: [], domains: ['https://not-a-domain.example'] } },
      { identityHints: { aliases: ['Other'], domains: [], verified: true } },
    ])
      expect(() => writer.saveCompany({ ...company(), ...extra } as VaultCompany, 0)).toThrow();
    expect(vault.status().revision).toBe(0);
    expect(vault.getCompany('co_a')).toBeNull();
  });
  it('retains scope seed links in historical revisions and refuses forged stored seed indexes', () => {
    const { file, vault, writer } = fixture();
    writer.saveCompany(company(), 0);
    const first = { record: record('mkt_a'), name: 'Robotics', scopeDraft: scopeDraft() };
    writer.saveMarket(first, 0);
    writer.saveMarket(
      { ...first, record: record('mkt_a', 2), scopeDraft: { ...scopeDraft(), seeds: [] } },
      1,
    );
    const db = new DatabaseSync(file);
    try {
      expect(
        db
          .prepare('SELECT market_id,market_revision,ordinal,company_id FROM market_scope_seeds')
          .all(),
      ).toEqual([{ market_id: 'mkt_a', market_revision: 1, ordinal: 0, company_id: 'co_a' }]);
      expect(() => db.exec('DELETE FROM market_scope_seeds')).toThrow(/append-only/i);
      const tampered = { ...first, record: record('mkt_a', 2) };
      db.prepare('UPDATE markets SET body=? WHERE id=?').run(JSON.stringify(tampered), 'mkt_a');
      expect(() => vault.getMarket('mkt_a')).toThrow(/seed.*index/i);
      expect(vault.marketHistory('mkt_a').items[0]).toEqual(first);
    } finally {
      db.close();
    }
  });
});
