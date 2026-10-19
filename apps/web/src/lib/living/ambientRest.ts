/**
 * Rest for a deck's automatic paid searches across page loads.
 *
 * The living deck makes a few paid searches on its own when a deck opens: the card-face sweep, one batched
 * estimate fill, and one ladder hunt for every company still short of a core figure. Each of those was
 * limited per session, and a reload starts a new session, so reloading the page paid for them all again
 * (about $0.40 within a minute on a 16-company deck). A company that was searched automatically now rests
 * for a few days, across reloads and restarts; a figure's automatic re-check rests for the half hour it always did. A figure two passes could not find is not found by a third
 * a minute later; the manual "Find missing figures" button stays unlimited, and the freshness checks on
 * figures already held are a separate lane that is not limited here.
 *
 * The ledger lives in this browser's localStorage. Where storage is unavailable nothing rests, which is the
 * behaviour before this existed.
 */

/** How long a company or deck rests after an automatic search. */
export const AMBIENT_REST_MS = 3 * 24 * 60 * 60_000;

const STORAGE_KEY = 'mi.ambientRest';
/** More entries than any real library holds; the oldest go first. */
const MAX_ENTRIES = 600;
/** A start time further ahead than this is a wrong clock, not a rest. */
const CLOCK_SKEW_MS = 5 * 60_000;

type Ledger = Record<string, number>;

function read(): Ledger {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => Number.isFinite(entry[1])));
  } catch {
    return {};
  }
}

function write(ledger: Ledger): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  } catch {
    /* private mode or a full store: nothing rests */
  }
}

/** The key under which one company's automatic hunt (the sweep's search or the ladder's) rests. */
export const huntRestKey = (companyId: string): string => `hunt:${companyId}`;
/** The key under which a deck's one automatic batched estimate fill rests. */
export const batchRestKey = (deckId: string): string => `batch:${deckId}`;
/** The key under which one figure's automatic re-check rests (its own, shorter window). */
export const verifyRestKey = (companyId: string, metricType: string): string => `verify:${companyId}:${metricType}`;

/** True while `key` was started less than `restMs` ago (AMBIENT_REST_MS unless the caller names its own window). */
export function isResting(key: string, now: number = Date.now(), restMs: number = AMBIENT_REST_MS): boolean {
  const startedAt = read()[key];
  return startedAt !== undefined && startedAt <= now + CLOCK_SKEW_MS && now - startedAt < restMs;
}

/** Start `key`'s rest now, forgetting every rest that has run out of the longest window. */
export function startRest(key: string, now: number = Date.now()): void {
  const ledger = read();
  ledger[key] = now;
  const live = Object.entries(ledger).filter(([, startedAt]) => now - startedAt < AMBIENT_REST_MS)
    .sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES);
  write(Object.fromEntries(live));
}

/** End `key`'s rest early (a corrected figure is new information, so its re-check opens at once). */
export function endRest(key: string): void {
  const ledger = read();
  if (!(key in ledger)) return;
  delete ledger[key];
  write(ledger);
}
