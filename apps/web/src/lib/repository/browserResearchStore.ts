import { MAX_IMPORT_CHARS, ImportRefusedError, migrateSnapshot, prepareImportedSnapshot, isOriginalSourceAttempt, REPO_SCHEMA_VERSION, type ImportPlan, type RepoSnapshot, type ResearchStore } from '@mi/research';

const LEGACY = 'mi.repo.v1';
const CURRENT = `${LEGACY}.committed`;
const BACKUP = `${CURRENT}.backup`;
/**
 * The research a person had when they last imported a file. BACKUP is the
 * revision before the latest save, so it stops being their research after one
 * save in the imported workspace (opening an imported deck is enough). This
 * record is written when an import is installed and by nothing else, except
 * that restoring it, or the next import, replaces or removes it.
 */
const BEFORE_IMPORT = `${CURRENT}.before-import`;
/**
 * A saved revision. New saves hold the workspace JSON gzip-compressed (gz):
 * Chromium refuses any single IndexedDB value over about 133 MB, and a JSON
 * string counts double (UTF-16), so a workspace of about twenty decks (66.6M
 * characters) could no longer be saved at all. Compressed it is a tenth of
 * that. Revisions saved before compression hold the plain JSON (json) and stay
 * readable; each is replaced by a compressed one on the next save.
 */
type RecordValue = { json?: string; gz?: ArrayBuffer; revision: number; at: number };

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
  if (Object.prototype.toString.call(record.gz) !== '[object ArrayBuffer]') throw new Error('Your saved research is unreadable. Nothing has been overwritten.');
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
    throw new Error('Your saved research is unreadable. Nothing has been overwritten.', { cause });
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
    return validResearchSnapshot(JSON.parse(json) as RepoSnapshot);
  } catch (cause) {
    throw new Error('Your saved research is unreadable. Export or recover it before continuing; nothing has been overwritten.', { cause });
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
    for (const key of [CURRENT, BACKUP, BEFORE_IMPORT, LEGACY]) {
      const request = tx.objectStore('snapshots').get(key);
      request.onsuccess = () => { found[key] = request.result as RecordValue | undefined; };
    }
    tx.oncomplete = () => { db.close(); resolve(found); };
    tx.onabort = () => { db.close(); reject(new Error('Research storage could not be read.', { cause: tx.error })); };
  });
}

/** How `replace` treats the workspace it replaces. */
interface ReplaceMode {
  /** Keep the replaced workspace as the research from before an import (an import does). */
  keepPrevious?: boolean;
  /** The research from before an import was just restored: it is spent, so it is removed. */
  dropBeforeImport?: boolean;
}

export interface BrowserResearchStore extends ResearchStore {
  /** Replaces the whole workspace in one transaction, with the replaced one handled as `mode` says. */
  replace(snapshot: RepoSnapshot, mode: ReplaceMode): Promise<void>;
}

/** True when this saved workspace holds at least one deck. */
function hasDecks(json: string | null): boolean {
  if (json === null) return false;
  try {
    const markets = (JSON.parse(json) as { markets?: unknown }).markets;
    return Array.isArray(markets) && markets.length > 0;
  } catch {
    return false;
  }
}

/**
 * Prepared asynchronously; read is a detached, acknowledged snapshot only.
 *
 * `recovering` is for replacing a workspace that cannot be read: it opens one
 * anyway, as empty, and the unreadable record becomes the backup on the next
 * save instead of blocking it. Only the restore on the start-up recovery screen
 * asks for it.
 */
