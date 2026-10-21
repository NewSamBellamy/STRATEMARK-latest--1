/**
 * The research vault — a second, tougher home for the snapshot.
 *
 * Why this exists: the published app SHARES its origin's localStorage with
 * everything else served from that origin, so the snapshot competes for a
 * ~5MB quota it doesn't own and can be wiped by code that was never ours
 * (a co-tenant `localStorage.clear()`, browser eviction under storage
 * pressure). That is the "my decks got erased" failure class.
 *
 * The vault is an IndexedDB replica: far larger quota, separate database
 * namespace no co-tenant clears by accident. localStorage stays the fast
 * synchronous working copy; every write is mirrored to the vault, and on
 * boot — if the working copy is gone or has lost its markets while the
 * vault still has them — the vault restores it automatically.
 *
 * Everything degrades gracefully: no IndexedDB (old jsdom, weird embeds)
 * means the vault quietly does nothing and the app behaves exactly as before.
 */

import { installBrowserResearch, readBrowserResearchData } from './browserResearchStore';

const DB_NAME = 'stratemark.vault';
const STORE = 'snapshots';
/** Generated imagery — paid for once on the user's key, kept forever. */
const IMAGE_STORE = 'images';

function idbOpen(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        if (!req.result.objectStoreNames.contains(IMAGE_STORE))
          req.result.createObjectStore(IMAGE_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function vaultPut(key: string, json: string): Promise<boolean> {
  const db = await idbOpen();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ json, at: Date.now() }, key);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

export async function vaultGet(key: string): Promise<{ json: string; at: number } | null> {
  const db = await idbOpen();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        db.close();
        const v = req.result as { json: string; at: number } | undefined;
        resolve(v && typeof v.json === 'string' ? v : null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

/** How many markets a serialized snapshot holds; -1 when unreadable. */
export function marketCountOf(json: string | null): number {
  if (!json) return -1;
  try {
    const parsed = JSON.parse(json) as { markets?: unknown[] };
    return Array.isArray(parsed.markets) ? parsed.markets.length : -1;
  } catch {
    return -1;
  }
}

export type HydrationResult = 'restored' | 'ok' | 'empty';

/**
 * Boot-time recovery: if localStorage lost the research the vault still has,
 * put it back BEFORE the repository reads it. Called once at startup.
 */
export async function hydrateFromVault(key = 'mi.repo.v1'): Promise<HydrationResult> {
  // Ask the browser to stop treating this origin's storage as evictable.
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* best effort */
  }
  const vault = await vaultGet(key);
  if (!vault) return 'empty';
  let local: string | null = null;
  try {
    local = localStorage.getItem(key);
  } catch {
    return 'empty';
  }
  const localMarkets = marketCountOf(local);
  const vaultMarkets = marketCountOf(vault.json);
  // Restore ONLY on catastrophic local loss (nothing/unreadable/zero markets)
  // while the vault still has research. A smaller-but-nonzero local copy is
  // treated as the truth — the user may have deleted decks on purpose.
  if (vaultMarkets > 0 && localMarkets <= 0) {
    try {
      localStorage.setItem(key, vault.json);
      console.warn(
        `[vault] localStorage had ${localMarkets < 0 ? 'no readable snapshot' : 'zero markets'} — restored ${vaultMarkets} market(s) from the IndexedDB vault.`,
      );
      return 'restored';
    } catch {
      return 'empty'; // quota blocks even the restore — the repo can't help here
    }
  }
  return 'ok';
}

// ---------------------------------------------------------------------------
// Export / import — the user's own hands on their research.
// ---------------------------------------------------------------------------

export async function exportSnapshot(_key = 'mi.repo.v1'): Promise<boolean> {
  const { current: json } = await readBrowserResearchData();
  if (!json) return false;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stratemark-research-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/** Installs only after a durable transaction; existing workspace becomes backup. */
export async function importSnapshot(json: string, _key = 'mi.repo.v1'): Promise<number> {
  return installBrowserResearch(json);
}


// ---------------------------------------------------------------------------
// Generated-image persistence — an image the user's key paid for is research
// data: it must survive refreshes, not regenerate (and re-bill) every session.
// Data URLs are far too big for localStorage; IndexedDB is their home.
// ---------------------------------------------------------------------------

export async function imageGet(key: string): Promise<string | null> {
  const db = await idbOpen();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IMAGE_STORE, 'readonly');
      const req = tx.objectStore(IMAGE_STORE).get(key);
      req.onsuccess = () => {
        db.close();
        resolve(typeof req.result === 'string' ? req.result : null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function imagePut(key: string, dataUrl: string): Promise<void> {
  const db = await idbOpen();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IMAGE_STORE, 'readwrite');
      tx.objectStore(IMAGE_STORE).put(dataUrl, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function imageDelete(key: string): Promise<void> {
  const db = await idbOpen();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IMAGE_STORE, 'readwrite');
      tx.objectStore(IMAGE_STORE).delete(key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}
