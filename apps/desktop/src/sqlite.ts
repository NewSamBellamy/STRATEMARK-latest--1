/**
 * SQLite persistence — the documented upgrade path over the JSON file store,
 * behind the SAME ResearchStore seam.
 *
 * Why: the whole research corpus lives in one JSON document that is fully
 * re-serialized on every persist. That is fine for one deck and becomes the
 * bottleneck for the long-horizon case — weeks of accumulated evidence — and
 * it is unqueryable: the agent cannot ask the corpus anything without loading
 * and scanning the whole blob. SQLite gives incremental persistence (one
 * changed metric rewrites one row), durability under WAL, and a queryable
 * substrate for retrieval.
 *
 * Design: every snapshot array becomes a table of JSON row payloads plus the
 * key columns queries actually use (deck, company, type, confidence, time).
 * The `json` payload round-trips the contract row losslessly, so the repository
 * reads the exact shape it wrote and the schema stays owned by @mi/contracts.
 * Record-valued snapshot fields (dashboards, companyMarket, opportunity) go to
 * a kv table. Array order is preserved with an explicit `ord` column — the
 * snapshot's ordering IS data (reports are newest-first).
 *
 * The JSON file this store replaces is never deleted: it is read once on first
 * open as the migration source and then left untouched as a last-good backup.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { REPO_SCHEMA_VERSION, type RepoSnapshot, type ResearchStore } from '@mi/research';
import { parseResearchExport } from './storage.js';

// node:sqlite is a genuine builtin on every runtime we ship (Node ≥22.5,
// Electron 44's Node included), but vite's bundled builtin list predates it
// and its resolver rejects the specifier. require() through the runtime's own
// resolver instead: real ESM under vitest, esbuild's import.meta.url shim in
// the bundled CJS main. A runtime without the module gets `undefined` and the
// caller falls back to the JSON file store.
interface SqliteStatement {
  run(...values: (string | number | null)[]): unknown;
  get(...values: (string | number | null)[]): unknown;
  all(...values: (string | number | null)[]): unknown[];
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}
const requireBuiltin = createRequire(
  // CJS bundle (Electron main): the bundle's own path. ESM (vitest): the
  // running CLI's path. node:sqlite is a builtin, so resolution is identical
  // from any base; esbuild's CJS output does not shim import.meta, so this
  // never references it.
  typeof __filename === 'string'
    ? pathToFileURL(__filename).href
    : pathToFileURL(process.argv[1] ?? path.join(process.cwd(), 'main.cjs')).href,
);
const nodeSqlite = (() => {
  try { return requireBuiltin('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDatabase }; }
  catch { return undefined; }
})();

interface TableSpec {
  /** Snapshot field backing this table. */
  field: Exclude<keyof RepoSnapshot, 'schemaVersion' | 'dashboards' | 'companyMarket' | 'opportunity'>;
  name: string;
  /** Key columns extracted for queries; always includes the row key. */
  columns: { row: string; column: string }[];
  /** Row key field: `id`, or `cardId` for savedCards. */
  key: 'id' | 'cardId';
}

const TABLES: TableSpec[] = [
  { field: 'markets', name: 'markets', key: 'id', columns: [] },
  { field: 'decks', name: 'decks', key: 'id', columns: [{ row: 'marketId', column: 'marketId' }] },
  { field: 'companies', name: 'companies', key: 'id', columns: [{ row: 'name', column: 'name' }] },
  {
    field: 'metrics', name: 'metrics', key: 'id',
    columns: [
      { row: 'companyId', column: 'companyId' },
      { row: 'metricType', column: 'metricType' },
      { row: 'value', column: 'value' },
      { row: 'confidence', column: 'confidence' },
    ],
  },
  {
    field: 'cards', name: 'cards', key: 'id',
    columns: [
      { row: 'deckId', column: 'deckId' },
      { row: 'companyId', column: 'companyId' },
      { row: 'cardType', column: 'cardType' },
    ],
  },
  { field: 'viceClaims', name: 'vice_claims', key: 'id', columns: [{ row: 'cardId', column: 'cardId' }] },
  { field: 'reports', name: 'reports', key: 'id', columns: [{ row: 'subjectId', column: 'subjectId' }] },
  {
    field: 'briefings', name: 'briefings', key: 'id',
    columns: [
      { row: 'marketId', column: 'marketId' },
      { row: 'deckId', column: 'deckId' },
    ],
  },
  { field: 'savedCards', name: 'saved_cards', key: 'cardId', columns: [{ row: 'savedAt', column: 'savedAt' }] },
  {
    field: 'researchJobs', name: 'research_jobs', key: 'id',
    columns: [{ row: 'status', column: 'status' }],
  },
  { field: 'threads', name: 'threads', key: 'id', columns: [] },
  {
    field: 'researchEvidence', name: 'research_evidence', key: 'id',
    columns: [
      { row: 'companyId', column: 'companyId' },
      { row: 'topic', column: 'topic' },
      { row: 'capturedAt', column: 'capturedAt' },
    ],
  },
  {
    field: 'originalSourceAttempts', name: 'original_source_attempts', key: 'id',
    columns: [{ row: 'companyId', column: 'companyId' }],
  },
];

