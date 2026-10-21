/**
 * Currency of a figure (PLAN-CRAAP 1.1): how old is the figure's OWN date, against
 * a per-metric horizon. One `figureAsOf` rule for every reader (card chooser,
 * dashboard, export, Source check).
 *
 * Pure and deterministic: the clock is always passed in. A figure with no date of
 * its own is `undated`; it is never assumed fresh. A page's publication date is
 * only an upper bound (`notAfter`): it can make a figure look older, never newer.
 * `retrievedAt`, `capturedAt` and `lastVerifiedAt` are never figure dates.
 */
import type { DashboardTab, MetricType } from './enums';
import type { CompanyMetric } from './types';

const DAY_MS = 86_400_000;
/** Calendar months as days (30.4375 average, rounded). */
const months = (n: number): number => Math.round(n * 30.4375);

/** current while age <= fresh; stale once age > stale; `aging` between. Separate from METRIC_VOLATILITY. */
export const CURRENCY_HORIZONS: Readonly<Record<MetricType, { fresh: number; stale: number }>> = {
  market_cap: { fresh: 7, stale: 30 },
  arr: { fresh: months(6), stale: months(12) },
  revenue: { fresh: months(15), stale: months(24) },
  employees: { fresh: months(12), stale: months(18) },
  users: { fresh: months(12), stale: months(18) },
  valuation: { fresh: months(18), stale: months(36) },
  last_round: { fresh: months(18), stale: months(36) },
  funding_total: { fresh: months(12), stale: months(24) },
  aum: { fresh: months(12), stale: months(18) },
  market_share: { fresh: months(12), stale: months(24) },
  distribution: { fresh: months(12), stale: months(24) },
};

/** Whole months a horizon spans, for plain-English text ("15-month window"). */
export const horizonMonths = (days: number): number => Math.round(days / 30.4375);

/** Tab freshness by research date (news items use their own published date: 30 d / 90 d). */
export const TAB_CURRENCY_HORIZONS: Readonly<Partial<Record<DashboardTab, { fresh: number; stale: number }>>> = {
  overview: { fresh: 30, stale: 90 },
  team_org: { fresh: months(6), stale: months(12) },
  products_roadmap: { fresh: months(6), stale: months(12) },
  mission_governance: { fresh: months(12), stale: months(24) },
  history: { fresh: months(24), stale: months(60) },
};
export const NEWS_CURRENCY_HORIZON = { fresh: 30, stale: 90 } as const;

