import type { RepoSnapshot, ResearchStore } from '@mi/research';
import { marketCountOf, vaultPut } from './vault';

/**
 * Full-snapshot localStorage store. A failed save must not destroy research.
 *
 * The filmed failure: "the app deletes all the decks". Root cause: once the
 * snapshot outgrew the ~5MB localStorage quota (researched tab caches are
 * big), `setItem` threw, the old code swallowed it as "session-only", every
 * subsequent write silently no-oped — and the next refresh lost everything
 * since the last successful write.
 *
 * Reports and researched dashboards are user data, not disposable caches.
 * Keep the previous atomic localStorage write on failure, try a full replica,
 * and throw: this synchronous interface cannot promise asynchronous IDB durability.
 */
export class ResearchStorageError extends Error {
  constructor() {
    super('Could not save the latest research. Your previously saved data has not been replaced. Keep this window open, free storage space and retry; do not assume these changes are saved.');
    this.name = 'ResearchStorageError';
  }
}

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
        console.error('[store] snapshot unreadable — preserved under .corrupt; starting clean', err);
        return null;
      }
    },
    write(snapshot: RepoSnapshot): void {
      let json: string;
      try { json = JSON.stringify(snapshot); } catch { throw new ResearchStorageError(); }
      // DECK-LOSS GUARD: before any write that would DROP markets (an
      // intentional delete or a clobber from a stale tab — indistinguishable
      // here), stash the richer stored copy under `.backup` so the Settings
      // Data Safety panel can always bring it back.
      try {
        const stored = localStorage.getItem(key);
        const storedMarkets = marketCountOf(stored);
        if (stored && storedMarkets > (snapshot.markets?.length ?? 0)) {
          localStorage.setItem(`${key}.backup`, stored);
        }
      } catch {
        /* backup is best-effort; never block the real write */
      }

      const mirror = () => {
        // Only a replica attempt, never an acknowledgment to the caller.
        void vaultPut(key, json).catch(() => {
          console.warn('[store] secondary vault write failed; no backup success is claimed.');
        });
      };
      try {
        localStorage.setItem(key, json);
      } catch {
        mirror();
        throw new ResearchStorageError();
      }
      mirror();
    },
  };
}
