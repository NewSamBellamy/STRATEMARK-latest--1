import { METRIC_TYPES, companyMetricSchema, currentMetricRevision, metricPassageSupportSchema,
  validMetricVerificationValue, type Company, type CompanyMetric, type MetricType } from '@mi/contracts';
import { inspectMetricPassage } from './metric-support';
import { reportedBandCitations, reportedRowNote, reportedStoredCitations } from './reported-metrics';
import { quotedStoredCitations } from './quoted-estimate';
import { AGED_OUT_NOTE_PREFIX } from './source-assessment';
import { isOriginalSourceAttempt, originalSupportReferences, selectOriginalSourceAttempts, type OriginalSourceAttempt, type OriginalSourceReceipt, type OriginalSourceQuery } from './original-source';

/** Read adapter for the existing retained cloud verification ledger. Synthetic
 * IDs identify local read rows only, not immutable provenance or truth. Callers
 * must already have authorized the owning deck; matching original passages,
 * not these IDs or model proposals, establish mechanical support. */
export function retainedDiagnosticAttempts(input: unknown): OriginalSourceAttempt[] {
  return Array.isArray(input) ? input.flatMap((row, index) => {
    if (!row || typeof row !== 'object') return [];
    const attempt = { ...row, id: `src_cloud_diagnostic_${index}` };
    return isOriginalSourceAttempt(attempt) ? [attempt] : [];
  }) : [];
}

/** Bounded, scoped saved documents only; no fetching or provider work. */
export function companyOriginalReceipts(companyId: string, attempts: unknown, support?: OriginalSourceQuery['support']): OriginalSourceReceipt[] {
  return Array.isArray(attempts) ? selectOriginalSourceAttempts(attempts.filter(isOriginalSourceAttempt), { companyId, limit: 20, support }).flatMap(row => row.receipts) : [];
}

/** The public facts lane. Raw observations remain separate, never rewritten.
 * A citation or a retained model proposal alone cannot establish a figure. */
export function projectCompanyFacts(company: Company, observations: readonly CompanyMetric[], attempts: unknown, options: ProjectOptions = {}): CompanyMetric[] {
  return projectCompanyFactsFromOriginals(company, observations, companyOriginalReceipts(company.id, attempts, originalSupportReferences(observations, company.id)), options);
}

export interface ProjectOptions {
  /** The clock for the 366-day evidence window; defaults to the present. */
  nowMs?: number;
  /**
   * Show a verified/quoted figure outside the 366-day window as a dated ESTIMATE
   * (shown_aged_out) instead of dropping it to unknown, when its passage passes
   * every other check re-run as of its own receipt's retrievedAt. Display only:
   * hunts and readiness leave this off, so they see the unknown they always saw.
   */
  showAgedOut?: boolean;
  /** Filled with the metric types that came out as aged-out estimates: the structured marker (the note is display text only). */
  agedOut?: Set<MetricType>;
}

const WINDOW_MS = 366 * 86_400_000;

