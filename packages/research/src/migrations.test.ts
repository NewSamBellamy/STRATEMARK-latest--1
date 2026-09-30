/**
 * Snapshot migrations.
 *
 * There was no migration system at all: `normalize()` spread defaults over
 * whatever was on disk. That absorbs additive changes but corrupts state on a
 * rename or type change — and since the entire research corpus lives in one
 * JSON document, that failure is total rather than partial.
 */
import { describe, expect, it } from 'vitest';
import {
  GeminiRepository,
  REPO_SCHEMA_VERSION,
  SNAPSHOT_MIGRATIONS,
  migrateSnapshot,
  type RepoSnapshot,
  type ResearchStore,
} from './repository';

function legacySnapshot(): RepoSnapshot {
  // A v1 snapshot: no schemaVersion, and missing fields added after it shipped.
  return {
    markets: [],
    decks: [],
    companies: [],
    metrics: [],
    cards: [],
    viceClaims: [],
    dashboards: {},
    companyMarket: {},
    opportunity: {},
  } as unknown as RepoSnapshot;
}

describe('migrateSnapshot', () => {
  it('treats a missing schemaVersion as v1 and upgrades it', () => {
    const outcome = migrateSnapshot(legacySnapshot());
    expect(outcome.fromVersion).toBe(1);
    expect(outcome.applied).toContain(1);
    expect(outcome.snapshot.schemaVersion).toBe(REPO_SCHEMA_VERSION);
  });

  it('backfills fields the legacy snapshot never had', () => {
    const outcome = migrateSnapshot(legacySnapshot());
    // These are the ones normalize() has to supply or downstream code crashes.
    expect(outcome.snapshot.reports).toEqual([]);
    expect(outcome.snapshot.savedCards).toEqual([]);
    expect(outcome.snapshot.researchJobs).toEqual([]);
    expect(outcome.snapshot.threads).toEqual([]);
  });

  it('is a no-op on a current snapshot', () => {
    const current = { ...legacySnapshot(), schemaVersion: REPO_SCHEMA_VERSION };
    const outcome = migrateSnapshot(current as RepoSnapshot);
    expect(outcome.fromVersion).toBe(REPO_SCHEMA_VERSION);
    expect(outcome.applied).toEqual([]);
  });

  it('returns an empty snapshot for a first run', () => {
    const outcome = migrateSnapshot(null);
    expect(outcome.fromVersion).toBeNull();
    expect(outcome.snapshot.schemaVersion).toBe(REPO_SCHEMA_VERSION);
    expect(outcome.snapshot.markets).toEqual([]);
  });

  it('does NOT mangle a snapshot from a newer build', () => {
    // A user who ran a newer release then downgraded should not lose data.
    const future = {
      ...legacySnapshot(),
      schemaVersion: REPO_SCHEMA_VERSION + 5,
      futureOnly: { retained: ['original'] },
    } as RepoSnapshot;
    const outcome = migrateSnapshot(future);
    expect(outcome.fromVersion).toBe(REPO_SCHEMA_VERSION + 5);
    expect(outcome.applied).toEqual([]);
    expect(outcome.snapshot.schemaVersion).toBe(REPO_SCHEMA_VERSION + 5);
    expect(outcome.snapshot).toEqual(future);
  });

  it.each([0, -1, 1.5, NaN, Infinity, '2', null, undefined])(
    'rejects an explicitly invalid schema version: %s',
    (schemaVersion) => {
      const source = { ...legacySnapshot(), schemaVersion } as unknown as RepoSnapshot;
      const before = structuredClone(source);
      expect(() => migrateSnapshot(source)).toThrow(/invalid.*schema version/i);
      expect(source).toEqual(before);
    },
  );

  it('fails closed if a required migration is missing instead of stamping success', () => {
    const source = legacySnapshot();
    const before = structuredClone(source);
    const migration = SNAPSHOT_MIGRATIONS[1];
    if (!migration) throw new Error('The fixture requires the registered v1 migration.');
    delete SNAPSHOT_MIGRATIONS[1];
    try {
      expect(() => migrateSnapshot(source)).toThrow(/missing.*migration/i);
      expect(source).toEqual(before);
    } finally {
      SNAPSHOT_MIGRATIONS[1] = migration;
    }
  });

  it('has a migration registered for every version gap below current', () => {
    // Guards the most likely mistake: bumping REPO_SCHEMA_VERSION and
    // forgetting the migration, which would silently skip the upgrade.
    for (let v = 1; v < REPO_SCHEMA_VERSION; v += 1) {
      expect(SNAPSHOT_MIGRATIONS[v], `missing migration from v${v}`).toBeTypeOf('function');
    }
  });

  it('preserves job status during format inspection; restart recovery is a separate operation', () => {
    const withRunning = {
      ...legacySnapshot(),
      researchJobs: [{ id: 'job_1', status: 'running' }],
    } as unknown as RepoSnapshot;

    const outcome = migrateSnapshot(withRunning);
    const job = outcome.snapshot.researchJobs[0];
    expect(job?.status).toBe('running');
    expect(withRunning.researchJobs[0]?.status).toBe('running');
  });
});

describe('GeminiRepository load path', () => {
  function storeWith(initial: RepoSnapshot | null): {
    store: ResearchStore;
    written: RepoSnapshot[];
  } {
    const written: RepoSnapshot[] = [];
    let current = initial;
    return {
      written,
      store: {
        read: () => current,
        write: (snap) => {
          current = snap;
          written.push(snap);
        },
      },
    };
  }

  it('migrates on construction and persists once so it does not re-run', () => {
    const { store, written } = storeWith(legacySnapshot());
    const repo = new GeminiRepository({ apiKey: 'k', store });

    const outcome = repo.getMigrationOutcome();
    expect(outcome?.fromVersion).toBe(1);
    expect(outcome?.applied).toContain(1);

    // Persisted immediately, so the next launch reads a current snapshot.
    expect(written).toHaveLength(1);
    expect(written[0]?.schemaVersion).toBe(REPO_SCHEMA_VERSION);

    const second = new GeminiRepository({ apiKey: 'k', store });
    expect(second.getMigrationOutcome()?.applied).toEqual([]);
  });

  it('does not write on a first run with no stored snapshot', () => {
    const { store, written } = storeWith(null);
    const repo = new GeminiRepository({ apiKey: 'k', store });
    expect(repo.getMigrationOutcome()?.fromVersion).toBeNull();
    expect(written).toHaveLength(0);
  });
  it('still recovers an interrupted job at repository startup, not during inspection', async () => {
    const initial = {
      ...legacySnapshot(),
      schemaVersion: REPO_SCHEMA_VERSION,
      researchJobs: [{ id: 'job_1', status: 'running', error: null }],
    } as unknown as RepoSnapshot;
    const { store } = storeWith(initial);
    const inspected = migrateSnapshot(initial);
    expect(inspected.snapshot.researchJobs[0]?.status).toBe('running');
    const repo = new GeminiRepository({ apiKey: 'synthetic-test-key', store });
    expect((await repo.getResearchJob('job_1'))?.status).toBe('failed');
    expect((await repo.getResearchJob('job_1'))?.error).toBe('Interrupted by restart.');
    expect(initial.researchJobs[0]?.status).toBe('running');
    expect(inspected.snapshot.researchJobs[0]?.status).toBe('running');
  });
});
