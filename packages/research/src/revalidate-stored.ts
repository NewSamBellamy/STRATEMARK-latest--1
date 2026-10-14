/**
 * Load-time revalidation of STORED figures against the current integrity gates.
 *
 * Gates only run when a figure is written. A figure written before a gate
 * existed (GitHub showing Microsoft's market cap, a 2018 acquisition price as
 * "valuation", a market cap computed from a 2010 share count) would otherwise
 * keep its bad value forever. This pass re-applies each gate to the evidence
 * stored WITH the figure — never a fetch, never a model call — and resets a
 * figure that fails to unknown (null value, no citation). An unknown figure is
 * what the research pipeline hunts, so the next research of that company
 * re-earns it honestly through today's gates.
 *
 * Deterministic and clock-free: the same snapshot always yields the same
 * result. It runs once per {@link METRIC_GATE_VERSION}; bump the version (and
 * add the check here) whenever a new write gate should also reach stored rows.
 * Human-verified figures are never touched.
 */
import { ownershipWithholdsValuation, type CompanyMetric, type MetricType, type Ownership } from '@mi/contracts';
import type { OriginalSourceAttempt, OriginalSourceReceipt } from './original-source';
import type { ResearchEvidence } from './research-evidence';
import { storedReportedFigureMisattributed } from './reported-metrics';
import { shareCountTooOld, storedMarketCapDates } from './market-quote';
import { storedSecRevenueIsSubLine } from './sec-revenue';

/**
 * v1: parent/subsidiary + acquisition-price attribution (reported lane),
 *     400-day share-count staleness (market-cap quote lane),
 *     SEC sub-line revenue concept (structured revenue lane).
 * v2: an acquired company's deal-time valuation (ownership rule).
 */
export const METRIC_GATE_VERSION = 2;

export type RevalidationGate = 'parent_or_acquisition' | 'stale_share_count' | 'sec_revenue_sub_line' | 'acquired_deal_valuation';

export interface RevalidatedMetric {
  metricId: string;
  companyId: string;
  metricType: MetricType;
  gate: RevalidationGate;
  /** The withdrawn value, kept in the outcome for the audit trail only. */
  previousValue: number | null;
}

export interface RevalidationOutcome {
  /** Gate version found on the snapshot (0 when it was never revalidated). */
  fromVersion: number;
  /** True when this call ran the checks (the stored version was older). */
  ran: boolean;
  reset: RevalidatedMetric[];
  /** SEC revenue rows whose retained evidence could not decide the sub-line question. */
  undecided: string[];
}

/** The snapshot fields this pass reads and writes. */
export interface RevalidatableSnapshot {
  metricGateVersion?: number;
  companies: ReadonlyArray<{ id: string; name: string; ownership?: Ownership | null }>;
  metrics: CompanyMetric[];
  dashboards: Record<string, unknown>;
  researchEvidence?: readonly ResearchEvidence[];
  originalSourceAttempts?: readonly OriginalSourceAttempt[];
}

const NOTES: Record<RevalidationGate, string> = {
  parent_or_acquisition: 'Withdrawn: the stored source sentence gives a parent company\'s figure or an acquisition price, not this company\'s own figure. Unknown until re-researched.',
  stale_share_count: 'Withdrawn: the stored market cap multiplied the share price by a share count more than 400 days older than the price. Unknown until re-researched.',
  sec_revenue_sub_line: 'Withdrawn: the stored SEC revenue was a sub-line concept; the issuer files a larger total for the same period. Unknown until re-researched.',
  acquired_deal_valuation: 'Withdrawn: the company was acquired and this valuation is the deal price or dates from the deal itself, not an independent valuation.',
};

function failedGate(metric: CompanyMetric, companyName: string | undefined,
  answers: () => string[], receipts: () => OriginalSourceReceipt[], undecided: string[],
  ownership?: Ownership | null): RevalidationGate | null {
  if (metric.value === null) return null;
  if (ownershipWithholdsValuation(metric, ownership)) return 'acquired_deal_valuation';
  if (metric.reportedSupport && storedReportedFigureMisattributed(metric, answers())) return 'parent_or_acquisition';
  if (metric.metricType === 'market_cap') {
    const dates = storedMarketCapDates(metric);
    if (dates && shareCountTooOld(dates.sharesAsOf, Date.parse(dates.priceAsOf))) return 'stale_share_count';
  }
  if (companyName && metric.passageSupport?.format === 'sec-companyconcept' && metric.metricType === 'arr') {
    const subLine = storedSecRevenueIsSubLine(companyName, metric, receipts());
    if (subLine === true) return 'sec_revenue_sub_line';
    if (subLine === null) undecided.push(metric.id);
  }
  return null;
}

/**
 * Re-apply the current gates to every stored figure of `snapshot`, in place.
 * A no-op (ran: false) when the snapshot is already at the current version.
 */
export function revalidateStoredMetrics(snapshot: RevalidatableSnapshot): RevalidationOutcome {
  const fromVersion = typeof snapshot.metricGateVersion === 'number' ? snapshot.metricGateVersion : 0;
  if (fromVersion >= METRIC_GATE_VERSION) return { fromVersion, ran: false, reset: [], undecided: [] };

  const names = new Map(snapshot.companies.map((c) => [c.id, c.name]));
  const owners = new Map(snapshot.companies.map((c) => [c.id, c.ownership]));
  const answersByCompany = new Map<string, string[]>();
  const answersFor = (companyId: string) => {
    let found = answersByCompany.get(companyId);
    if (!found) {
      found = (snapshot.researchEvidence ?? []).filter((e) => e.companyId === companyId)
        .flatMap((e) => [e.text, e.grounding?.answerText ?? ''].filter((t) => t.length > 0));
      answersByCompany.set(companyId, found);
    }
    return found;
  };
  const receiptsFor = (companyId: string) => (snapshot.originalSourceAttempts ?? [])
    .filter((a) => a.companyId === companyId).flatMap((a) => a.receipts);

  const reset: RevalidatedMetric[] = [];
  const undecided: string[] = [];
  // Rows are replaced, never mutated: callers may still hold the read snapshot.
  snapshot.metrics = snapshot.metrics.map((metric) => {
    // Only a human may set or clear a user_verified figure.
    if (metric.confidence === 'user_verified' || metric.confidence === 'unknown') return metric;
    const gate = failedGate(metric, names.get(metric.companyId),
      () => answersFor(metric.companyId), () => receiptsFor(metric.companyId), undecided, owners.get(metric.companyId));
    if (!gate) return metric;
    reset.push({ metricId: metric.id, companyId: metric.companyId, metricType: metric.metricType, gate, previousValue: metric.value });
    return { ...metric, value: null, confidence: 'unknown', source: null, citations: [], methodNote: NOTES[gate],
      passageSupport: null, reportedSupport: null, quotedSupport: null, lastVerifiedAt: null };
  });
  // A cached dashboard may restate a withdrawn figure in its prose.
  const touched = new Set(reset.map((r) => r.companyId));
  if (touched.size) snapshot.dashboards = { ...snapshot.dashboards, ...Object.fromEntries([...touched].map((id) => [id, {}])) };
  snapshot.metricGateVersion = METRIC_GATE_VERSION;
  return { fromVersion, ran: true, reset, undecided };
}