export async function openBrowserResearchStore(options: { recovering?: boolean } = {}): Promise<BrowserResearchStore> {
  const found = await records();
  const saved = found[CURRENT];
  if (saved && (!Number.isSafeInteger(saved.revision) || saved.revision < 1)) {
    throw new Error('Your saved research is unreadable. Nothing has been overwritten.');
  }
  let revision = saved?.revision ?? 0;
  let committed: string | null;
  let initial: RepoSnapshot | null;
  try {
    committed = (await jsonOf(saved)) ?? localStorage.getItem(LEGACY) ?? (await jsonOf(found[LEGACY])) ?? null;
    initial = committed ? parseResearchSnapshot(committed) : null;
  } catch (cause) {
    if (!options.recovering) throw cause;
    committed = null;
    initial = null;
  }
  // The committed revision is stored uncompressed (saved before compression, or not yet in IndexedDB at all).
  let plainOnDisk = !saved?.gz;
  const future = (initial?.schemaVersion ?? 1) > REPO_SCHEMA_VERSION;
  let queue = Promise.resolve();
  // The newest valid write that has not started committing. A mutation burst
  // (one save per agent step) otherwise queues a full multi-megabyte
  // transaction per step; a later write instead replaces this payload and
  // shares its acknowledgement, so each caller still resolves only once a
  // revision containing its snapshot is durable, and rejects if that fails.
  let pending: { json: string; done: Promise<void> } | null = null;

  async function commit(json: string, mode: ReplaceMode = {}): Promise<void> {
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
    // A workspace with no decks is not worth keeping over the copy of one that has them.
    const keepsDecks = mode.keepPrevious === true && hasDecks(committed);
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite');
      const store = tx.objectStore('snapshots');
      const current = store.get(CURRENT);
      let failure: Error | undefined;
      current.onsuccess = () => {
        const previous = current.result as RecordValue | undefined;
        if ((previous?.revision ?? 0) !== revision) {
          failure = new Error('Research was updated in another window. Reload before making changes.');
          tx.abort();
          return;
        }
        // Backup and current are one transaction: neither can be partially replaced.
        if (backup) store.put(backup, BACKUP);
        else if (previous) store.put(previous, BACKUP);
        // The same transaction keeps the research this import replaces where no ordinary save reaches it.
        if (mode.keepPrevious && keepsDecks) store.put(backup ?? previous, BEFORE_IMPORT);
        if (mode.dropBeforeImport) store.delete(BEFORE_IMPORT);
        store.put(next, CURRENT);
      };
      tx.oncomplete = () => { revision += 1; committed = json; plainOnDisk = !next.gz; db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(failure ?? new Error('Research was not saved. Storage may be full or unavailable; previous saved research is intact.', { cause: tx.error })); };
    });
  }

  /** Why this snapshot cannot be saved, or null. */
  function refusalFor(snapshot: RepoSnapshot): Error | null {
    const version = snapshot.schemaVersion ?? 1;
    let invalid: unknown;
    try { validResearchSnapshot(snapshot); } catch (cause) { invalid = cause; }
    return future || version > REPO_SCHEMA_VERSION
      ? new Error('This research uses a newer version of Stratemark. Update before saving.')
      : invalid !== undefined
        ? new Error('Your saved research is unreadable. Export or recover it before continuing; nothing has been overwritten.', { cause: invalid })
        : null;
  }

  return {
    read: () => committed ? parseResearchSnapshot(committed) : null,
    replace(snapshot, mode) {
      const json = JSON.stringify(snapshot);
      const refusal = refusalFor(snapshot);
      // Alone in its transaction, and later writes queue behind it rather than into an earlier batch.
      pending = null;
      const done = queue.then(() => { if (refusal) throw refusal; return commit(json, mode); });
      queue = done.catch(() => {});
      return done;
    },
    write(snapshot) {
      // Capture now, before queued writes or caller mutations can change this revision.
      const json = JSON.stringify(snapshot);
      const refusal = refusalFor(snapshot);
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

/**
 * The saved research, its backup and the research from before the last import,
 * as the text they were saved as.
 * `tolerateUnreadable` is for the recovery screen: a current workspace that
 * cannot be opened reads as none, and says so, so the backup beside it can still be offered.
 */
export async function readBrowserResearchData(options: { tolerateUnreadable?: boolean } = {}): Promise<{ current: string | null; backup: string | null; beforeImport: string | null; unreadable?: boolean }> {
  const found = await records();
  let current: string | null;
  let unreadable = false;
  try {
    current = (await jsonOf(found[CURRENT])) ?? localStorage.getItem(LEGACY) ?? (await jsonOf(found[LEGACY])) ?? null;
  } catch (cause) {
    if (!options.tolerateUnreadable) throw cause;
    current = null;
    unreadable = true;
  }
  return {
    current,
    // A damaged backup must not block viewing or exporting a healthy current workspace.
    backup: found[BACKUP] ? await jsonOf(found[BACKUP]).catch(() => null) : localStorage.getItem(`${LEGACY}.backup`),
    beforeImport: await jsonOf(found[BEFORE_IMPORT]).catch(() => null),
    ...(unreadable ? { unreadable } : {}),
  };
}

/**
 * What importing this file would do, worked out without writing anything: the
 * workspace it would save, what it brings in, and what it leaves out. Throws a
 * plain message when the file cannot be imported at all.
 */
export function planResearchImport(json: string): ImportPlan {
  if (json.length > MAX_IMPORT_CHARS) throw new ImportRefusedError(`This file is larger than the ${Math.round(MAX_IMPORT_CHARS / 1_000_000)} MB an import can bring in. It is probably not a Stratemark export.`);
  const incoming = parseResearchSnapshot(json);
  if ((incoming.schemaVersion ?? 1) > REPO_SCHEMA_VERSION) throw new Error('This export requires a newer version of Stratemark.');
  const plan = prepareImportedSnapshot(incoming);
  // Migration re-judges the figures against the current gates, and drops template rows
  // ("Company Two") that were never businesses; the counts are of what is saved.
  const snapshot = migrateSnapshot(plan.snapshot).snapshot;
  return { ...plan, snapshot, decks: snapshot.markets.length, companies: snapshot.companies.length, skipped: plan.skipped + plan.companies - snapshot.companies.length };
}

/**
 * Where a planned workspace came from, which decides what is kept of the one it replaces:
 *  - `import`: a file the person picked. The workspace it replaces is kept as the
 *    research from before the import, apart from the backup, which the next save overwrites.
 *  - `backup`: the saved backup. The workspace it replaces becomes the backup.
 *  - `before-import`: that kept copy, restored. It is spent, so it is removed.
 */
export type InstallKind = 'import' | 'backup' | 'before-import';

/** Saves a planned workspace in place of the current one. */
export async function installResearchImport(plan: ImportPlan, options: { recovering?: boolean; kind?: InstallKind } = {}): Promise<void> {
  const store = await openBrowserResearchStore({ recovering: options.recovering });
  // A crashed session leaves its jobs "running" for good, so the recovery screen cannot be held up by them.
  const active = !options.recovering && store.read()?.researchJobs?.some((job) => job.status === 'running' || job.status === 'queued');
  if (active) throw new Error('Stop active research before replacing this workspace.');
  const kind = options.kind ?? 'import';
  await store.replace(plan.snapshot, { keepPrevious: kind === 'import', dropBeforeImport: kind === 'before-import' });
}

/** Imports a research file; returns how many decks it brought in. */
export async function installBrowserResearch(json: string): Promise<number> {
  const plan = planResearchImport(json);
  await installResearchImport(plan);
  return plan.decks;
}

/**
 * Deletes the research saved in this browser, its backup and the copy kept from
 * before an import included, and nothing else: the API key and settings stay. For the start-up recovery screen's
 * "Start fresh", when the saved research cannot be opened at all.
 */
export async function clearBrowserResearch(): Promise<void> {
  try {
    localStorage.removeItem(LEGACY);
    localStorage.removeItem(`${LEGACY}.backup`);
  } catch { /* storage blocked: the IndexedDB copy is the one that matters */ }
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('stratemark.vault');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('Saved research could not be deleted.', { cause: request.error }));
    request.onblocked = () => reject(new Error('Close any other Stratemark windows, then try again.'));
  });
}
