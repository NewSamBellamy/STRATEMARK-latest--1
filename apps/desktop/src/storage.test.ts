import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sample from '../../web/src/sample/frontier-snapshot.json';
import { createFileStore, parseResearchExport } from './storage';

const directories: string[] = [];
const makeStore = () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'stratemark-storage-test-'));
  directories.push(directory);
  const file = path.join(directory, 'repo.json');
  return { file, store: createFileStore(file) };
};
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('desktop research persistence', () => {
  it('round-trips the real sample and creates a last-good backup', () => {
    const { file, store } = makeStore();
    const original = parseResearchExport(JSON.stringify(sample));
    store.write(original);
    const updated = { ...original, markets: original.markets.map((market) => ({ ...market, name: 'Updated workspace' })) };
    store.write(updated);
    expect(store.read()?.markets[0]?.name).toBe('Updated workspace');
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).markets[0].name).toBe(original.markets[0]?.name);
  });
  it('recovers malformed JSON from the backup instead of deleting research', () => {
    const { file, store } = makeStore();
    const snapshot = parseResearchExport(JSON.stringify(sample));
    store.write(snapshot);
    store.write(snapshot);
    writeFileSync(file, 'broken JSON');
    expect(store.read()?.markets[0]?.id).toBe(snapshot.markets[0]?.id);
    expect(JSON.parse(readFileSync(file, 'utf8')).markets).toHaveLength(snapshot.markets.length);
  });
  it('rejects a future format without falling back to an older backup', () => {
    const { file, store } = makeStore();
    const snapshot = parseResearchExport(JSON.stringify(sample));
    store.write(snapshot);
    store.write(snapshot);
    writeFileSync(file, JSON.stringify({ ...snapshot, schemaVersion: 999 }));
    expect(() => store.read()).toThrow(/newer/);
    expect(JSON.parse(readFileSync(file, 'utf8')).schemaVersion).toBe(999);
  });
  it('rejects invalid imports before overwriting saved data', () => {
    const { file, store } = makeStore();
    store.write(parseResearchExport(JSON.stringify(sample)));
    const before = readFileSync(file, 'utf8');
    expect(() => store.write(parseResearchExport('{"markets": []}'))).toThrow();
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
  it('rejects malformed optional collections', () => {
    expect(() => parseResearchExport(JSON.stringify({ ...sample, reports: 'invalid' }))).toThrow(/reports/);
  });
});
