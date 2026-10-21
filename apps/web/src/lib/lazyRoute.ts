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
    return load();
  });
}

export function lazyRoute<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  return lazy(() => loadWhenOnline(load));
}
