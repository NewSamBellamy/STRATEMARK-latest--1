import { AnotherWindowError, migrateSnapshot, isOriginalSourceAttempt, siftSignalBriefs, REPO_SCHEMA_VERSION, type RepoSnapshot, type ResearchStore } from '@mi/research';

const LEGACY = 'mi.repo.v1';
const CURRENT = `${LEGACY}.committed`;
const BACKUP = `${CURRENT}.backup`;
/**
 * A saved revision. New saves hold the workspace JSON gzip-compressed (gz):
 * Chromium refuses any single IndexedDB value over about 133 MB, and a JSON
 * string counts double (UTF-16), so a workspace of about twenty decks (66.6M
 * characters) could no longer be saved at all. Compressed it is a tenth of
 * that. Revisions saved before compression hold the plain JSON (json) and stay
 * readable; each is replaced by a compressed one on the next save.
 */
type RecordValue = { json?: string; gz?: ArrayBuffer; revision: number; at: number };

/** One plain sentence for a workspace the browser cannot read; the recovery controls explain the rest. */
export const DAMAGED_MESSAGE = 'Your saved research is unreadable, so it was not opened.';

/** The saved workspace is damaged. Distinct from a refused or failed save, so the screen can offer a copy and a fresh start. */
export class DamagedResearchError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(DAMAGED_MESSAGE, options);
    this.name = 'DamagedResearchError';
  }
}

/** A save was refused because the in-memory snapshot is invalid. The saved workspace was read fine, so this must never
 * open the damaged-workspace panel (which offers to replace it). Same message as before. */
export class RefusedWriteError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(DAMAGED_MESSAGE, options);
    this.name = 'RefusedWriteError';
  }
}

const compressed = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function drain(stream: ReadableStream<Uint8Array>, chunk: (bytes: Uint8Array) => void): Promise<void> {
  const reader = stream.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) chunk(next.value);
}

/** The record to save for this JSON: compressed where the browser can, plain otherwise. */
async function encode(json: string, revision: number): Promise<RecordValue> {
  if (!compressed()) return { json, revision, at: Date.now() };
  const gzip = new CompressionStream('gzip');
  const writer = gzip.writable.getWriter();
  const written = writer.write(new TextEncoder().encode(json)).then(() => writer.close());
  const parts: Uint8Array[] = [];
  let size = 0;
  await Promise.all([written, drain(gzip.readable, (bytes) => { parts.push(bytes); size += bytes.byteLength; })]);
  const gz = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { gz.set(part, at); at += part.byteLength; }
  return { gz: gz.buffer, revision, at: Date.now() };
}

/** The JSON a saved record holds; throws when the record is damaged, never returns an empty workspace for it. */
async function decode(record: RecordValue): Promise<string> {
  if (typeof record.json === 'string') return record.json;
  if (Object.prototype.toString.call(record.gz) !== '[object ArrayBuffer]') throw new DamagedResearchError();
  if (!compressed()) throw new Error('This browser cannot open compressed research. Update it to continue; nothing has been overwritten.');
  try {
    const gunzip = new DecompressionStream('gzip');
    const writer = gunzip.writable.getWriter();
    const written = writer.write(new Uint8Array(record.gz!)).then(() => writer.close());
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const text: string[] = [];
    await Promise.all([written, drain(gunzip.readable, (bytes) => { text.push(decoder.decode(bytes, { stream: true })); })]);
    text.push(decoder.decode());
    return text.join('');
  } catch (cause) {
    throw new DamagedResearchError({ cause });
  }
}

/** A record's JSON, or null when there is no record. */
const jsonOf = async (record: RecordValue | undefined) => record ? decode(record) : null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Research storage is unavailable. Your existing data has not been changed.'));
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open('stratemark.vault', 2);
    request.onupgradeneeded = () => {
      for (const name of ['snapshots', 'images']) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(new Error('Research storage could not be opened.', { cause: request.error }));
    request.onblocked = () => { blocked = true; reject(new Error('Research storage is blocked. Close older Stratemark windows and retry.')); };
  });
}

export function parseResearchSnapshot(json: string): RepoSnapshot {
  try {
    const snapshot = validResearchSnapshot(JSON.parse(json) as RepoSnapshot);
    // Briefs of signal cards are untrusted rows: keep the well-formed ones, drop the rest (never a reason to refuse the workspace).
    if (snapshot.signalBriefs !== undefined) snapshot.signalBriefs = siftSignalBriefs(snapshot.signalBriefs);
    return snapshot;
  } catch (cause) {
    throw new DamagedResearchError({ cause });
  }
}

/** Shape checks only. Writes validate the object they serialize: re-parsing a
 * multi-megabyte JSON string they just produced cost a full parse per save. */