/** When the retained page behind a source URL was fetched (latest receipt), or null. */
function retrievedAtMs(originals: readonly OriginalSourceReceipt[], url: string): number | null {
  const times = originals.filter((o) => o.status === 'retrieved' && (o.finalUrl === url || o.requestedUrl === url))
    .map((o) => Date.parse(o.retrievedAt)).filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

/** An estimate shown with its date because its figure is older than the verified window. */
function agedOutRow(metric: CompanyMetric, citations: CompanyMetric['citations'], asOf: string): CompanyMetric {
  return { ...structuredClone(metric), confidence: 'estimated', citations, source: citations[0]?.url ?? metric.source, lastVerifiedAt: null,
    methodNote: `${AGED_OUT_NOTE_PREFIX}as of ${asOf}, shown as a dated estimate. ${metric.methodNote ?? ''}`.trim() };
}

const olderThanWindow = (asOf: string, nowMs: number): boolean => nowMs - Date.parse(`${asOf}T00:00:00.000Z`) > WINDOW_MS;

/** Method note on a fact withheld because current observations disagree. Later
 * passes (saved-profile repair) must keep it unknown, never pick a side. */
export const CONFLICTING_OBSERVATIONS_NOTE = 'Conflicting current observations; confirm before displaying a fact.';

/** For callers that have already scoped original receipts to this company. */
export function projectCompanyFactsFromOriginals(company: Company, observations: readonly CompanyMetric[], originals: readonly OriginalSourceReceipt[], options: ProjectOptions = {}): CompanyMetric[] {
  const nowMs = options.nowMs ?? Date.now();
  const valid = observations.flatMap(row => {
    // An incoming assessment is never trusted (it is recomputed on read), and a malformed one must not cost the figure.
    const { assessment: _discarded, ...stored } = row;
    void _discarded;
    const parsed = companyMetricSchema.safeParse(stored);
    return parsed.success && parsed.data.companyId === company.id ? [parsed.data] : [];
  });
  return METRIC_TYPES.flatMap(type => {
    const current = currentMetricRevision(valid, company.id, type);
    if (!current) return [];
    const metric = current.metric;
    // A stated headcount BAND has no point value (value stays null); it passes
    // through only when its stored sentence still passes the band gate.
    if (!current.ambiguous && type === 'employees' && metric.confidence === 'estimated' && metric.value === null && metric.reportedBand) {
      const bandCitations = reportedBandCitations(company.name, company.websiteUrl, metric);
      return bandCitations.length ? [{ ...structuredClone(metric), citations: bandCitations, source: bandCitations[0]!.url,
        passageSupport: null, reportedSupport: null, lastVerifiedAt: null }] : [];
    }
    const bounded = validMetricVerificationValue(type, metric.value) &&
      (!['employees', 'users'].includes(type) || Number.isSafeInteger(metric.value));
    if (!current.ambiguous && bounded && metric.confidence === 'user_verified') return [structuredClone(metric)];
    // Undated market caps read as today's figure; see reportedCompanyMetrics.
    const staleMarketCap = type === 'market_cap' && metric.reportedSupport != null && !metric.reportedSupport.asOf;
    const reportedCitations = !current.ambiguous && bounded && metric.confidence === 'estimated' && !staleMarketCap
      ? reportedStoredCitations(company.name, company.websiteUrl, metric) : [];
    // A figure quoted word for word from a fetched page: re-run the whole lane
    // (quote, company, value, date, hedging, and presence on the retained page).
    if (!current.ambiguous && bounded && metric.quotedSupport) {
      const quoted = quotedStoredCitations(company.name, metric, originals, options.nowMs);
      if (quoted.length) return [{ ...structuredClone(metric), citations: quoted, source: quoted[0]!.url, passageSupport: null, lastVerifiedAt: null }];
      // Outside the window: shown as a dated estimate only if the lane passes as of the page's own retrieval.
      const q = metric.quotedSupport;
      const fetchedAt = options.showAgedOut ? retrievedAtMs(originals, q.sourceUrl) : null;
      if (fetchedAt != null && olderThanWindow(q.asOf, nowMs)) {
        const aged = quotedStoredCitations(company.name, metric, originals, fetchedAt);
        if (aged.length) { options.agedOut?.add(type); return [{ ...agedOutRow(metric, aged, q.asOf), passageSupport: null }]; }
      }
    }
    // A computation from retained sources (the market-cap quote lane) keeps its
    // own two named citations — both are retained originals; the row's
    // methodNote labels it a computation, never a reported figure.
    if (!current.ambiguous && bounded && metric.confidence === 'estimated' && metric.passageSupport === null &&
      metric.reportedSupport === null && !metric.quotedSupport && metric.citations.length > 0 && !reportedCitations.length &&
      metric.citations.every((c) => originals.some((o) => o.finalUrl === c.url || o.requestedUrl === c.url))) {
      return [structuredClone(metric)];
    }
    if (reportedCitations.length) return [{ ...structuredClone(metric), citations: reportedCitations,
      source: reportedCitations[0]!.url, passageSupport: null, lastVerifiedAt: null,
      methodNote: reportedRowNote(type, metric.reportedSupport!) }];
    const proof = metricPassageSupportSchema.safeParse(metric.passageSupport);
    // Market share needs a defined market/denominator/period contract. A dated
    // percentage in a sentence is not that contract; automatic shares wait.
    const assessment = !current.ambiguous && bounded && metric.confidence === 'verified' && proof.success && type !== 'market_share' &&
      !(type === 'users' && metric.value === 0)
      ? inspectMetricPassage({ companyName: company.name, officialWebsite: company.websiteUrl, metricType: type, value: metric.value, support: proof.data, originals, nowMs: options.nowMs }) : null;
    const citations = assessment?.citations ?? [];
    // Verified, but outside the 366-day window: a dated estimate if the passage passes every other check as of its
    // own retrieval (never when it does not: that stays unknown, as before).
    if (!citations.length && options.showAgedOut && !current.ambiguous && bounded && metric.confidence === 'verified' && proof.success &&
      type !== 'market_share' && !(type === 'users' && metric.value === 0) && olderThanWindow(proof.data.asOf, nowMs)) {
      const fetchedAt = retrievedAtMs(originals, proof.data.sourceUrl);
      const rerun = fetchedAt == null ? null : inspectMetricPassage({ companyName: company.name, officialWebsite: company.websiteUrl,
        metricType: type, value: metric.value, support: proof.data, originals, nowMs: fetchedAt });
      if (rerun?.citations.length) { options.agedOut?.add(type); return [agedOutRow(metric, rerun.citations, proof.data.asOf)]; }
    }
    if (citations.length) return [{ ...structuredClone(metric), citations, source: citations[0]!.url,
      methodNote: citations[0]!.title.startsWith('Issuer-reported')
        ? `Issuer-reported figure; original passage checked, not independently corroborated. ${metric.methodNote ?? ''}`.trim()
        : metric.methodNote }];
    return [{ ...structuredClone(metric), value: null, confidence: 'unknown' as const, citations: [], source: null,
      passageSupport: null, reportedSupport: null, lastVerifiedAt: null,
      methodNote: current.ambiguous ? CONFLICTING_OBSERVATIONS_NOTE
        : type === 'market_share' ? 'No accepted market definition, denominator and reporting-period evidence. Raw observations remain saved.'
          : `${assessment?.reason ?? 'No accepted original-backed current fact.'} Raw observations remain saved for inspection and correction.` }];
  });
}
