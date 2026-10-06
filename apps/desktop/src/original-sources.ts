import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import type * as Sqlite from 'node:sqlite';
import { z } from 'zod';
import type { OriginalSourceServices } from '@mi/research';
import { coalesceOriginalSources, MAX_SEC_CONCEPT_TEXT, secRevenueCik, normalizeSourceText, validatedOriginalSupport } from '@mi/research';
import { retrieveOriginalSource } from '@mi/research/original-source-node';

const ID = /^src_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_FILE_BYTES = 128 * 1024;
const receiptSchema = z.object({
  requestedUrl: z.string().max(2048), finalUrl: z.string().max(2048).optional(),
  status: z.enum(['retrieved', 'blocked', 'unavailable']), retrievedAt: z.string().datetime(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), text: z.string().max(MAX_SEC_CONCEPT_TEXT).optional(),
  truncated: z.boolean().optional(), reason: z.string().max(256).optional(),
  format: z.literal('sec-companyconcept').optional(),
}).superRefine((receipt, ctx) => {
  if (receipt.format ? !secRevenueCik(receipt.finalUrl ?? '') || receipt.truncated === true
    : (receipt.text?.length ?? 0) > 4000) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid retained document format or limit' });
  if (receipt.status === 'retrieved' ? !receipt.text?.trim() || !receipt.contentHash || receipt.httpStatus !== 200
    : receipt.text !== undefined || receipt.contentHash !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid original-source outcome' });
  }
});
const attemptSchema = z.object({
  id: z.string().regex(ID), companyId: z.string().min(1).max(256), metricType: z.string().min(1).max(64),
  capturedAt: z.string().datetime(), receipts: z.array(receiptSchema).max(2),
});

// Serialize this workspace's SQLite/file publication inside one process. Other
// processes use SQLite's transactions/unique IDs; pending files are recoverable.
const workspaceWrites = new Map<string, Promise<unknown>>();
const INDEX_NAME = 'source-index.sqlite';
// Native-only require also supports tooling whose builtin list predates this
// prefix-only Node module. execPath is absolute; no user-selected module path.
const { DatabaseSync: SqliteDatabase } = createRequire(process.execPath)('node:sqlite') as typeof Sqlite;
type IndexEntry = { id: string; company_id: string; metric_type: string; captured_at: string; artifact_hash: string | null };