const RECORD_FIELDS = ['dashboards', 'companyMarket', 'opportunity'] as const;

interface CachedRow { key: string; json: string; ord: number }

/** SQLite-backed ResearchStore, or null when this runtime lacks node:sqlite. */
export function createSqliteStore(file: string): ResearchStore | null {
  if (!nodeSqlite) return null;
  const dbPath = file.replace(/\.[^.]+$/, '') + '.sqlite';
  try {
    return new SqliteStore(dbPath, file);
  } catch (error) {
    // An unopenable database (locked by another process, unreadable directory)
    // must not take research down: the caller falls back to the JSON store.
    // A silent fallback here would look exactly like lost research, so the
    // reason goes to the log even though the app keeps running.
    console.error(`SQLite research store unavailable (${dbPath}); using the JSON store instead.`, error);
    return null;
  }
}

class SqliteStore implements ResearchStore {
  private readonly db: SqliteDatabase;
  private readonly cache = new Map<string, Map<string, CachedRow>>();

  constructor(dbPath: string, jsonSource: string) {
    this.db = new nodeSqlite!.DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.migrate();
    this.importFromJsonIfEmpty(jsonSource);
    // The cache must reflect the DATABASE, not just what this instance wrote:
    // repositories are re-created on settings changes, and a cache that starts
    // empty would miss deletions made before the swap (deleted rows would
    // resurrect on the next read).
    for (const table of TABLES) this.reloadCache(table);
  }

