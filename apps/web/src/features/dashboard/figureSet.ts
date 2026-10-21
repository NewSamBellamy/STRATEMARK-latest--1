/**
 * The one figure set the company dashboard reads.
 *
 * Overview and Metrics both build their figures here, so a figure that exists
 * on one tab exists on the other, with the same trust wording, the same dates
 * and the same currency. Nothing is computed that was not stored: an estimate
 * is shown as an estimate, and a figure that does not exist stays a gap.
 *
 * This is a dashboard model. The collectible card face keeps its own, stricter
 * selection (card-view.ts) and is not touched by anything here.
 */
import { classifyMarketProfile, type Company, type CompanyMetric, type MetricType } from '@mi/contracts';
import { buildMetricViews } from '@/features/card/card-view';
import { formatDate, formatMetricValue } from '@/lib/format';
import { isKnown, metricAsOf, missingCoreTypes, orderMetrics } from './dashboardModel';
import { currencyCaption, figureCurrency, withReportedCurrency } from './figureCurrency';

const CONFIDENCE_RANK: Partial<Record<CompanyMetric['confidence'], number>> = { user_verified: 3, verified: 2, estimated: 1 };

/**
 * One company's annual revenue can arrive twice: as a search-reported "revenue"
 * row and as the SEC's filed annual revenue (stored under the ARR slot with the
 * annual-revenue definition). Listed as two rows they read as two figures. When
 * both are known and agree within 5%, the better-evidenced one is kept; rows
 * that disagree stay side by side, since that is real information.
 */
export function dropRestatedRevenue(rows: CompanyMetric[]): CompanyMetric[] {
  const restated = (m: CompanyMetric) => m.metricType === 'arr' && (m.passageSupport?.definition ?? m.reportedSupport?.definition) === 'annual_revenue';
  const revenue = rows.find((m) => m.metricType === 'revenue' && isKnown(m) && m.value != null);
  const annual = rows.find((m) => restated(m) && isKnown(m) && m.value != null);
  if (!revenue || !annual || revenue.value == null || annual.value == null) return rows;
  if (Math.abs(revenue.value - annual.value) > 0.05 * Math.max(revenue.value, annual.value)) return rows;
  const loser = (CONFIDENCE_RANK[revenue.confidence] ?? 0) > (CONFIDENCE_RANK[annual.confidence] ?? 0) ? annual : revenue;
  return rows.filter((m) => m !== loser);
}

/**
 * An Unknown row that a known sibling already answers is noise, not a gap:
 * "Revenue: Unknown" under a sourced annual revenue, "Market cap: Unknown"
 * under a sourced valuation, AUM on a company that isn't a fund manager.
 */
function pruneRedundantGaps(rows: CompanyMetric[], financialFirm: boolean): CompanyMetric[] {
  const known = new Set(rows.filter(isKnown).map((m) => m.metricType));
  const answeredBy: Partial<Record<MetricType, MetricType[]>> = {
    revenue: ['arr'], arr: ['revenue'],
    market_cap: ['valuation'], valuation: ['market_cap'],
    last_round: ['market_cap'], funding_total: ['market_cap'],
  };
  return rows.filter((m) => {
    if (isKnown(m)) return true;
    if (m.metricType === 'aum' && !financialFirm) return false;
    return !(answeredBy[m.metricType] ?? []).some((t) => known.has(t));
  });
}

export interface FigureSet {
  /** Every figure row, found or not, in display order. */
  all: CompanyMetric[];
  /** The figures with a value (estimates included, marked as such by their confidence). */
  known: CompanyMetric[];
  /** Figures not found: labelled gaps, never zeros. */
  missing: CompanyMetric[];
  /** Non-gap rows the research stored (for dig-deeper topics). */
  real: CompanyMetric[];
}

export function buildFigureSet(
  metrics: readonly CompanyMetric[],
  company: Pick<Company, 'websiteUrl' | 'ownership'> & Partial<Company> | null | undefined,
  companyId: string,
): FigureSet {
  const seen = new Set<MetricType>();
  const projected = buildMetricViews([...metrics], company?.websiteUrl, company?.ownership).map(({ metric }) => metric);
  const deduped = dropRestatedRevenue(orderMetrics(projected).filter((m) => !seen.has(m.metricType) && !!seen.add(m.metricType)));
  const financialFirm = company ? classifyMarketProfile(company as Company) === 'financial_firm' : false;
  const real = pruneRedundantGaps(deduped, financialFirm);
  // Core figures with no row at all stay visible as labelled gaps, so a sparse
  // company reads as "not yet found", not as an empty page.
  const gaps: CompanyMetric[] = missingCoreTypes(deduped, 4).map((t) => ({
    id: `gap-${t}`, companyId, metricType: t, value: null, confidence: 'unknown', source: null,
    citations: [], methodNote: null, capturedAt: '',
  } as CompanyMetric));
  const all = orderMetrics(pruneRedundantGaps([...deduped, ...gaps], financialFirm));
  return { all, known: all.filter(isKnown), missing: all.filter((m) => !isKnown(m)), real };
}

// ---- Trust, dates and currency, worded once --------------------------------

/** The clickable source a figure links to, if it has one. */
export function linkedCitation(metric: CompanyMetric) {
  return metric.citations.find((c) => /^https?:\/\//i.test(c.url));
}

/** "Reported" only when a source is linked; an estimate without one says so. */
export function figureTrust(metric: CompanyMetric): 'Human checked' | 'Verified' | 'Reported' | 'Estimated' {
  return metric.confidence === 'user_verified' ? 'Human checked'
    : metric.confidence === 'verified' ? 'Verified' : linkedCitation(metric) ? 'Reported' : 'Estimated';
}

/** "30 Jul 2026" via the shared formatter (calendar day in UTC, so no date is timezone-shifted). */
export function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  return formatDate(at);
}

/**
 * Two dates that mean two different things, labelled as such: the period the
 * source says the figure is for, and when we captured (or last checked) it.
 */
export function figureDates(metric: CompanyMetric): { period: string | null; record: string | null } {
  const { iso, kind } = metricAsOf(metric);
  const day = formatDay(iso);
  if (kind === 'as_of') return { period: day, record: formatDay(metric.capturedAt) ? `captured ${formatDay(metric.capturedAt)}` : null };
  return { period: null, record: day ? `${kind === 'verified' ? 'checked' : 'captured'} ${day}` : null };
}

/** A figure as the dashboard shows it: compact, in the currency it was reported in. */
export function figureDisplay(metric: CompanyMetric): string {
  return withReportedCurrency(formatMetricValue(metric.metricType, metric.value), figureCurrency(metric));
}

/** The caption under a figure reported in another currency; null for plain US dollars. */
export function currencyCaptionFor(metric: CompanyMetric): string | null {
  return currencyCaption(figureCurrency(metric));
}