function validResearchSnapshot(snapshot: RepoSnapshot): RepoSnapshot {
  if (!snapshot || !Array.isArray(snapshot.markets) || !Array.isArray(snapshot.decks) ||
      !Array.isArray(snapshot.companies) || !Array.isArray(snapshot.cards) || !Array.isArray(snapshot.metrics)) {
      throw new Error('Invalid research workspace');
    }
    const object = (value: unknown) => value != null && typeof value === 'object' && !Array.isArray(value);
    if (snapshot.schemaVersion !== undefined && (!Number.isSafeInteger(snapshot.schemaVersion) || snapshot.schemaVersion < 1)) throw new Error('Invalid version');
    for (const field of ['markets', 'decks', 'companies', 'cards', 'metrics', 'viceClaims', 'reports', 'briefings', 'savedCards', 'researchJobs', 'threads', 'researchEvidence', 'originalSourceAttempts'] as const) {
      const rows = snapshot[field];
      if (rows !== undefined && (!Array.isArray(rows) || rows.some((row: unknown) => !object(row)))) throw new Error(`Invalid ${field}`);
    }
    for (const field of ['dashboards', 'companyMarket', 'opportunity'] as const) {
      if (snapshot[field] !== undefined && !object(snapshot[field])) throw new Error(`Invalid ${field}`);
    }
    if (snapshot.originalSourceAttempts?.some(row => !isOriginalSourceAttempt(row)) ||
      new Set(snapshot.originalSourceAttempts?.map(row => row.id)).size !== (snapshot.originalSourceAttempts?.length ?? 0)) throw new Error('Invalid original-source attempts');
  return snapshot;
}

async function records(): Promise<Record<string, RecordValue | undefined>> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readonly');
    const found: Record<string, RecordValue | undefined> = {};
    for (const key of [CURRENT, BACKUP, LEGACY]) {
      const request = tx.objectStore('snapshots').get(key);
      request.onsuccess = () => { found[key] = request.result as RecordValue | undefined; };
    }
    tx.oncomplete = () => { db.close(); resolve(found); };
    tx.onabort = () => { db.close(); reject(new Error('Research storage could not be read.', { cause: tx.error })); };
  });
}

/** Prepared asynchronously; read is a detached, acknowledged snapshot only. */
export async function openBrowserResearchStore(): Promise<ResearchStore> {
  const found = await records();
  const saved = found[CURRENT];
  if (saved && (!Number.isSafeInteger(saved.revision) || saved.revision < 1)) {
    throw new DamagedResearchError();
  }
  let revision = saved?.revision ?? 0;
  let committed = (await jsonOf(saved)) ?? localStorage.getItem(LEGACY) ?? (await jsonOf(found[LEGACY])) ?? null;
  // The committed revision is stored uncompressed (saved before compression, or not yet in IndexedDB at all).
  let plainOnDisk = !saved?.gz;
  const initial = committed ? parseResearchSnapshot(committed) : null;
  const future = (initial?.schemaVersion ?? 1) > REPO_SCHEMA_VERSION;
  let queue = Promise.resolve();
  // The newest valid write that has not started committing. A mutation burst
  // (one save per agent step) otherwise queues a full multi-megabyte
  // transaction per step; a later write instead replaces this payload and
  // shares its acknowledgement, so each caller still resolves only once a
  // revision containing its snapshot is durable, and rejects if that fails.
  let pending: { json: string; done: Promise<void> } | null = null;

  async function commit(json: string): Promise<void> {
    // Compressed before the transaction opens: a transaction left waiting on other work commits early.
    let next: RecordValue;
    let backup: RecordValue | null;
    try {
      next = await encode(json, revision + 1);
      // An uncompressed revision becomes a compressed backup: copied as it is, one near the
      // per-record limit could fail the save that is meant to rescue it.
      backup = plainOnDisk && committed ? await encode(committed, revision) : null;
    } catch (cause) {
      throw new Error('Research was not saved. The browser could not prepare it; previous saved research is intact.', { cause });
    }
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite');
      const store = tx.objectStore('snapshots');
      const current = store.get(CURRENT);
      let failure: Error | undefined;
      current.onsuccess = () => {
        const previous = current.result as RecordValue | undefined;
        if ((previous?.revision ?? 0) !== revision) {
          failure = new AnotherWindowError();
          tx.abort();
          return;
        }
        // Backup and current are one transaction: neither can be partially replaced.
        if (backup) store.put(backup, BACKUP);
        else if (previous) store.put(previous, BACKUP);
        store.put(next, CURRENT);
      };
      tx.oncomplete = () => { revision += 1; committed = json; plainOnDisk = !next.gz; db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(failure ?? new Error('Research was not saved. Storage may be full or unavailable; previous saved research is intact.', { cause: tx.error })); };
    });
  }

  return {
    read: () => committed ? parseResearchSnapshot(committed) : null,
    write(snapshot) {
      // Capture now, before queued writes or caller mutations can change this revision.
      const json = JSON.stringify(snapshot);
      const version = snapshot.schemaVersion ?? 1;
      let invalid: unknown;
      try { validResearchSnapshot(snapshot); } catch (cause) { invalid = cause; }
      const refusal = future || version > REPO_SCHEMA_VERSION
        ? new Error('This research uses a newer version of Stratemark. Update before saving.')
        : invalid !== undefined
          ? new RefusedWriteError({ cause: invalid })
          : null;
      if (refusal) {
        // A refused write keeps its own place in the queue and never merges with a valid one.
        const refused = queue.then(() => { throw refusal; });
        pending = null;
        queue = refused.catch(() => {});
        return refused;
      }
      if (pending) {
        pending.json = json;
        return pending.done;
      }
      const batch = { json, done: Promise.resolve() };
      batch.done = queue.then(() => {
        // From here on this payload is final; newer writes queue behind it.
        if (pending === batch) pending = null;
        return commit(batch.json);
      });
      pending = batch;
      queue = batch.done.catch(() => {});
      return batch.done;
    },
  };
}

