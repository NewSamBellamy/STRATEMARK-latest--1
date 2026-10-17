/**
 * Bounded plumbing for third-party media lookups (cover previews, headshots):
 * a size-capped LRU so a long session can't grow its cache without limit, and
 * a fetch with a deadline so a stalled publisher can't hold a tile on
 * "loading" forever.
 */

/** How long one media lookup request may take before it is abandoned. */
export const LOOKUP_TIMEOUT_MS = 8_000;

/** `fetch` that aborts after `ms`. A caller-supplied signal takes precedence. */
export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  ms = LOOKUP_TIMEOUT_MS,
): Promise<Response> {
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(ms) });
}

/** Map with least-recently-used eviction once `max` entries are held. */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly max: number) {}

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Reads count as use: the entry moves to the most-recent end. */
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}
