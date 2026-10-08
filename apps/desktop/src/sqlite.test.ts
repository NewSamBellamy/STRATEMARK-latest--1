import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REPO_SCHEMA_VERSION, type RepoSnapshot } from '@mi/research';
import sampleSnapshot from '../../web/src/sample/frontier-snapshot.json';
import { createSqliteStore } from './sqlite.js';
import { createFileStore, parseResearchExport } from './storage.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'stratemark-sqlite-'));
});

afterEach(() => {
  // Nothing to clean: every fixture lives in its own temp directory.
});

/** A realistic full snapshot: the seeded sample plus evidence with grounding. */
function snapshot(): RepoSnapshot {
  const dataset = sampleSnapshot as unknown as RepoSnapshot;
  return {
    ...dataset,
    schemaVersion: REPO_SCHEMA_VERSION,
    briefings: [],
    savedCards: [],
    researchJobs: [],
    researchEvidence: dataset.companies.flatMap((company, index) => [{
      id: `ev_${company.id}_${index}`,
      companyId: company.id,
      companyName: company.name,
      topic: 'company_profile',
      capturedAt: '2026-10-08T00:00:00.000Z',
      text: `${company.name} profile notes with a reported figure of $1.5 billion.`,
      citations: [{ title: 'Example', url: 'https://example.com/press' }],
      queries: [`${company.name} revenue`],
      grounding: {
        provider: 'google-search' as const,
        answerText: `${company.name} operates as a test company. It reported annual revenues of $1.5 billion USD as of December 31, 2025.`,
        supports: [{
          supportIndex: 0,
          text: `reported annual revenues of $1.5 billion USD as of December 31, 2025`,
          startIndex: 40,
          endIndex: 104,
          sources: [{ chunkIndex: 0, url: 'https://example.com/press', title: 'Example' }],
        }],
      },
    }]),
    originalSourceAttempts: [{
      id: 'src_attempt_1',
      companyId: dataset.companies[0]!.id,
      metricType: 'arr',
      capturedAt: '2026-10-08T00:00:00.000Z',
      receipts: [],
    }],
  };
}

function mutate(snapshot: RepoSnapshot): RepoSnapshot {
  const next = structuredClone(snapshot);
  (next.metrics[0] as { value: number | null }).value = 123_456_789;
  next.cards.splice(2, 1); // one card deleted
  next.researchEvidence!.push({
    id: 'ev_new_1', companyId: next.companies[0]!.id, topic: 'metrics_hunt',
    capturedAt: '2026-10-09T00:00:00.000Z', text: 'Fresh hunt notes.', citations: [], queries: [],
  });
  next.reports = [...(next.reports ?? [])].reverse(); // ordering is data
  (next.companyMarket as Record<string, string>)[next.companies[0]!.id] = 'mkt_changed';
  return next;
}

