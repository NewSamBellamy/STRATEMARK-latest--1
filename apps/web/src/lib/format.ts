import type { CompanyMetric, Confidence, MetricType } from '@mi/contracts';

/** Trillions carry two decimals ($4.69T), without a dangling zero ($4.6T) and with one ($1.0T). */
function trimTrillion(t: number): string {
  const two = t.toFixed(2);
  return two.endsWith('0') ? t.toFixed(1) : two;
}

/** Compact USD (e.g. $6.2B, $145.0M, $600K). */
export function formatUsd(value: number | null | undefined): string {
  if (value == null) return 'Unknown';
  if (value === 0) return '$0';
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${trimTrillion(value / 1e12)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

/** Compact count (e.g. 48M, 1.4M, 9K, 620). */
export function formatCount(value: number | null | undefined): string {
  if (value == null) return 'Unknown';
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${trimTrillion(value / 1e12)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return value.toLocaleString();
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null) return 'Unknown';
  return `${value.toFixed(digits)}%`;
}

/** Human relative time from an ISO string (e.g. "2h ago", "3d ago"). */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const diffMs = now - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

// Fixed English names (not Intl) so the output is identical across engines, locales and ICU versions.
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS_LONG.map((m) => m.slice(0, 3));
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/**
 * A moment at exactly 00:00:00.000 UTC is a calendar date ("2026-07-30" parses to one), not a clock
 * reading: read it in UTC so the day never slips. Every other moment is a real instant and is read in
 * the viewer's own time zone, so the date and the clock time always come from the same zone.
 */
const isCalendarDate = (d: Date) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
const dayOf = (d: Date) => (isCalendarDate(d)
  ? { day: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear(), weekday: d.getUTCDay() }
  : { day: d.getDate(), month: d.getMonth(), year: d.getFullYear(), weekday: d.getDay() });
const DATE_FMT = { format: (d: Date) => { const p = dayOf(d); return `${p.day} ${MONTHS_SHORT[p.month]} ${p.year}`; } };
const DATE_LONG_FMT = { format: (d: Date) => { const p = dayOf(d); return `${p.day} ${MONTHS_LONG[p.month]} ${p.year}`; } };
const DATE_LONG_WEEKDAY_FMT = { format: (d: Date) => `${WEEKDAYS[dayOf(d).weekday]} ${DATE_LONG_FMT.format(d)}` };
const MONTH_FMT = { format: (d: Date) => { const p = dayOf(d); return `${MONTHS_SHORT[p.month]} ${p.year}`; } };
const pad2 = (n: number) => String(n).padStart(2, '0');
const TIME_FMT = { format: (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The one absolute-date format: "30 Jul 2026". Returns `fallback` when the input is missing or invalid (never invents a date). */
export function formatDate(value: string | number | Date | null | undefined, fallback = 'unknown'): string {
  const d = toDate(value);
  return d ? DATE_FMT.format(d) : fallback;
}

/** Long form for report headers and formal copy: "30 July 2026" (optionally with the weekday). */
export function formatDateLong(value: string | number | Date | null | undefined, opts: { weekday?: boolean } = {}, fallback = 'unknown'): string {
  const d = toDate(value);
  if (!d) return fallback;
  return (opts.weekday ? DATE_LONG_WEEKDAY_FMT : DATE_LONG_FMT).format(d);
}

/** A period: "Jul 2026". */
export function formatMonthYear(value: string | number | Date | null | undefined, fallback = 'unknown'): string {
  const d = toDate(value);
  return d ? MONTH_FMT.format(d) : fallback;
}

/** Date plus clock time, local: "30 Jul 2026, 14:05". A calendar date with no time of day (a "2026-07-30") is shown without a clock time, never an invented one. */
export function formatDateTime(value: string | number | Date | null | undefined, fallback = 'unknown'): string {
  const d = toDate(value);
  if (!d) return fallback;
  return isCalendarDate(d) ? DATE_FMT.format(d) : `${DATE_FMT.format(d)}, ${TIME_FMT.format(d)}`;
}

/** Clock time only, local: "14:05". */
export function formatClock(value: string | number | Date | null | undefined = new Date()): string {
  const d = toDate(value);
  return d ? TIME_FMT.format(d) : '';
}

/** A future moment: "Due now" once it has passed, otherwise the absolute date and time. */
export function formatDue(value: string | number | Date | null | undefined, now: number = Date.now()): string {
  const d = toDate(value);
  if (!d) return 'unknown';
  return d.getTime() <= now ? 'Due now' : formatDateTime(d);
}

/** Format a metric row's value according to its type. */
export function formatMetricValue(type: MetricType, value: number | null): string {
  if (value == null) return 'Unknown';
  switch (type) {
    case 'market_cap':
    case 'valuation':
    case 'arr':
    case 'aum':
    case 'revenue':
    case 'funding_total':
    case 'last_round':
      return formatUsd(value);
    case 'market_share':
      return formatPercent(value);
    case 'users':
    case 'employees':
    case 'distribution':
      return formatCount(value);
  }
}

export const CONFIDENCE_STYLES: Record<Confidence, string> = {
  verified: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  estimated: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  unknown: 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
  user_verified: 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
};

/** Does a set of metrics include any estimated / unknown figures? Drives the card disclaimer. */
export function hasSoftData(metrics: CompanyMetric[]): boolean {
  return metrics.some((m) => m.confidence === 'estimated' || m.confidence === 'unknown');
}

/** Monogram initials for the logo fallback. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
