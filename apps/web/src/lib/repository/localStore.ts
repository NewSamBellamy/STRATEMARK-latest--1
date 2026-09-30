import type { RepoSnapshot, ResearchStore } from '@mi/research';
import { marketCountOf, vaultPut } from './vault';

export class LocalStorePersistenceError extends Error {
  constructor() {
    super('Could not persist the research snapshot to localStorage.');
    this.name = 'LocalStorePersistenceError';
  }
}

/** localStorage-backed synchronous snapshot store with a best-effort vault mirror. */
export function createLocalStore(key = 'mi.repo.v1'): ResearchStore {
  return {
    read(): RepoSnapshot | null {
      try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as RepoSnapshot) : null;
      } catch (err) {
        // A corrupt snapshot must not brick startup — preserve the evidence
        // for recovery instead of overwriting it, then start clean.
        try {
          const raw = localStorage.getItem(key);
          if (raw) localStorage.setItem(`${key}.corrupt`, raw.slice(0, 2_000_000));
        } catch {
          /* best effort */
        }
        console.error(
          '[store] snapshot unreadable — preserved under .corrupt; starting clean',
          err,
        );
        return null;
      }
    },
    write(snapshot: RepoSnapshot): void {
      let json: string;
      try {
        json = JSON.stringify(snapshot);
      } catch {
        throw new LocalStorePersistenceError();
      }

      let previous: string | null = null;
      let preservePrevious = false;
      try {
        previous = localStorage.getItem(key);
        preservePrevious =
          previous !== null && marketCountOf(previous) > (snapshot.markets?.length ?? 0);
      } catch {
        /* The backup is best-effort; the primary write remains authoritative. */
      }

      try {
        localStorage.setItem(key, json);
      } catch {
        throw new LocalStorePersistenceError();
      }

      // Keep the richer prior snapshot as a recovery copy, but only after the
      // new complete snapshot has committed successfully.
      if (preservePrevious && previous !== null) {
        try {
          localStorage.setItem(`${key}.backup`, previous);
        } catch {
          /* A backup failure does not undo the successful primary write. */
        }
      }

      // IndexedDB is a mirror only: its asynchronous outcome cannot prove this
      // synchronous ResearchStore.write succeeded or failed.
      try {
        void vaultPut(key, json).catch(() => undefined);
      } catch {
        /* The committed localStorage snapshot remains the synchronous result. */
      }
    },
  };
}
