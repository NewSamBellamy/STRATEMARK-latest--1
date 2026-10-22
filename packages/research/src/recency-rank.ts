/**
 * Newest credible report first (owner audit 2026-10-22: a deck showed a valuation a
 * year older than the one Reuters and others were reporting).
 *
 * Several gate-passing candidates for ONE metric can come out of a single lookup (a
 * company page from last year and a news report from last week). Before this, the
 * first one the model happened to list was written and the rest were discarded.
 * This orders them so the newest credible dated report is tried first:
 *
 *   1. A dated candidate always beats an undated one.
 *   2. Between dated candidates the newer one wins when it is at least as credible.
 *   3. A newer candidate from a reputable non-primary publisher (a newspaper) beats an
 *      older PRIMARY one (the company itself or a regulator) only when the primary
 *      figure is more than RECENCY_OVERRIDE_DAYS older. Inside that window the
 *      company's own statement stands: press reports a few weeks later usually repeat
 *      or round the same event, or report talks that never closed.
 *   4. For fast-moving figures (RECENCY_SENSITIVE_TYPES: valuation, latest round, total
 *      raised, ARR) a newer but weaker candidate beats an older, stronger one when it is
 *      at least reputable ('acceptable') and the older one is more than
 *      RECENCY_OVERRIDE_DAYS older. A weak site (aggregator, unknown) never wins on date.
 *      Other figures keep the stronger source (a filed annual revenue is not displaced
 *      by a later press number, PLAN-CRAAP red-team case 8).
 *   5. Same date: the more credible wins, then the primary one, then the order given.
 *
 * Ordering only. It never creates, changes or averages a value (Rule 9): every
 * candidate still has to pass its own citation gate after this.
 */
import { publisherFit, publisherTier, isoDayMs, type MetricType } from '@mi/contracts';

/** One quarter. A primary figure (the company's own or a regulator's) is not
 * displaced by a newer secondary report until it is this many days older; the same
 * window lets a reputable newer report replace a stronger held figure. */
export const RECENCY_OVERRIDE_DAYS = 90;

/** Figures that change with every financing, where a year-old number is simply wrong today. */
export const RECENCY_SENSITIVE_TYPES: readonly MetricType[] = ['valuation', 'last_round', 'funding_total', 'arr'];

const DAY_MS = 86_400_000;

export interface RecencyCandidate {
  /** The figure's own date (YYYY-MM-DD), or null when the source states none. */
  asOf: string | null;
  /** 3 strong, 2 acceptable (reputable), 1 weak, 0 none. */
  credibility: number;
  /** The company itself or a regulator. */
  primary: boolean;
  /** A fast-moving figure (RECENCY_SENSITIVE_TYPES): a reputable newer report may displace a stronger stale one. */
  fastMoving?: boolean;
}

/** Days from `older` to `newer` (both YYYY-MM-DD); null when either is not a real date. */
export function daysBetween(older: string, newer: string): number | null {
  const a = isoDayMs(older);
  const b = isoDayMs(newer);
  return a == null || b == null ? null : (b - a) / DAY_MS;
}

const usableDate = (asOf: string | null): string | null => (asOf && isoDayMs(asOf) != null ? asOf : null);

/** True when `a` should be tried before `b`. */
export function beats(a: RecencyCandidate, b: RecencyCandidate): boolean {
  const da = usableDate(a.asOf);
  const db = usableDate(b.asOf);
  if (da && !db) return true;
  if (!da && db) return false;
  if (!da && !db) return a.credibility > b.credibility;
  if (da === db) return a.credibility > b.credibility || (a.credibility === b.credibility && a.primary && !b.primary);
  const aNewer = da! > db!;
  const newer = aNewer ? a : b;
  const older = aNewer ? b : a;
  const gap = daysBetween(usableDate(older.asOf)!, usableDate(newer.asOf)!) ?? 0;
  const pastWindow = gap > RECENCY_OVERRIDE_DAYS;
  const newerWins = newer.credibility >= older.credibility
    ? !(older.primary && !newer.primary) || pastWindow
    : pastWindow && newer.fastMoving === true && newer.credibility >= 2;
  return aNewer ? newerWins : !newerWins;
}

/** The candidates in the order they should be tried: best first. Stable for ties. */
export function rankNewestCredible<T>(items: readonly T[], view: (item: T) => RecencyCandidate): T[] {
  const left = items.map((item) => ({ item, view: view(item) }));
  const out: T[] = [];
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i += 1) if (beats(left[i]!.view, left[best]!.view)) best = i;
    out.push(left.splice(best, 1)[0]!.item);
  }
  return out;
}

/**
 * Figures a refresh looks for again before the display calls them stale. Valuations,
 * rounds, total raised and ARR move with every financing; the display horizons
 * (contracts CURRENCY_HORIZONS, valuation current for 18 months) are about labelling,
 * not about when a newer figure is likely to exist.
 */
export const REHUNT_AFTER_DAYS: Readonly<Partial<Record<MetricType, number>>> =
  Object.fromEntries(RECENCY_SENSITIVE_TYPES.map((t) => [t, 180]));

/** Whether a refresh should look for a newer figure: stale, undated, past its fresh
 * window ('aging'), or older than its REHUNT_AFTER_DAYS. */
export function rehuntDue(metricType: MetricType, currency: { state: string; ageDays: number | null } | null | undefined): boolean {
  if (!currency) return false;
  if (currency.state === 'stale' || currency.state === 'undated' || currency.state === 'aging') return true;
  const window = REHUNT_AFTER_DAYS[metricType];
  return window != null && currency.ageDays != null && currency.ageDays > window;
}

const FIT_RANK = { strong: 3, acceptable: 2, weak: 1 } as const;

/** Credibility of a source page for a metric, from the publisher registry. */
export function sourceCandidate(metricType: MetricType, sourceUrl: string | null | undefined, asOf: string | null | undefined,
  officialWebsite?: string | null): RecencyCandidate {
  const fastMoving = RECENCY_SENSITIVE_TYPES.includes(metricType);
  if (!sourceUrl) return { asOf: asOf ?? null, credibility: 0, primary: false, fastMoving };
  const tier = publisherTier(sourceUrl, officialWebsite);
  return { asOf: asOf ?? null, credibility: FIT_RANK[publisherFit(tier, metricType)], primary: tier === 1 || tier === 2, fastMoving };
}

/**
 * Hunt figures reordered so that, per metric, the newest credible dated candidate
 * comes first (metrics keep their first-seen order). The hunt writes the first
 * candidate of a metric that passes its gates, so this decides which report wins.
 */
export function orderFiguresNewestFirst<F extends { metricType: MetricType; passageSupport?: { sourceUrl: string; asOf?: string | null } | null }>(
  figures: readonly F[], officialWebsite?: string | null): F[] {
  const types = [...new Set(figures.map((f) => f.metricType))];
  return types.flatMap((type) => rankNewestCredible(figures.filter((f) => f.metricType === type),
    (f) => sourceCandidate(type, f.passageSupport?.sourceUrl, f.passageSupport?.asOf ?? null, officialWebsite)));
}