describe('sqlite research store', () => {
  it('round-trips a full snapshot exactly, including evidence, order and records', () => {
    const file = path.join(dir, 'repo.json');
    const store = createSqliteStore(file)!;
    expect(store).not.toBeNull();
    const original = snapshot();
    store.write(original);
    const reopened = createSqliteStore(file)!;
    const read = reopened.read();
    expect(read).not.toBeNull();
    // Compare against the normalized form: the file store also round-trips
    // through parse+migration, which applies field defaults (briefings etc.).
    expect(read).toEqual(parseResearchExport(JSON.stringify(original)));
  });

  it('persists incremental changes: row updates, deletions, additions and record edits', () => {
    const file = path.join(dir, 'repo.json');
    const store = createSqliteStore(file)!;
    const original = snapshot();
    store.write(original);
    store.write(mutate(original));
    const read = store.read()!;
    void parseResearchExport;
    expect(read.metrics[0]).toMatchObject({ value: 123_456_789 });
    expect(read.cards).toHaveLength(original.cards.length - 1);
    expect(read.cards.find(c => c.id === original.cards[2]!.id)).toBeUndefined();
    expect(read.researchEvidence!.find(e => e.id === 'ev_new_1')).toBeTruthy();
    expect(read.reports.map(r => r.id)).toEqual([...original.reports].reverse().map(r => r.id));
    expect((read.companyMarket as Record<string, string>)[original.companies[0]!.id]).toBe('mkt_changed');
  });

  it('reads null on a fresh install so the sample-seed flow still runs, and seeds normally', () => {
    const file = path.join(dir, 'repo.json');
    const store = createSqliteStore(file)!;
    expect(store.read()).toBeNull();
    store.write(snapshot());
    expect(store.read()!.companies.length).toBeGreaterThan(0);
  });

  it('imports an existing JSON store once and leaves the JSON file untouched as a backup', () => {
    const file = path.join(dir, 'repo.json');
    const original = snapshot();
    const jsonStore = createFileStore(file);
    jsonStore.write(original);
    const before = readFileSync(file, 'utf8');

    const store = createSqliteStore(file)!;
    expect(store.read()).toEqual(original);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(existsSync(file.replace(/\.json$/, '') + '.sqlite')).toBe(true);

    // The JSON file is no longer written: SQLite is the system of record.
    store.write(mutate(original));
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('refuses snapshots written by a future schema version instead of serving stale rows', () => {
    const file = path.join(dir, 'repo.json');
    const store = createSqliteStore(file)!;
    const original = snapshot();
    store.write({ ...original, schemaVersion: REPO_SCHEMA_VERSION + 1 });
    expect(() => store.read()).toThrow(/newer Stratemark version/);
  });

  it('rejects malformed writes without corrupting the previous state', () => {
    const file = path.join(dir, 'repo.json');
    const store = createSqliteStore(file)!;
    const original = snapshot();
    store.write(original);
    expect(() => store.write({ ...original, metrics: 'not-an-array' as unknown as RepoSnapshot['metrics'] })).toThrow(/Invalid metrics/);
    // A row without its key fails loudly, and nothing was partially written.
    const broken = structuredClone(original);
    delete (broken.metrics[0] as { id?: string }).id;
    expect(() => store.write(broken)).toThrow(/missing its id/);
    expect(store.read()).toEqual(parseResearchExport(JSON.stringify(original)));
  });

  it('returns detached snapshots: mutating a read does not affect later reads', () => {
    const file = path.join(dir, 'repo.json');
    const store = createSqliteStore(file)!;
    store.write(snapshot());
    const first = store.read()!;
    (first.companies[0] as { name: string }).name = 'MUTATED';
    (first.metrics[0] as { value: number | null }).value = 1;
    const second = store.read()!;
    expect(second.companies[0]!.name).not.toBe('MUTATED');
    expect(second.metrics[0]!.value).not.toBe(1);
  });

  it('stays fast at multi-day scale: full write once, incremental writes after', () => {
    const file = path.join(dir, 'repo.json');
    const store = createSqliteStore(file)!;
    const big = snapshot();
    const companies = big.companies;
    for (let i = 0; i < 40; i += 1) {
      const company = companies[i % companies.length]!;
      for (let j = 0; j < 100; j += 1) {
        big.researchEvidence!.push({
          id: `ev_scale_${i}_${j}`, companyId: company.id, companyName: company.name,
          topic: 'metrics_hunt', capturedAt: '2026-10-08T00:00:00.000Z',
          text: `Scale evidence row ${i}-${j} with a reported figure of $${j} billion.`,
          citations: [{ title: 'Scale', url: `https://example.com/${i}/${j}` }], queries: [],
        });
      }
    }
    const fullStart = performance.now();
    store.write(big);
    const fullMs = performance.now() - fullStart;
    const touched = structuredClone(big);
    (touched.metrics[0] as { value: number | null }).value = 42;
    const incrementalStart = performance.now();
    store.write(touched);
    const incrementalMs = performance.now() - incrementalStart;
    expect(fullMs).toBeLessThan(15_000);
    // The incremental write changed ONE row; it must not pay for the corpus.
    expect(incrementalMs).toBeLessThan(1_500);
    expect(incrementalMs).toBeLessThan(fullMs);
  });
});

describe('sqlite store red team', () => {
  it('does not resurrect deleted rows across store instances (repository swap)', () => {
    const file = path.join(dir, 'repo.json');
    const original = snapshot();
    const first = createSqliteStore(file)!;
    first.write(original);
    // A second instance (what a settings-swap creates) deletes rows and writes.
    const second = createSqliteStore(file)!;
    const shrunken = structuredClone(original);
    shrunken.cards.splice(0, 2);
    shrunken.researchEvidence!.splice(0, 3);
    second.write(shrunken);
    // Neither the deleting instance nor a fresh one may resurrect the rows.
    for (const store of [second, createSqliteStore(file)!]) {
      const read = store.read()!;
      expect(read.cards.length).toBe(original.cards.length - 2);
      expect(read.researchEvidence!.length).toBe(original.researchEvidence!.length - 3);
    }
  });

  it('refuses writes that omit a core array instead of wiping the table', () => {
    const file = path.join(dir, 'repo.json');
    const store = createSqliteStore(file)!;
    const original = snapshot();
    store.write(original);
    const broken = structuredClone(original) as unknown as Record<string, unknown>;
    delete broken.metrics;
    expect(() => store.write(broken as unknown as RepoSnapshot)).toThrow(/Invalid metrics/);
    expect(store.read()!.metrics.length).toBe(original.metrics.length);
  });
});
