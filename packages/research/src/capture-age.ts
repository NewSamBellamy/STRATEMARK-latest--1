/**
 * One rule for "is stored research still recent enough to serve as current?",
 * shared by chat memory (a 14-day window) and by figure recovery (the metric's
 * own currency horizon). Pure: the clock is always passed in. A missing,
 * unreadable or future-dated capture time is never fresh.
 */
import { horizonMonthsFor } from './source-assessment';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A capture stamped up to a day ahead is clock skew, not the future. */
const SKEW_MS = DAY_MS;

export function isFreshCapture(capturedAt: string | null | undefined, now: Date, maxAgeDays: number): boolean {
  const at = capturedAt ? Date.parse(capturedAt) : Number.NaN;
  if (!Number.isFinite(at)) return false;
  const age = now.getTime() - at;
  return age >= -SKEW_MS && age <= maxAgeDays * DAY_MS;
}

/** The longest a captured page may be reused as the current basis of this metric: its currency horizon. */
export const metricEvidenceMaxAgeDays = (metricType: string): number => Math.round(horizonMonthsFor(metricType) * 30.4375);

/** Whether evidence captured at `capturedAt` may still back a current figure of `metricType`. */
export const isFreshForMetric = (capturedAt: string | null | undefined, metricType: string, now: Date): boolean =>
  isFreshCapture(capturedAt, now, metricEvidenceMaxAgeDays(metricType));