  /** Rebuild the per-row change-detection cache from database truth. */
  private reloadCache(table: TableSpec): void {
    const keyColumn = table.key === 'cardId' ? 'cardId' : 'id';
    const rows = this.db.prepare(`SELECT ${keyColumn} AS key, json, ord FROM ${table.name}`).all() as
      { key: string; json: string; ord: number }[];
    const cache = new Map<string, CachedRow>();
    for (const row of rows) cache.set(row.key, { key: row.key, json: row.json, ord: row.ord });
    this.cache.set(table.name, cache);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    for (const table of TABLES) {
      const keyColumn = table.key === 'cardId' ? 'cardId' : 'id';
      const columns = [`ord INTEGER NOT NULL`, `${keyColumn} TEXT NOT NULL`, 'json TEXT NOT NULL',
        ...table.columns.map(({ column }) => `${column} TEXT`),
        'PRIMARY KEY (' + keyColumn + ')'].join(', ');
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${table.name} (${columns});`);
      this.cache.set(table.name, new Map());
    }
  }

  /** One-time import: an empty database adopts the JSON store's snapshot.
   * meta stays unset when there is nothing to import — an uninitialized store
   * must read as null so the caller's sample-seed flow still runs. */
  private importFromJsonIfEmpty(jsonSource: string): void {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('snapshotSchemaVersion') as { value: string } | undefined;
    if (row) return; // already initialized; a future version is refused on read
    if (!existsSync(jsonSource)) return;
    const snapshot = parseResearchExport(readFileSync(jsonSource, 'utf8'));
    this.replaceAll(snapshot);
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('snapshotSchemaVersion', String(snapshot.schemaVersion ?? REPO_SCHEMA_VERSION));
  }

  private rowKey(table: TableSpec, row: Record<string, unknown>): string {
    const key = row[table.key];
    if (typeof key !== 'string' || !key) throw new Error(`A ${table.field} row is missing its ${table.key}.`);
    return key;
  }

  private columnValues(table: TableSpec, row: Record<string, unknown>): (string | number | null)[] {
    return table.columns.map(({ row: field }) => {
      const value = row[field];
      if (value === undefined || value === null) return null;
      if (typeof value === 'string' || typeof value === 'number') return value;
      return String(value);
    });
  }

  /** Replace every row (one-time import path). */
  private replaceAll(snapshot: RepoSnapshot): void {
    const write = this.db.prepare('BEGIN');
    try {
      write.run();
      for (const table of TABLES) {
        this.db.exec(`DELETE FROM ${table.name};`);
        this.cache.set(table.name, new Map());
        const rows = snapshot[table.field] as readonly Record<string, unknown>[] | undefined;
        (rows ?? []).forEach((row, index) => this.upsertRow(table, row, index));
      }
      this.writeRecords(snapshot);
      this.db.exec('COMMIT;');
    } catch (error) {
      try { this.db.exec('ROLLBACK;'); } catch { /* connection-level failure; the transaction is already gone */ }
      throw error;
    }
  }

  private upsertRow(table: TableSpec, row: Record<string, unknown>, ord: number): void {
    const key = this.rowKey(table, row);
    const json = JSON.stringify(row);
    const cached = this.cache.get(table.name)!.get(key);
    if (cached && cached.json === json && cached.ord === ord) return;
    const keyColumn = table.key === 'cardId' ? 'cardId' : 'id';
    const columnNames = ['ord', keyColumn, 'json', ...table.columns.map(({ column }) => column)];
    const sql = `INSERT INTO ${table.name} (${columnNames.join(', ')})
      VALUES (${columnNames.map(() => '?').join(', ')})
      ON CONFLICT(${keyColumn}) DO UPDATE SET ord = excluded.ord, json = excluded.json${table.columns.map(({ column }) => `, ${column} = excluded.${column}`).join('')};`;
    this.db.prepare(sql).run(ord, key, json, ...this.columnValues(table, row));
    this.cache.get(table.name)!.set(key, { key, json, ord });
  }

  private writeRecords(snapshot: RepoSnapshot): void {
    const upsert = this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;');
    for (const field of RECORD_FIELDS) {
      upsert.run(field, JSON.stringify(snapshot[field] ?? {}));
    }
    upsert.run('schemaVersion', String(snapshot.schemaVersion ?? REPO_SCHEMA_VERSION));
  }

  read(): RepoSnapshot | null {
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM meta').get() as { n: number };
    if (count.n === 0) return null;
    // A future-format snapshot is refused the same way the file store refuses
    // one: never silently serve stale rows from an older reader.
    const version = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('snapshotSchemaVersion') as { value: string } | undefined;
    if (version && Number.isSafeInteger(Number(version.value)) && Number(version.value) > REPO_SCHEMA_VERSION) {
      throw new Error('This research was saved by a newer Stratemark version. Please upgrade.');
    }
    const snapshot = { schemaVersion: REPO_SCHEMA_VERSION } as Record<string, unknown>;
    for (const table of TABLES) {
      const keyColumn = table.key === 'cardId' ? 'cardId' : 'id';
      const rows = this.db.prepare(`SELECT json FROM ${table.name} ORDER BY ord ASC, ${keyColumn} ASC`).all() as { json: string }[];
      snapshot[table.field] = rows.map(({ json }) => JSON.parse(json));
    }
    for (const field of RECORD_FIELDS) {
      const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(field) as { value: string } | undefined;
      snapshot[field] = row ? JSON.parse(row.value) : {};
    }
    const kvVersion = this.db.prepare('SELECT value FROM kv WHERE key = ?').get('schemaVersion') as { value: string } | undefined;
    if (kvVersion) snapshot.schemaVersion = Number(kvVersion.value);
    return parseResearchExport(JSON.stringify(snapshot));
  }

  private lastDataVersion = -1;

  write(snapshot: RepoSnapshot): void {
    // Rows must be a valid snapshot BEFORE any rows move; a bad write leaves
    // the previous state fully intact, matching the file store's guarantees.
    // The five core arrays are the snapshot's backbone: a writer that omits
    // one is broken, and silently treating it as empty would wipe real data.
    for (const field of ['markets', 'decks', 'companies', 'metrics', 'cards'] as const) {
      const rows = snapshot[field];
      if (!Array.isArray(rows)) throw new Error(`Invalid ${field}`);
    }
    for (const table of TABLES) {
      const rows = snapshot[table.field];
      if (rows !== undefined && !Array.isArray(rows)) throw new Error(`Invalid ${table.field}`);
    }
    // Another app instance may have written since our last write; a stale
    // cache would miss its deletions. data_version changes on any foreign
    // write, so resync from database truth before computing changes.
    const dataVersion = (this.db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
    if (dataVersion !== this.lastDataVersion) {
      for (const table of TABLES) this.reloadCache(table);
      this.lastDataVersion = dataVersion;
    }
    const transaction = this.db.prepare('BEGIN');
    try {
      transaction.run();
      for (const table of TABLES) {
        const rows = (snapshot[table.field] ?? []) as readonly Record<string, unknown>[];
        const seen = new Set<string>();
        rows.forEach((row, index) => {
          const key = this.rowKey(table, row);
          seen.add(key);
          this.upsertRow(table, row, index);
        });
        // Rows removed from the snapshot are removed from the store; the id
        // cache makes this O(removed) instead of O(table).
        const cached = this.cache.get(table.name)!;
        const deletions = [...cached.values()].filter((row) => !seen.has(row.key));
        if (deletions.length) {
          const keyColumn = table.key === 'cardId' ? 'cardId' : 'id';
          const remove = this.db.prepare(`DELETE FROM ${table.name} WHERE ${keyColumn} = ?`);
          for (const row of deletions) remove.run(row.key);
          for (const row of deletions) cached.delete(row.key);
        }
      }
      this.writeRecords(snapshot);
      this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;')
        .run('snapshotSchemaVersion', String(snapshot.schemaVersion ?? REPO_SCHEMA_VERSION));
      this.db.exec('COMMIT;');
      this.lastDataVersion = (this.db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
    } catch (error) {
      try { this.db.exec('ROLLBACK;'); } catch { /* connection-level failure; the transaction is already gone */ }
      throw error;
    }
  }
}
