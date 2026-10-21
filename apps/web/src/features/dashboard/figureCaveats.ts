/**
 * Caveats that are true of every figure in a group are said once, above the group,
 * instead of on every tile or row. Nothing is hidden or softened: the group line
 * carries the same statement, and a figure whose caveat differs from the group's
 * still shows its own. Fewer than two known figures is not a group (nothing repeats).
 */
import type { CompanyMetric } from '@mi/contracts';
import { isKnown } from './dashboardModel';
import { figureDates } from './figureSet';

export interface FigureCaveats {
  /** No source gave a period for any figure in the group. */
  noPeriod: boolean;
  /** "captured 30 Jul 2026": the one record line every figure shares, else null. */
  record: string | null;
  /** The single muted line for the group, or null when there is nothing common to say. */
  line: string | null;
}

export const NO_FIGURE_CAVEATS: FigureCaveats = { noPeriod: false, record: null, line: null };

export function figureCaveats(metrics: readonly CompanyMetric[]): FigureCaveats {
  const known = metrics.filter(isKnown);
  if (known.length < 2) return NO_FIGURE_CAVEATS;
  const dates = known.map(figureDates);
  const noPeriod = dates.every((d) => d.period == null);
  const first = dates[0]!.record;
  const record = first && dates.every((d) => d.record === first) ? first : null;
  const parts = [
    noPeriod ? 'Sources give no dates for these figures' : null,
    record ? `${noPeriod ? 'all' : 'All'} ${record}` : null,
  ].filter((p): p is string => p != null);
  return { noPeriod, record, line: parts.length ? `${parts.join('; ')}.` : null };
}

/**
 * What one figure says about its own period and record once the group has spoken:
 * its period, "not reported" only where the group did not already say so, and the
 * record line only where it differs from the group's.
 */
export function rowDates(metric: CompanyMetric, group: FigureCaveats): { period: string | null; notReported: boolean; record: string | null } {
  const d = figureDates(metric);
  return {
    period: d.period,
    notReported: d.period == null && !group.noPeriod,
    record: group.record && d.record === group.record ? null : d.record,
  };
}
