import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { legacyRetentionFixture } from './legacy-retention-fixture';
import { inspectResearchStorage, preflightCurrentResearch } from './storage-preflight';

const roots: string[] = [];
function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'stratemark-storage-preflight-'));
  roots.push(root);
  return { root, file: path.join(root, 'repo.json') };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('read-only normal-workspace storage status', () => {
  it('reports verified primary and backup counts without changing bytes, timestamps or files', () => {
    const { root, file } = workspace();
    const primary = JSON.stringify(legacyRetentionFixture(2));
    const backup = JSON.stringify(legacyRetentionFixture(1));
    writeFileSync(file, primary);
    writeFileSync(`${file}.bak`, backup);
    const before = [file, `${file}.bak`].map((target) => ({
      bytes: readFileSync(target),
      mtimeMs: statSync(target).mtimeMs,
    }));
    const names = readdirSync(root);

    const result = inspectResearchStorage(file);

    expect(result).toMatchObject({
      engine: 'legacy_json',
      health: 'ready',
      contentKind: 'workspace',
      marketCount: 2,
      deckCount: 2,
      backup: { state: 'verified', marketCount: 2, deckCount: 2 },
    });
    expect(result.sourceRevision).toBe(createHash('sha256').update(primary).digest('hex'));
    expect(readdirSync(root)).toEqual(names);
    for (const [index, target] of [file, `${file}.bak`].entries()) {
      expect(readFileSync(target)).toEqual(before[index]!.bytes);
      expect(statSync(target).mtimeMs).toBe(before[index]!.mtimeMs);
    }
  });

  it('reports recovery needed but never repairs a corrupt primary or overclaims a corrupt backup', () => {
    const { root, file } = workspace();
    writeFileSync(file, '{ broken');
    writeFileSync(`${file}.bak`, JSON.stringify(legacyRetentionFixture(2)));
    const before = readFileSync(file);

    expect(inspectResearchStorage(file)).toMatchObject({
      health: 'recovery_needed',
      primaryState: 'invalid',
      backup: { state: 'verified' },
    });
    expect(readFileSync(file)).toEqual(before);
    expect(readdirSync(root).sort()).toEqual(['repo.json', 'repo.json.bak']);

    writeFileSync(`${file}.bak`, '{ also broken');
    expect(inspectResearchStorage(file)).toMatchObject({
      health: 'unavailable',
      primaryState: 'invalid',
      backup: { state: 'invalid' },
    });
  });

  it('distinguishes an empty workspace and an exact bundled demo without writing either', () => {
    const { root, file } = workspace();
    expect(inspectResearchStorage(file)).toMatchObject({
      health: 'empty',
      primaryState: 'missing',
      contentKind: 'none',
      backup: { state: 'missing' },
    });
    expect(readdirSync(root)).toEqual([]);

    const demo = JSON.stringify(legacyRetentionFixture(2));
    writeFileSync(file, demo);
    const demoHash = createHash('sha256').update(demo).digest('hex');
    expect(inspectResearchStorage(file, demoHash).contentKind).toBe('demo');
  });
});

describe('explicit migration-readiness preflight', () => {
  it('returns a bounded non-authoritative summary and performs no writes', () => {
    const { root, file } = workspace();
    const json = JSON.stringify(legacyRetentionFixture(2), null, 2) + '\n';
    writeFileSync(file, json);
    const before = readFileSync(file);
    const names = readdirSync(root);

    const result = preflightCurrentResearch(file);

    expect(result).toMatchObject({
      state: 'ready',
      canApply: false,
      performedWrites: false,
      counts: { markets: 2, decks: 2, companies: 1, cards: 3 },
    });
    expect(result.state).toBe('ready');
    if (result.state !== 'ready') throw new Error('Expected a ready preflight.');
    expect(result.sourceRevision).toBe(createHash('sha256').update(before).digest('hex'));
    expect(result.warnings).toContain('authority_disabled');
    expect(readFileSync(file)).toEqual(before);
    expect(readdirSync(root)).toEqual(names);
  });

  it('blocks missing, demo, malformed and credential-bearing sources without exposing data', () => {
    const { root, file } = workspace();
    expect(preflightCurrentResearch(file)).toEqual({
      state: 'blocked',
      reason: 'source_missing',
      canApply: false,
      performedWrites: false,
    });

    const demo = JSON.stringify(legacyRetentionFixture(2));
    writeFileSync(file, demo);
    const demoHash = createHash('sha256').update(demo).digest('hex');
    expect(preflightCurrentResearch(file, demoHash)).toEqual({
      state: 'blocked',
      reason: 'demo_workspace',
      canApply: false,
      performedWrites: false,
    });

    writeFileSync(file, '{ malformed');
    expect(preflightCurrentResearch(file)).toEqual({
      state: 'blocked',
      reason: 'invalid_or_unsupported',
      canApply: false,
      performedWrites: false,
    });

    const withSecret = { ...legacyRetentionFixture(2), apiKey: 'not-a-real-key' };
    writeFileSync(file, JSON.stringify(withSecret));
    expect(preflightCurrentResearch(file)).toEqual({
      state: 'blocked',
      reason: 'invalid_or_unsupported',
      canApply: false,
      performedWrites: false,
    });
    expect(readdirSync(root).sort()).toEqual(['repo.json']);
  });
});
