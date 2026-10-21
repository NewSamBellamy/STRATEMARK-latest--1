/**
 * One rule for "is stored research still recent enough to serve as current?"
 * (chat memory's 14-day window). Figure recovery is NOT gated by it: old saved
 * research still fills a slot, dated and labelled on read (PLAN-CRAAP 1.2), so
 * no extra model call is spent. Pure: the clock is always passed in. A missing,
 * unreadable or future-dated capture time is never fresh.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** A capture stamped up to a day ahead is clock skew, not the future. */
const SKEW_MS = DAY_MS;

export function isFreshCapture(capturedAt: string | null | undefined, now: Date, maxAgeDays: number): boolean {
  const at = capturedAt ? Date.parse(capturedAt) : Number.NaN;
  if (!Number.isFinite(at)) return false;
  const age = now.getTime() - at;
  return age >= -SKEW_MS && age <= maxAgeDays * DAY_MS;
}
