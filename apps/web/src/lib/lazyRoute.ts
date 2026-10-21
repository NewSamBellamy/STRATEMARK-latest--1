import { lazy, type ComponentType } from 'react';

/** A route chunk the browser could not fetch (offline, or replaced by a deploy). */
export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error &&
    /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(error.message);
}

/**
 * React.lazy remembers a failed import forever, so one route opened while
 * offline stayed broken after the connection came back. Offline, the route
 * waits (behind its Suspense fallback) for the browser to come back online and
 * loads then; any other failure is the error boundary's to show.
 */
export function loadWhenOnline<T>(load: () => Promise<T>): Promise<T> {
  return load().catch(async (error: unknown) => {
    if (typeof window === 'undefined' || navigator.onLine || !isChunkLoadError(error)) throw error;
    await new Promise<void>((resolve) => window.addEventListener('online', () => resolve(), { once: true }));
    return load().catch((again: unknown) => reloadOnce(again));
  });
}

/** Seam for tests: jsdom cannot reload. */
export const recovery = { reload: () => window.location.reload() };

const RELOADED_KEY = 'mi.chunk.reloaded';
const RELOAD_COOLDOWN_MS = 30_000;

/**
 * Browsers remember a failed dynamic import for the life of the page, so the retry after reconnecting fails the
 * same way. A reload is the one thing that fetches it again, and the hash keeps the user on the same screen. It
 * waits behind the loader until the page goes; a second failure soon after a reload (the server really is
 * down, or the file is gone) is shown instead of looping.
 */
function reloadOnce<T>(error: unknown): Promise<T> {
  if (!isChunkLoadError(error)) throw error;
  let allowed = false;
  try {
    const last = Number(sessionStorage.getItem(RELOADED_KEY) ?? 0);
    if (Date.now() - last >= RELOAD_COOLDOWN_MS) {
      sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
      allowed = true;
    }
  } catch { /* no sessionStorage to remember the reload in: it could loop, so show the error */ }
  if (!allowed) throw error;
  recovery.reload();
  return new Promise<T>(() => {});
}

export function lazyRoute<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  return lazy(() => loadWhenOnline(load));
}
