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
  type MetricType, type Ownership, type CompanyFounded } from '@mi/contracts';
import { hasPlaceholderName } from './placeholder-names';
import { canonicalHqLocation, hqGroundedInEvidence } from './brand/hq-format';
import { scrubOneLiner } from './oneliner-scrub';
import { isPendingCompanySummary, summaryIsUnfit, UNSUPPORTED_COMPANY_SUMMARY } from './company-summary';
import type { OriginalSourceAttempt, OriginalSourceReceipt } from './original-source';
import type { ResearchEvidence } from './research-evidence';
import { reportedBandNote, reportedRowNote, reportedStoredCitations, storedDefinition, storedReportedFigureMisattributed,
  supportStatesRevenue,
  storedSupportDate } from './reported-metrics';
import { shareCountTooOld, storedMarketCapDates } from './market-quote';
import { storedSecRevenueIsSubLine } from './sec-revenue';
import { implausibleScaleFigures, SCALE_NOTES, type ScaleGate } from './scale-plausibility';
import { storedWebsiteFoundedFails } from './founded-year';

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
 * v5: stored headquarters must be derivable from the company's own retained
 *     research text: a "City, State" whose state does not stand beside that
 *     city there is cut back to what the text literally says (city + the state
 *     it names, else the bare city). Text that never names the city decides
 *     nothing. All v1-v4 checks still run.
 * v6: stored companies whose name is a template row ("Company Two", "Example
 *     Corp", "Competitor A") are dropped with their cards, figures and claims.
 *     All v1-v5 checks still run.
 * v7: a stored company description that no source backs (no entity card cites
 *     it) is a model's own line: unverifiable wording ("pioneering", "global
 *     category leader") is scrubbed out, and one that boasts beyond repair or
 *     only says where the company is goes back to the pending placeholder.
 *     Cited (source-sentence) descriptions are never rewritten. Idempotent;
 *     runs alongside every v1-v6 check.
 * v8: unverified scale figures that another company's evidence produced are
 *     withheld (scale-plausibility.ts): revenue/ARR or market cap/valuation the
 *     company's own headcount cannot carry, and an identical large figure that
 *     sits on two companies of one deck/market where this holder's evidence
 *     names the other, its retained batch answer places it in the other's
 *     section, or its per-head scale is 100x the other's. Runs alongside every
 *     v1-v7 check.
 * v9: unverified headcounts that are not the company's own staff are withheld
 *     (headcount-reach.ts, applied in the scale pass): an `employees` row whose
 *     stored support frames the number as people the company serves or reaches
 *     ("6 million employees use DailyPay", "serving 112,000 employees at 12,000
 *     employers"), or one above 2.5M (beyond any real employer). Withheld
 *     before the v8 per-head checks, so a reach figure never serves as their
 *     denominator. Verified and user_verified rows are never touched. Runs
 *     alongside every v1-v8 check.
 * v10: a stored founding year read from the company's own page is cleared
 *     when the current rules would not read it again: the year the page was
 *     read (a copyright footer or a template's default foundingDate) or a
 *     copyright line with a legal name ("© ABM Industries Incorporated 2026").
 *     The founded-year ladder fills it again. Runs alongside every v1-v9 check.
 * v11: unverified figures that are a digit of a date are withheld
 *     (date-digits.ts, applied in the scale pass as `date_digit_figure`): a row
 *     whose value appears in its own stored support only as a day of the month,
 *     a year or a quarter inside a date, and never there as a standalone number
 *     (Ecolab stored as 29 employees from "… as reported on September 29,
 *     2026"). Withheld before the v8 per-head checks, so it never serves as
 *     their denominator. Verified and user_verified rows are never touched.
 *     Runs alongside every v1-v10 check.
 */
export const METRIC_GATE_VERSION = 11;

/**
 * The text a saved research note holds. A note whose text is missing or not text
 * (a file that was edited, or an older build) contributes nothing; it must not
 * stop every start, which is what reading its length did.
 */
const evidenceTexts = (note: { text?: unknown; grounding?: { answerText?: unknown } | null }): string[] =>
  [note.text, note.grounding?.answerText].filter((t): t is string => typeof t === 'string' && t.length > 0);

export type RevalidationGate = 'parent_or_acquisition' | 'stale_share_count' | 'sec_revenue_sub_line'
  | 'acquired_deal_valuation' | 'non_subscription_arr' | ScaleGate;

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
  /** Template-named companies ("Company Two") removed from the snapshot. */
  droppedPlaceholders?: Array<{ companyId: string; name: string }>;
  /** Gate version found on the snapshot (0 when it was never revalidated). */
  fromVersion: number;
  /** True when this call ran the checks (the stored version was older). */
  ran: boolean;
  reset: RevalidatedMetric[];
  /** Kept figures whose date or definition was corrected. */
  relabelled: RelabelledMetric[];
  /** Companies whose stored summary was reset to the pending placeholder. */
  resetSummaries: Array<{ companyId: string; previous: string }>;
  /** Uncited model-written descriptions scrubbed of unverifiable wording
   * (`next` null: nothing descriptive was left, so the placeholder was restored). */
  scrubbedSummaries: Array<{ companyId: string; previous: string; next: string | null }>;
  /** Companies whose stored headquarters was rewritten to the canonical form. */
  normalizedHq: Array<{ companyId: string; previous: string; hqLocation: string }>;
  /** Companies whose stored website founding year failed the v10 rules and was cleared. */
  clearedFounded: Array<{ companyId: string; year: number }>;
  /** SEC revenue rows whose retained evidence could not decide the sub-line question. */
  undecided: string[];
}

/** The snapshot fields this pass reads and writes. */
export interface RevalidatableSnapshot {
  metricGateVersion?: number;
  companies: Array<{ id: string; name: string; websiteUrl?: string | null; oneLiner?: string; hqLocation?: string | null;
    ownership?: Ownership | null; founded?: CompanyFounded | null }>;
  viceClaims?: Array<{ cardId: string }>;
  companyMarket?: Record<string, string>;
  cards?: Array<{ id?: string; deckId?: string; companyId: string | null; cardType: CardType; summary: string | null; citations?: Citation[] }>;
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
  ...SCALE_NOTES,
};

/** Company-id groups that share a deck or a market: the cross-company scope. */
export function figureScopes(snapshot: Pick<RevalidatableSnapshot, 'cards' | 'companyMarket'>): string[][] {
  const groups = new Map<string, Set<string>>();
  const add = (key: string, id: string) => { const g = groups.get(key) ?? new Set<string>(); g.add(id); groups.set(key, g); };
  for (const card of snapshot.cards ?? []) if (card.deckId && card.companyId) add(`deck:${card.deckId}`, card.companyId);
  for (const [id, market] of Object.entries(snapshot.companyMarket ?? {})) add(`market:${market}`, id);
  return [...groups.values()].filter((g) => g.size > 1).map((g) => [...g]);
}

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
  if (fromVersion >= METRIC_GATE_VERSION) return { fromVersion, ran: false, reset: [], relabelled: [], resetSummaries: [], scrubbedSummaries: [], normalizedHq: [], clearedFounded: [], undecided: [] };

  // Template rows were never businesses: drop them, and everything keyed to
  // them, before any figure gate looks at their evidence.
  const droppedPlaceholders = snapshot.companies.filter((c) => hasPlaceholderName(c.name))
    .map((c) => ({ companyId: c.id, name: c.name }));
  if (droppedPlaceholders.length) {
    const gone = new Set(droppedPlaceholders.map((d) => d.companyId));
    snapshot.companies = snapshot.companies.filter((c) => !gone.has(c.id));
    snapshot.metrics = snapshot.metrics.filter((m) => !gone.has(m.companyId));
    const goneCards = new Set((snapshot.cards ?? []).filter((c) => c.companyId && gone.has(c.companyId)).map((c) => c.id));
    if (snapshot.cards) snapshot.cards = snapshot.cards.filter((c) => !c.companyId || !gone.has(c.companyId));
    if (snapshot.viceClaims) snapshot.viceClaims = snapshot.viceClaims.filter((v) => !goneCards.has(v.cardId));
    if (snapshot.companyMarket) snapshot.companyMarket = Object.fromEntries(Object.entries(snapshot.companyMarket).filter(([id]) => !gone.has(id)));
    snapshot.dashboards = Object.fromEntries(Object.entries(snapshot.dashboards).filter(([id]) => !gone.has(id)));
  }
  const names = new Map(snapshot.companies.map((c) => [c.id, c.name]));
  const companies = new Map(snapshot.companies.map((c) => [c.id, c]));
  const answersByCompany = new Map<string, string[]>();
  const answersFor = (companyId: string) => {
    let found = answersByCompany.get(companyId);
    if (!found) {
      found = (snapshot.researchEvidence ?? []).filter((e) => e.companyId === companyId)
        .flatMap(evidenceTexts);
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
  // Snapshot-level scale gate: needs every company's headcount and the deck's
  // other holders of the same figure, so it runs over the per-row result.
  const answers = [...new Set((snapshot.researchEvidence ?? []).flatMap(evidenceTexts))];
  const scale = new Map(implausibleScaleFigures({ companies: snapshot.companies, metrics: snapshot.metrics,
    scopes: figureScopes(snapshot), answers }).map((f) => [f.metricId, f]));
  if (scale.size) {
    snapshot.metrics = snapshot.metrics.map((metric) => {
      const finding = scale.get(metric.id);
      if (!finding) return metric;
      reset.push(finding);
      const index = relabelled.findIndex((r) => r.metricId === metric.id);
      if (index >= 0) relabelled.splice(index, 1);
      return { ...metric, value: null, confidence: 'unknown', source: null, citations: [], methodNote: NOTES[finding.gate],
        passageSupport: null, reportedSupport: null, quotedSupport: null, lastVerifiedAt: null };
    });
  }
  // Summaries are model-free copy from a source page; no human edits them, so
  // an unfit one goes back to the pending placeholder the asset and hydration
  // lanes refill. The entity cards mirror it (with its citation).
  const resetSummaries: RevalidationOutcome['resetSummaries'] = [];
  const summaries = new Map<string, string>();
  const scrubbedSummaries: RevalidationOutcome['scrubbedSummaries'] = [];
  const scrubbed = new Map<string, { previous: string; next: string }>();
  const citedCompanies = new Set((snapshot.cards ?? []).filter((card) => card.companyId && isEntityCardType(card.cardType) &&
    card.citations?.length).map((card) => card.companyId!));
  // Headquarters: same place, one display form ("City, Full State" in the US,
  // "City, Country" elsewhere). Input it cannot read is left as it is.
  const normalizedHq: RevalidationOutcome['normalizedHq'] = [];
  const clearedFounded: RevalidationOutcome['clearedFounded'] = [];
  snapshot.companies = snapshot.companies.map((company) => {
    let next = company;
    let hq = company.hqLocation?.trim() ? canonicalHqLocation(company.hqLocation) : null;
    if (hq) {
      const evidence = (snapshot.researchEvidence ?? []).filter((item) => item.companyId === company.id).map((item) => typeof item.text === 'string' ? item.text : '').join(' ');
      hq = hqGroundedInEvidence(hq, evidence);
    }
    if (hq && hq !== company.hqLocation) {
      normalizedHq.push({ companyId: company.id, previous: company.hqLocation!, hqLocation: hq });
      next = { ...next, hqLocation: hq };
    }
    // v10: a website founding year that is a copyright footer or this year.
    if (storedWebsiteFoundedFails(company.founded)) {
      clearedFounded.push({ companyId: company.id, year: company.founded!.year });
      next = { ...next, founded: null };
    }
    const previous = company.oneLiner;
    if (previous && !isPendingCompanySummary(previous) && !summaryIsUnfit(previous) && !citedCompanies.has(company.id)) {
      const cleaned = scrubOneLiner(previous);
      if (cleaned !== previous) {
        const replacement = cleaned ?? UNSUPPORTED_COMPANY_SUMMARY;
        scrubbedSummaries.push({ companyId: company.id, previous, next: cleaned });
        scrubbed.set(company.id, { previous, next: replacement });
        return { ...next, oneLiner: replacement };
      }
    }
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
  if (snapshot.cards && scrubbed.size) {
    snapshot.cards = snapshot.cards.map((card) => {
      const change = card.companyId ? scrubbed.get(card.companyId) : undefined;
      if (!change || !isEntityCardType(card.cardType) || card.citations?.length) return card;
      const cleaned = card.summary === change.previous ? change.next : card.summary ? scrubOneLiner(card.summary) ?? UNSUPPORTED_COMPANY_SUMMARY : card.summary;
      return cleaned === card.summary ? card : { ...card, summary: cleaned };
    });
  }
  // A cached dashboard may restate a withdrawn figure, or a revenue figure as
  // "ARR". Dashboards are model-written tabs that do not mirror the summary or
  // HQ fields, and regenerating one is a paid call: a date, summary or HQ
  // correction alone keeps it.
  const touched = new Set([...reset, ...relabelled.filter((r) => r.change === 'annual_revenue')].map((r) => r.companyId));
  if (touched.size) snapshot.dashboards = { ...snapshot.dashboards, ...Object.fromEntries([...touched].map((id) => [id, {}])) };
  snapshot.metricGateVersion = METRIC_GATE_VERSION;
  return { fromVersion, ran: true, droppedPlaceholders, reset, relabelled, resetSummaries, scrubbedSummaries, normalizedHq, clearedFounded, undecided };
}