export type CurrencyState = 'current' | 'aging' | 'stale' | 'undated';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** UTC midnight of a YYYY-MM-DD string, or null when it is not a real calendar date. */
export function isoDayMs(value: string | null | undefined): number | null {
  if (!value || !ISO_DAY.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

/** The "no date found" placeholder some recovery paths write (1970-01-01) is not a date. */
const usable = (value: string | null | undefined): string | null => (value && isoDayMs(value) != null && !value.startsWith('1970-') ? value : null);

export type FigureAsOf = { asOf: string | null; source: 'figure' | 'filing' | 'none' };

/**
 * The figure's OWN date, in order passageSupport.asOf, quotedSupport.asOf,
 * reportedSupport.asOf, reportedBand.asOf. 'filing' for deterministic SEC formats.
 */
export function figureAsOf(metric: Pick<CompanyMetric, 'passageSupport' | 'quotedSupport' | 'reportedSupport' | 'reportedBand'>): FigureAsOf {
  const passage = usable(metric.passageSupport?.asOf);
  if (passage) return { asOf: passage, source: metric.passageSupport?.format ? 'filing' : 'figure' };
  const date = usable(metric.quotedSupport?.asOf) ?? usable(metric.reportedSupport?.asOf) ?? usable(metric.reportedBand?.asOf);
  return date ? { asOf: date, source: 'figure' } : { asOf: null, source: 'none' };
}

/** A page-date upper bound read from a URL: /YYYY/MM/DD/ or /YYYY/MM/ (the last day of that month). Null otherwise. */
export function notAfterFromUrl(url: string | null | undefined): string | null {
  const match = /\/((?:19|20)\d{2})\/(0[1-9]|1[0-2])(?:\/(0[1-9]|[12]\d|3[01]))?(?=\/|$|\?|#)/.exec(url ?? '');
  if (!match) return null;
  const [, year, month, day] = match;
  const iso = day ? `${year}-${month}-${day}`
    : `${year}-${month}-${String(new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()).padStart(2, '0')}`;
  return isoDayMs(iso) != null ? iso : null;
}

export interface CurrencyReading {
  asOf: string | null;
  asOfSource: 'figure' | 'filing' | 'none';
  notAfter: string | null;
  notAfterSource: 'page' | 'url' | null;
  ageDays: number | null;
  state: CurrencyState;
  freshDays: number;
  staleDays: number;
  issues: string[];
}

/**
 * Age of a figure now. A date after `now` is not a date (state undated, issue
 * `date_in_future`); a figure dated more than a day after its page's `notAfter` is
 * suspect (its effective date becomes `notAfter`, issue `figure_date_after_page_date`);
 * an undated figure with a `notAfter` is at least that old, and is stale if that alone passes
 * the stale horizon, otherwise still undated.
 */
export function readCurrency(input: {
  metricType: MetricType; asOf: string | null; asOfSource: FigureAsOf['source'];
  notAfter?: string | null; notAfterSource?: 'page' | 'url' | null; now: Date;
}): CurrencyReading {
  const horizon = CURRENCY_HORIZONS[input.metricType];
  const issues: string[] = [];
  const nowMs = input.now.getTime();
  const notAfterMs = isoDayMs(input.notAfter);
  const notAfter = notAfterMs != null && notAfterMs <= nowMs ? input.notAfter! : null;
  const base = { notAfter, notAfterSource: notAfter ? input.notAfterSource ?? 'page' : null, freshDays: horizon.fresh, staleDays: horizon.stale } as const;
  let asOfMs = isoDayMs(input.asOf);
  let asOf = input.asOf;
  let source = input.asOfSource;
  if (asOfMs != null && asOfMs > nowMs) {
    issues.push('date_in_future');
    asOfMs = null; asOf = null; source = 'none';
  }
  if (asOfMs != null && notAfterMs != null && notAfter && asOfMs > notAfterMs + DAY_MS) {
    issues.push('figure_date_after_page_date');
    asOfMs = notAfterMs; asOf = notAfter;
  }
  if (asOfMs == null) {
    if (notAfterMs != null && notAfter) {
      const ageDays = Math.max(0, Math.floor((nowMs - notAfterMs) / DAY_MS));
      return { ...base, asOf: null, asOfSource: 'none', ageDays, state: ageDays > horizon.stale ? 'stale' : 'undated', issues };
    }
    return { ...base, asOf: null, asOfSource: 'none', ageDays: null, state: 'undated', issues };
  }
  const ageDays = Math.max(0, Math.floor((nowMs - asOfMs) / DAY_MS));
  const state: CurrencyState = ageDays <= horizon.fresh ? 'current' : ageDays > horizon.stale ? 'stale' : 'aging';
  return { ...base, asOf, asOfSource: source, ageDays, state, issues };
}

/** Freshness of a tab by its research date (undated when the tab was never researched). */
export function tabCurrency(tab: DashboardTab, researchedAt: string | null | undefined, now: Date): { state: CurrencyState; ageDays: number | null } {
  const horizon = TAB_CURRENCY_HORIZONS[tab] ?? TAB_CURRENCY_HORIZONS.overview!;
  const ms = researchedAt ? Date.parse(researchedAt) : NaN;
  if (!Number.isFinite(ms) || ms > now.getTime()) return { state: 'undated', ageDays: null };
  const ageDays = Math.floor((now.getTime() - ms) / DAY_MS);
  return { state: ageDays <= horizon.fresh ? 'current' : ageDays > horizon.stale ? 'stale' : 'aging', ageDays };
}