export async function readBrowserResearchData(): Promise<{ current: string | null; backup: string | null }> {
  const found = await records();
  return {
    current: (await jsonOf(found[CURRENT])) ?? localStorage.getItem(LEGACY) ?? (await jsonOf(found[LEGACY])) ?? null,
    // A damaged backup must not block viewing or exporting a healthy current workspace.
    backup: found[BACKUP] ? await jsonOf(found[BACKUP]).catch(() => null) : localStorage.getItem(`${LEGACY}.backup`),
  };
}

/** What is stored for a damaged workspace, exactly as stored: its text, or its raw bytes when even the compression is broken. */
export type DamagedResearch = { text: string | null; bytes: Uint8Array | null };

async function rawOf(record: RecordValue): Promise<DamagedResearch> {
  if (typeof record.json === 'string') return { text: record.json, bytes: null };
  if (Object.prototype.toString.call(record.gz) === '[object ArrayBuffer]') {
    try { return { text: await decode(record), bytes: null }; } catch { return { text: null, bytes: new Uint8Array(record.gz!) }; }
  }
  try { return { text: JSON.stringify(record) ?? null, bytes: null }; } catch { return { text: null, bytes: null }; }
}

/** The stored data the app would have opened (the same order as openBrowserResearchStore). Read only: nothing is changed. */
export async function readDamagedResearch(): Promise<DamagedResearch | null> {
  const found = await records();
  if (found[CURRENT]) return rawOf(found[CURRENT]);
  const legacy = localStorage.getItem(LEGACY);
  if (legacy !== null) return { text: legacy, bytes: null };
  return found[LEGACY] ? rawOf(found[LEGACY]) : null;
}

/** Where a damaged workspace is kept when the person starts over. Never read by the app, never deleted by it. */
export const DAMAGED_BACKUP_PREFIX = `${LEGACY}.damaged-backup`;

/**
 * Moves the damaged workspace to backup keys and leaves no saved workspace, so the next open is empty.
 * Every copy is written and checked before anything is removed; a failure leaves the original in place.
 * Only ever called from an explicit, confirmed click.
 */
export async function setDamagedResearchAside(now: number = Date.now()): Promise<string> {
  const stamp = `${DAMAGED_BACKUP_PREFIX}.${new Date(now).toISOString().replace(/[:.]/g, '-')}`;
  const legacy = localStorage.getItem(LEGACY);
  // A big legacy value can be over the localStorage quota for a second copy: then the copy goes to IndexedDB instead,
  // in the same transaction as the other records. The original is removed only after one verified copy exists.
  let legacyInIndexedDb = false;
  if (legacy !== null) {
    try {
      localStorage.setItem(`${stamp}.localStorage`, legacy);
      if (localStorage.getItem(`${stamp}.localStorage`) !== legacy) throw new Error('The copy could not be verified.');
    } catch {
      try { localStorage.removeItem(`${stamp}.localStorage`); } catch { /* nothing to clean */ }
      legacyInIndexedDb = true;
    }
  }
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite');
      const store = tx.objectStore('snapshots');
      if (legacyInIndexedDb && legacy !== null) store.put({ json: legacy, at: now }, `${stamp}.localStorage`);
      for (const key of [CURRENT, BACKUP, LEGACY]) {
        const request = store.get(key);
        request.onsuccess = () => {
          if (request.result === undefined) return;
          store.put(request.result, `${stamp}.${key}`);
          store.delete(key);
        };
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error('The copy could not be saved, so nothing was changed.', { cause: tx.error }));
    });
  } finally {
    db.close();
  }
  if (legacy !== null) localStorage.removeItem(LEGACY);
  return stamp;
}

export async function installBrowserResearch(json: string): Promise<number> {
  const incoming = parseResearchSnapshot(json);
  if ((incoming.schemaVersion ?? 1) > REPO_SCHEMA_VERSION) throw new Error('This export requires a newer version of Stratemark.');
  const store = await openBrowserResearchStore();
  const active = store.read()?.researchJobs?.some((job) => job.status === 'running' || job.status === 'queued');
  if (active) throw new Error('Stop active research before replacing this workspace.');
  await store.write(migrateSnapshot(incoming).snapshot);
  return incoming.markets.length;
}
