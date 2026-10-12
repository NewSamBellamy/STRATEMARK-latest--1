/** Persistent headshot cache (memory + localStorage, both guarded) and a small concurrency gate. */
const LS_KEY = 'sm.headshots.v1';
const TTL_MS = 14 * 86_400_000;

interface Entry<T> { v: T | null; t: number }

export function loadPersisted<T>(key: string): { hit: boolean; value: T | null } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, Entry<T>>) : {};
    const e = all[key];
    if (e && Date.now() - e.t < TTL_MS) return { hit: true, value: e.v };
  } catch { /* storage unavailable */ }
  return { hit: false, value: null };
}

export function savePersisted<T>(key: string, value: T | null): void {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, Entry<T>>) : {};
    all[key] = { v: value, t: Date.now() };
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch { /* quota / private mode */ }
}

/** Runs at most `limit` tasks at once. */
export function makeLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= limit) return;
    const run = queue.shift();
    if (run) { active++; run(); }
  };
  return <T,>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task().then(resolve, reject).finally(() => { active--; next(); });
      });
      next();
    });
}
