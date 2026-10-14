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
import { classifyMarketProfile, isEntityCardType, ownershipWithholdsValuation, type CardType, type Citation, type CompanyMetric,
  type MetricType, type Ownership } from '@mi/contracts';
import { canonicalHqLocation } from './brand/hq-format';
import { isPendingCompanySummary, summaryIsUnfit, UNSUPPORTED_COMPANY_SUMMARY } from './company-summary';
import type { OriginalSourceAttempt, OriginalSourceReceipt } from './original-source';
import type { ResearchEvidence } from './research-evidence';
import { reportedBandNote, reportedRowNote, reportedStoredCitations, storedDefinition, storedReportedFigureMisattributed,
  supportStatesRevenue,
  storedSupportDate } from './reported-metrics';
import { shareCountTooOld, storedMarketCapDates } from './market-quote';
import { storedSecRevenueIsSubLine } from './sec-revenue';

/**
 * v1: parent/subsidiary + acquisition-price attribution (reported lane),
 *     400-day share-count staleness (market-cap quote lane),
 *     SEC sub-line revenue concept (structured revenue lane).
 * v2: two branches each shipped a "v2" independently, so a stored 2 may
 *     have had either set (never assume both):
 *     - an acquired company's deal-time valuation (ownership rule);
 *     - undated estimates re-dated from their own stored support (a literal
 *       business date, else the end of the one period it states) or marked
 *       explicitly undated; a financial firm's "ARR" relabelled annual revenue
 *       (or withdrawn when the stored support does not state revenue);
 *       stored company summaries that are sales lines, page-bound or broken
 *       extraction reset to the pending placeholder (company + entity cards);
 *       stored headquarters rewritten to the one canonical display form.
 * v3: both v2 sets together. Every check below is idempotent and ALL of them
 *     run whenever the stored version is below the current one, so a v2
 *     snapshot that ran only one branch's checks still gets the other's.
 * v4: an acquired company's UNDATED valuation is withheld too (ownership rule,
 *     same acquired_deal_valuation gate); undated estimates are re-dated from
 *     their own stored support first, so a dated pre-deal round still stands.
 */
export const METRIC_GATE_VERSION = 4;

export type RevalidationGate = 'parent_or_acquisition' | 'stale_share_count' | 'sec_revenue_sub_line'
  | 'acquired_deal_valuation' | 'non_subscription_arr';

/** A stored estimate that kept its value but had its date or definition corrected. */
export interface RelabelledMetric {
  metricId: string;
  companyId: string;
  metricType: MetricType;
  /** redated: the stored support's own date was applied; undated: the note now
   * says no date is published; annual_revenue: a financial firm's ARR relabelled. */
  change: 'redated' | 'undated' | 'annual_revenue';
  asOf: string | null;
}

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
  /** Kept figures whose date or definition was corrected. */
  relabelled: RelabelledMetric[];
  /** Companies whose stored summary was reset to the pending placeholder. */
  resetSummaries: Array<{ companyId: string; previous: string }>;
  /** Companies whose stored headquarters was rewritten to the canonical form. */
  normalizedHq: Array<{ companyId: string; previous: string; hqLocation: string }>;
  /** SEC revenue rows whose retained evidence could not decide the sub-line question. */
  undecided: string[];
}

/** The snapshot fields this pass reads and writes. */
export interface RevalidatableSnapshot {
  metricGateVersion?: number;
  companies: Array<{ id: string; name: string; websiteUrl?: string | null; oneLiner?: string; hqLocation?: string | null;
    ownership?: Ownership | null }>;
  cards?: Array<{ companyId: string | null; cardType: CardType; summary: string | null; citations?: Citation[] }>;
  metrics: CompanyMetric[];
  dashboards: Record<string, unknown>;
  researchEvidence?: readonly ResearchEvidence[];
  originalSourceAttempts?: readonly OriginalSourceAttempt[];
}

const NOTES: Record<RevalidationGate, string> = {
  parent_or_acquisition: 'Withdrawn: the stored source sentence gives a parent company\'s figure or an acquisition price, not this company\'s own figure. Unknown until re-researched.',
  stale_share_count: 'Withdrawn: the stored market cap multiplied the share price by a share count more than 400 days older than the price. Unknown until re-researched.',
  sec_revenue_sub_line: 'Withdrawn: the stored SEC revenue was a sub-line concept; the issuer files a larger total for the same period. Unknown until re-researched.',
  acquired_deal_valuation: 'Withdrawn: the company was acquired and this valuation is the deal price, dates from the deal itself, or has no date to show it came before the deal. After an acquisition there is no independent valuation.',
  non_subscription_arr: 'Withdrawn: a financial firm\'s fee revenue was stored as ARR, and the stored source sentence does not state it as annual revenue. Unknown until re-researched.',
};

const UNDATED = /\bundated\b/i;
/** Date or relabel a kept estimate from its own stored evidence. Returns the
 * replacement row, 'reset' when a financial firm's ARR cannot be relabelled,
 * or null when nothing changes. A derived date must pass the same display gate
 * the card runs, or the row stays (explicitly) undated. */