/** Owned userData directory only. Renderer cannot choose paths or invoke fetch. */
export function createOriginalSourceServices(directory: string): OriginalSourceServices {
  const root = path.resolve(directory);
  const readArtifact = async (id: string) => {
    if (!ID.test(id)) throw new Error('Invalid original source artifact identity.');
    const file = path.join(root, `${id}.json`);
    const info = await lstat(file);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('Unreadable original source artifact.');
    const json = await readFile(file, 'utf8');
    const record = attemptSchema.parse(JSON.parse(json));
    if (record.id !== id) throw new Error('Original source artifact identity mismatch.');
    return { record, hash: createHash('sha256').update(json).digest('hex') };
  };
  const completeIndex = (db: Sqlite.DatabaseSync, entry: IndexEntry, artifact: Awaited<ReturnType<typeof readArtifact>>) => {
    const { record, hash } = artifact;
    if (record.companyId !== entry.company_id || record.metricType !== entry.metric_type || record.capturedAt !== entry.captured_at ||
      entry.artifact_hash && entry.artifact_hash !== hash) throw new Error('Original source index/artifact mismatch.');
    db.prepare('UPDATE attempts SET artifact_hash=?, state=\'ready\' WHERE id=?').run(hash, record.id);
    record.receipts.forEach((receipt, ordinal) => {
      db.prepare('INSERT OR IGNORE INTO receipts VALUES(?,?,?,?,?,?,?)').run(record.id, ordinal, record.companyId,
        receipt.finalUrl ?? null, receipt.requestedUrl, receipt.status === 'retrieved' ? normalizeSourceText(receipt.text ?? '') : '', record.capturedAt);
    });
  };
  const indexed = <T>(work: (db: Sqlite.DatabaseSync) => Promise<T>): Promise<T> => {
    const previous = workspaceWrites.get(root) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      await mkdir(root, { recursive: true, mode: 0o700 });
      if ((await lstat(root)).isSymbolicLink()) throw new Error('Original source directory cannot be a symlink.');
      const file = path.join(root, INDEX_NAME);
      for (const suffix of ['', '-journal', '-wal', '-shm']) {
        try { if ((await lstat(file + suffix)).isSymbolicLink()) throw new Error('Original source index cannot be a symlink.'); }
        catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error; }
      }
      try { const handle = await open(file, 'wx', 0o600); await handle.close(); }
      catch (error) { if ((error as { code?: string }).code !== 'EEXIST') throw error; }
      const db = new SqliteDatabase(file, { timeout: 1000, allowExtension: false });
      try {
        db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
        const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > 1) throw new Error('Original source index was saved by a newer Stratemark version.');
        if (version === 0) {
          db.exec('BEGIN IMMEDIATE;');
          try {
          // Another process can finish migration while this one waits for the
          // write lock. Recheck inside the transaction, never from stale state.
          const lockedVersion = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
          if (lockedVersion > 1) throw new Error('Original source index was saved by a newer Stratemark version.');
          if (lockedVersion === 0) {
          db.exec(`
            CREATE TABLE attempts(id TEXT PRIMARY KEY, company_id TEXT NOT NULL, metric_type TEXT NOT NULL,
              captured_at TEXT NOT NULL, artifact_hash TEXT, state TEXT NOT NULL CHECK(state IN ('pending','ready'))) STRICT;
            CREATE INDEX company_time ON attempts(company_id, captured_at DESC, id DESC);
            CREATE INDEX company_metric_time ON attempts(company_id, metric_type, captured_at DESC, id DESC);
            CREATE TABLE receipts(attempt_id TEXT REFERENCES attempts(id), ordinal INTEGER, company_id TEXT,
              final_url TEXT, requested_url TEXT, text TEXT, captured_at TEXT, PRIMARY KEY(attempt_id,ordinal)) STRICT;
            CREATE INDEX final_source ON receipts(company_id,final_url);
            CREATE INDEX requested_source ON receipts(company_id,requested_url);`);
            // One acknowledged, rollback-safe migration. Keep all legacy files.
            for (const filename of await readdir(root)) {
              const id = filename.endsWith('.json') ? filename.slice(0, -5) : '';
              if (!ID.test(id)) continue;
              const artifact = await readArtifact(id), record = artifact.record;
              db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,\'pending\')').run(id, record.companyId, record.metricType, record.capturedAt, null);
              completeIndex(db, { id, company_id: record.companyId, metric_type: record.metricType, captured_at: record.capturedAt, artifact_hash: null }, artifact);
            }
            db.exec('PRAGMA user_version=1;');
          }
            db.exec('COMMIT;');
          } catch (error) { db.exec('ROLLBACK;'); throw error; }
        }
        // A crash after file publication cannot orphan its supporting record.
        // Missing pending files may belong to another live writer: don't delete.
        for (const pending of db.prepare('SELECT * FROM attempts WHERE state=\'pending\'').all() as IndexEntry[]) {
          let artifact;
          try { artifact = await readArtifact(pending.id); }
          catch (error) { if ((error as { code?: string }).code === 'ENOENT') continue; throw error; }
          db.exec('BEGIN IMMEDIATE;');
          try { completeIndex(db, pending, artifact); db.exec('COMMIT;'); }
          catch (error) { db.exec('ROLLBACK;'); throw error; }
        }
        return await work(db);
      } finally { db.close(); }
    });
    workspaceWrites.set(root, next);
    void next.finally(() => { if (workspaceWrites.get(root) === next) workspaceWrites.delete(root); }).catch(() => {});
    return next;
  };
  return {
    retrieve: coalesceOriginalSources((url, scope) => retrieveOriginalSource(url, undefined, scope)),
    async save(attempt) {
      const record = attemptSchema.parse(attempt);
      const json = JSON.stringify(record);
      if (Buffer.byteLength(json, 'utf8') > MAX_FILE_BYTES) throw new Error('Original source artifact exceeds size limit.');
      await indexed(async db => {
        // Reserve identity first. Neither a parallel writer nor a restart can
        // acknowledge an incomplete file as ready.
        db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,\'pending\')').run(record.id, record.companyId, record.metricType, record.capturedAt, null);
        const temp = path.join(root, `${record.id}.${randomUUID()}.tmp`);
        const file = path.join(root, `${record.id}.json`);
        try {
          const handle = await open(temp, 'wx', 0o600);
          try { await handle.writeFile(json, 'utf8'); await handle.sync(); } finally { await handle.close(); }
          // Publish a complete file atomically, refusing any existing artifact ID.
          await link(temp, file);
        } catch (error) {
          db.prepare('DELETE FROM attempts WHERE id=? AND state=\'pending\'').run(record.id);
          throw error;
        } finally { await unlink(temp).catch(() => {}); }
        db.exec('BEGIN IMMEDIATE;');
        try {
          completeIndex(db, { id: record.id, company_id: record.companyId, metric_type: record.metricType,
            captured_at: record.capturedAt, artifact_hash: null }, await readArtifact(record.id));
          db.exec('COMMIT;');
        } catch (error) { db.exec('ROLLBACK;'); throw error; }
      });
    },
    async list(input) {
      if (!input.companyId) return [];
      const refs = validatedOriginalSupport(input.support);
      const limit = Number.isFinite(input.limit) ? Math.min(20, Math.max(1, Math.floor(input.limit!))) : 4;
      return indexed(async db => {
        const filter = input.metricType ? ' AND metric_type=?' : '';
        const values = input.metricType ? [input.companyId, input.metricType, limit] : [input.companyId, limit];
        const entries = db.prepare(`SELECT * FROM attempts WHERE company_id=? AND state='ready'${filter} ORDER BY captured_at DESC,id DESC LIMIT ?`).all(...values) as IndexEntry[];
        for (const ref of refs) {
          const entry = db.prepare(`SELECT a.* FROM receipts r JOIN attempts a ON a.id=r.attempt_id
            WHERE r.company_id=? AND a.company_id=? AND a.state='ready' AND (r.final_url=? OR r.requested_url=?)
            AND instr(r.text,?)>0${input.metricType ? ' AND a.metric_type=?' : ''}
            ORDER BY a.captured_at DESC,a.id DESC LIMIT 1`).get(input.companyId, input.companyId, ref.sourceUrl, ref.sourceUrl,
              normalizeSourceText(ref.quote), ...(input.metricType ? [input.metricType] : [])) as IndexEntry | undefined;
          if (entry && !entries.some(row => row.id === entry.id)) entries.push(entry);
        }
        return Promise.all(entries.map(async entry => {
          const artifact = await readArtifact(entry.id);
          if (artifact.record.companyId !== input.companyId || artifact.hash !== entry.artifact_hash ||
            artifact.record.metricType !== entry.metric_type || artifact.record.capturedAt !== entry.captured_at) throw new Error('Original source index/artifact mismatch.');
          return artifact.record;
        }));
      });
    },
  };
}
