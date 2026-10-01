import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as nativeVault from './vault';
import { legacyRetentionFixture } from './legacy-retention-fixture';
import { openAssetStore } from './vault-assets';
import { openVault } from './vault';
import { stageLegacySnapshot, verifyStagedCandidate } from './vault-staging';

const at = '2026-09-30T12:00:00.000Z';
const roots: string[] = [];
function parent() {
  const root = mkdtempSync(path.join(tmpdir(), 'stratemark-staging-test-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe('offline staged legacy conversion (never a live cutover)', () => {
  it.each([undefined, 1, 2] as const)(
    'stages known schema %s with exact original bytes and full inactive history',
    (version) => {
      const source = legacyRetentionFixture(version);
      const json = JSON.stringify(source, null, 2) + '\n';
      const root = parent();
      const originalFile = path.join(root, 'untouched-source.json');
      writeFileSync(originalFile, json);
      const before = readFileSync(originalFile);
      const result = stageLegacySnapshot(json, root, 'vault_stage', at);
      expect(readFileSync(originalFile)).toEqual(before);
      expect(path.dirname(result.directory)).toBe(root);
      const manifest = verifyStagedCandidate(result.directory);
      expect(manifest).toEqual(result.manifest);
      expect(manifest).toMatchObject({
        format: 'stratemark-stage-v1',
        authority: 'disabled',
        canApply: false,
        sourceSha256: createHash('sha256').update(before).digest('hex'),
        sourceByteLength: before.byteLength,
        projectionCounts: { companies: 1, markets: 2, memberships: 2 },
      });
      const assets = openAssetStore(path.join(result.directory, 'assets'), () => {
        throw new Error('read-only');
      });
      expect(Buffer.concat(manifest.originalSourceChunks.map((ref) => assets.read(ref)))).toEqual(
        before,
      );
      const reader = openVault(
        path.join(result.directory, 'vault.sqlite'),
        'vault_stage',
        'reader',
      );
      try {
        expect(JSON.parse(reader.exportLegacySnapshot(manifest.sourceSha256))).toEqual(source);
        expect(reader.getCompany('co_shared')?.profile?.oneLiner).toBe(
          source.companies[0]!.oneLiner,
        );
        expect(reader.getCompany('co_partial')).toBeNull();
        expect(
          reader.listMarketCompanies('mkt_a').items.map((company) => company.record.id),
        ).toEqual(['co_shared']);
        expect(
          reader.listMarketCompanies('mkt_b').items.map((company) => company.record.id),
        ).toEqual(['co_shared']);
        expect(reader.getObservation('metric_a')).toBeNull();
        expect(reader.listReports({ kind: 'market', id: 'mkt_a' }).items).toEqual([]);
        expect(
          reader.verifyLegacySnapshot(manifest.sourceSha256).proposedAuthority.runnableJobs,
        ).toBe(0);
      } finally {
        reader.close();
      }
    },
  );
  it('retains source chunks larger than one asset, including multibyte original text', () => {
    const source = legacyRetentionFixture(2);
    source.reports[0]!.markdown = 'x'.repeat(8 * 1024 * 1024 - 500) + '🦉'.repeat(300);
    const json = JSON.stringify(source);
    const result = stageLegacySnapshot(json, parent(), 'vault_chunks', at);
    const verified = verifyStagedCandidate(result.directory);
    expect(verified.originalSourceChunks.length).toBeGreaterThan(1);
    expect(verified.originalSourceChunks.every((ref) => ref.byteLength <= 8 * 1024 * 1024)).toBe(
      true,
    );
    expect(verified.sourceByteLength).toBe(Buffer.byteLength(json));
  });
  it('validates malformed/future/credential inputs before making any candidate directory', () => {
    const root = parent();
    for (const source of [
      '{ malformed',
      JSON.stringify({ ...legacyRetentionFixture(2), schemaVersion: 3 }),
      JSON.stringify({ ...legacyRetentionFixture(2), credentials: 'synthetic' }),
    ])
      expect(() => stageLegacySnapshot(source, root, 'vault_stage', at)).toThrow();
    expect(readdirSync(root)).toEqual([]);
    expect(() =>
      stageLegacySnapshot(JSON.stringify(legacyRetentionFixture(2)), root, '../outside', at),
    ).toThrow();
    expect(readdirSync(root)).toEqual([]);
  });
  it('never replaces an existing candidate or the original when a new staging attempt fails', () => {
    const root = parent();
    const good = JSON.stringify(legacyRetentionFixture(2));
    const first = stageLegacySnapshot(good, root, 'vault_stage', at);
    const before = readFileSync(path.join(first.directory, 'manifest.json'));
    const invalidProjection = legacyRetentionFixture(2);
    invalidProjection.companies[0]!.name = 'x'.repeat(241);
    expect(() =>
      stageLegacySnapshot(JSON.stringify(invalidProjection), root, 'vault_failed', at),
    ).toThrow();
    expect(readFileSync(path.join(first.directory, 'manifest.json'))).toEqual(before);
    expect(verifyStagedCandidate(first.directory)).toEqual(first.manifest);
    const second = stageLegacySnapshot(good, root, 'vault_stage', at);
    expect(second.directory).not.toBe(first.directory);
  });
  it.each(['missing', 'damaged'])(
    'rejects a %s original source asset without a false recovery success',
    (mode) => {
      const result = stageLegacySnapshot(
        JSON.stringify(legacyRetentionFixture(2)),
        parent(),
        'vault_stage',
        at,
      );
      const file = path.join(
        result.directory,
        'assets',
        result.manifest.originalSourceChunks[0]!.sha256,
      );
      if (mode === 'missing') unlinkSync(file);
      else writeFileSync(file, 'damaged');
      expect(() => verifyStagedCandidate(result.directory)).toThrow();
    },
  );
  it('rejects forged approval or a changed vault revision instead of switching authority', () => {
    const result = stageLegacySnapshot(
      JSON.stringify(legacyRetentionFixture(2)),
      parent(),
      'vault_stage',
      at,
    );
    const file = path.join(result.directory, 'manifest.json');
    writeFileSync(file, JSON.stringify({ ...result.manifest, canApply: true }));
    expect(() => verifyStagedCandidate(result.directory)).toThrow();
    writeFileSync(file, JSON.stringify(result.manifest));
    const owner = openVault(path.join(result.directory, 'vault.sqlite'), 'vault_stage');
    try {
      owner.writer().saveCompany(
        {
          record: {
            contractVersion: '1',
            vaultId: 'vault_stage',
            id: 'co_unexpected',
            revision: 1,
            createdAt: at,
            updatedAt: at,
          },
          name: 'Unexpected',
          officialDomain: null,
        },
        0,
      );
    } finally {
      owner.close();
    }
    expect(() => verifyStagedCandidate(result.directory)).toThrow();
  });
  it('exposes truthful stage progress and leaves a failed candidate unapproved after retained history', () => {
    const root = parent();
    const source = JSON.stringify(legacyRetentionFixture(2), null, 2);
    const phases: string[] = [];
    let directory: string | undefined;
    expect(() =>
      stageLegacySnapshot(source, root, 'vault_partial', at, (progress) => {
        phases.push(progress.phase);
        directory = progress.directory;
        if (progress.phase === 'history_retained')
          throw new Error('Synthetic interrupted migration');
      }),
    ).toThrow();
    expect(phases).toEqual(['source_retained', 'history_retained']);
    expect(directory).toBeDefined();
    expect(readdirSync(directory!)).not.toContain('manifest.json');
    expect(() => verifyStagedCandidate(directory!)).toThrow();
    const assets = readdirSync(path.join(directory!, 'assets')).filter((name) =>
      /^[a-f0-9]{64}$/.test(name),
    );
    expect(assets).toHaveLength(1);
    expect(readFileSync(path.join(directory!, 'assets', assets[0]!))).toEqual(Buffer.from(source));
    const reader = openVault(path.join(directory!, 'vault.sqlite'), 'vault_partial', 'reader');
    try {
      expect(
        JSON.parse(reader.exportLegacySnapshot(createHash('sha256').update(source).digest('hex'))),
      ).toEqual(JSON.parse(source));
      expect(reader.listMarkets().items).toEqual([]);
    } finally {
      reader.close();
    }
  });
  it('rejects a generation change between source publication and history commit', () => {
    let owner: ReturnType<typeof openVault> | undefined;
    const realOpen = nativeVault.openVault;
    vi.spyOn(nativeVault, 'openVault').mockImplementationOnce((...args) => {
      owner = realOpen(...args);
      return owner;
    });
    let directory: string | undefined;
    expect(() =>
      stageLegacySnapshot(
        JSON.stringify(legacyRetentionFixture(2)),
        parent(),
        'vault_fenced',
        at,
        (progress) => {
          directory = progress.directory;
          if (progress.phase === 'source_retained') owner!.advanceWriterGeneration();
        },
      ),
    ).toThrow();
    expect(directory).toBeDefined();
    expect(readdirSync(directory!)).not.toContain('manifest.json');
    const reader = openVault(path.join(directory!, 'vault.sqlite'), 'vault_fenced', 'reader');
    try {
      expect(reader.status().revision).toBe(0);
      expect(reader.listLegacySnapshots().items).toEqual([]);
    } finally {
      reader.close();
    }
  });
});