function correctedEstimate(metric: CompanyMetric, company: RevalidatableSnapshot['companies'][number] | undefined):
  { row: CompanyMetric; change: RelabelledMetric['change'] } | 'reset' | null {
  if (metric.confidence !== 'estimated') return null;
  if (metric.reportedSupport && company) {
    const website = company.websiteUrl ?? null;
    let proof = metric.reportedSupport;
    let change: RelabelledMetric['change'] | null = null;
    const definition = storedDefinition(metric.metricType, proof.definition, classifyMarketProfile(company));
    if (definition !== proof.definition) {
      const relabelled = { ...proof, definition };
      if (!supportStatesRevenue(proof.support.text) ||
        !reportedStoredCitations(company.name, website, { ...metric, reportedSupport: relabelled }).length) return 'reset';
      proof = relabelled;
      change = 'annual_revenue';
    }
    if (!proof.asOf) {
      const asOf = storedSupportDate(proof.support.text, metric.capturedAt);
      const dated = asOf ? { ...proof, asOf } : null;
      if (dated && reportedStoredCitations(company.name, website, { ...metric, reportedSupport: dated }).length) {
        proof = dated;
        change ??= 'redated';
      } else if (!UNDATED.test(metric.methodNote ?? '')) change ??= 'undated';
    }
    if (!change) return null;
    return { row: { ...metric, reportedSupport: proof, methodNote: reportedRowNote(metric.metricType, proof) }, change };
  }
  if (metric.reportedBand && !metric.reportedBand.asOf) {
    const asOf = storedSupportDate(metric.reportedBand.support.text, metric.capturedAt);
    if (!asOf && UNDATED.test(metric.methodNote ?? '')) return null;
    const band = { ...metric.reportedBand, asOf };
    return { row: { ...metric, reportedBand: band, methodNote: reportedBandNote(band) }, change: asOf ? 'redated' : 'undated' };
  }
  return null;
}

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
  if (fromVersion >= METRIC_GATE_VERSION) return { fromVersion, ran: false, reset: [], relabelled: [], resetSummaries: [], normalizedHq: [], undecided: [] };

  const names = new Map(snapshot.companies.map((c) => [c.id, c.name]));
  const companies = new Map(snapshot.companies.map((c) => [c.id, c]));
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
  const relabelled: RelabelledMetric[] = [];
  const undecided: string[] = [];
  // Rows are replaced, never mutated: callers may still hold the read snapshot.
  snapshot.metrics = snapshot.metrics.map((metric) => {
    // Only a human may set or clear a user_verified figure.
    if (metric.confidence === 'user_verified' || metric.confidence === 'unknown') return metric;
    // Gates judge the row as its own stored evidence dates it: an undated
    // estimate whose support states a date is judged with that date, so an
    // acquired company's dated pre-deal round is not withheld as undated.
    const corrected = correctedEstimate(metric, companies.get(metric.companyId));
    const judged = corrected && corrected !== 'reset' ? corrected.row : metric;
    let gate = failedGate(judged, names.get(metric.companyId),
      () => answersFor(metric.companyId), () => receiptsFor(metric.companyId), undecided, companies.get(metric.companyId)?.ownership);
    if (!gate) {
      if (corrected === null) return metric;
      if (corrected !== 'reset') {
        relabelled.push({ metricId: metric.id, companyId: metric.companyId, metricType: metric.metricType,
          change: corrected.change, asOf: corrected.row.reportedSupport?.asOf ?? corrected.row.reportedBand?.asOf ?? null });
        return corrected.row;
      }
      gate = 'non_subscription_arr';
    }
    reset.push({ metricId: metric.id, companyId: metric.companyId, metricType: metric.metricType, gate, previousValue: metric.value });
    return { ...metric, value: null, confidence: 'unknown', source: null, citations: [], methodNote: NOTES[gate],
      passageSupport: null, reportedSupport: null, quotedSupport: null, lastVerifiedAt: null };
  });
  // Summaries are model-free copy from a source page; no human edits them, so
  // an unfit one goes back to the pending placeholder the asset and hydration
  // lanes refill. The entity cards mirror it (with its citation).
  const resetSummaries: RevalidationOutcome['resetSummaries'] = [];
  const summaries = new Map<string, string>();
  // Headquarters: same place, one display form ("City, Full State" in the US,
  // "City, Country" elsewhere). Input it cannot read is left as it is.
  const normalizedHq: RevalidationOutcome['normalizedHq'] = [];
  snapshot.companies = snapshot.companies.map((company) => {
    let next = company;
    const hq = company.hqLocation?.trim() ? canonicalHqLocation(company.hqLocation) : null;
    if (hq && hq !== company.hqLocation) {
      normalizedHq.push({ companyId: company.id, previous: company.hqLocation!, hqLocation: hq });
      next = { ...next, hqLocation: hq };
    }
    const previous = company.oneLiner;
    if (!previous || isPendingCompanySummary(previous) || !summaryIsUnfit(previous)) return next;
    resetSummaries.push({ companyId: company.id, previous });
    summaries.set(company.id, previous);
    return { ...next, oneLiner: UNSUPPORTED_COMPANY_SUMMARY };
  });
  if (snapshot.cards && summaries.size) {
    snapshot.cards = snapshot.cards.map((card) => {
      const previous = card.companyId ? summaries.get(card.companyId) : undefined;
      if (previous === undefined || !isEntityCardType(card.cardType) || !card.summary ||
        (card.summary !== previous && !summaryIsUnfit(card.summary))) return card;
      return { ...card, summary: UNSUPPORTED_COMPANY_SUMMARY, citations: [] };
    });
  }
  // A cached dashboard may restate a withdrawn figure, or a revenue figure as
  // "ARR". Dashboards are model-written tabs that do not mirror the summary or
  // HQ fields, and regenerating one is a paid call: a date, summary or HQ
  // correction alone keeps it.
  const touched = new Set([...reset, ...relabelled.filter((r) => r.change === 'annual_revenue')].map((r) => r.companyId));
  if (touched.size) snapshot.dashboards = { ...snapshot.dashboards, ...Object.fromEntries([...touched].map((id) => [id, {}])) };
  snapshot.metricGateVersion = METRIC_GATE_VERSION;
  return { fromVersion, ran: true, reset, relabelled, resetSummaries, normalizedHq, undecided };
}
