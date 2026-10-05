import { migrateSnapshot, REPO_SCHEMA_VERSION, type RepoSnapshot, type ResearchStore } from '@mi/research';

const LEGACY = 'mi.repo.v1';
const CURRENT = `${LEGACY}.committed`;
const BACKUP = `${CURRENT}.backup`;
type RecordValue = { json: string; revision: number; at: number };

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
    const snapshot = JSON.parse(json) as RepoSnapshot;
    if (!snapshot || !Array.isArray(snapshot.markets) || !Array.isArray(snapshot.decks) ||
      !Array.isArray(snapshot.companies) || !Array.isArray(snapshot.cards) || !Array.isArray(snapshot.metrics)) {
      throw new Error('Invalid research workspace');
    }
    const object = (value: unknown) => value != null && typeof value === 'object' && !Array.isArray(value);
    if (snapshot.schemaVersion !== undefined && (!Number.isSafeInteger(snapshot.schemaVersion) || snapshot.schemaVersion < 1)) throw new Error('Invalid version');
    for (const field of ['markets', 'decks', 'companies', 'cards', 'metrics', 'viceClaims', 'reports', 'briefings', 'savedCards', 'researchJobs', 'threads', 'researchEvidence'] as const) {
      const rows = snapshot[field];
      if (rows !== undefined && (!Array.isArray(rows) || rows.some((row: unknown) => !object(row)))) throw new Error(`Invalid ${field}`);
    }
    for (const field of ['dashboards', 'companyMarket', 'opportunity'] as const) {
      if (snapshot[field] !== undefined && !object(snapshot[field])) throw new Error(`Invalid ${field}`);
    }
    return snapshot;
  } catch (cause) {
    throw new Error('Your saved research is unreadable. Export or recover it before continuing; nothing has been overwritten.', { cause });
  }
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
  if (saved && (typeof saved.json !== 'string' || !Number.isSafeInteger(saved.revision) || saved.revision < 1)) {
    throw new Error('Your saved research is unreadable. Nothing has been overwritten.');
  }
  let revision = found[CURRENT]?.revision ?? 0;
  let committed = found[CURRENT]?.json ?? localStorage.getItem(LEGACY) ?? found[LEGACY]?.json ?? null;
  const initial = committed ? parseResearchSnapshot(committed) : null;
  const future = (initial?.schemaVersion ?? 1) > REPO_SCHEMA_VERSION;
  let queue = Promise.resolve();
  return {
    read: () => committed ? parseResearchSnapshot(committed) : null,
    write(snapshot) {
      // Capture now, before queued writes or caller mutations can change this revision.
      const json = JSON.stringify(snapshot);
      const version = snapshot.schemaVersion ?? 1;
      const operation = queue.then(async () => {
        if (future || version > REPO_SCHEMA_VERSION) throw new Error('This research uses a newer version of Stratemark. Update before saving.');
        parseResearchSnapshot(json);
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
            if (previous) store.put(previous, BACKUP);
            else if (committed) store.put({ json: committed, revision: 0, at: Date.now() }, BACKUP);
            store.put({ json, revision: revision + 1, at: Date.now() }, CURRENT);
          };
          tx.oncomplete = () => { revision += 1; committed = json; db.close(); resolve(); };
          tx.onabort = () => { db.close(); reject(failure ?? new Error('Research was not saved. Storage may be full or unavailable; previous saved research is intact.', { cause: tx.error })); };
        });
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}

export async function readBrowserResearchData(): Promise<{ current: string | null; backup: string | null }> {
  const found = await records();
  return {
    current: found[CURRENT]?.json ?? localStorage.getItem(LEGACY) ?? found[LEGACY]?.json ?? null,
    backup: found[BACKUP]?.json ?? localStorage.getItem(`${LEGACY}.backup`),
  };
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
