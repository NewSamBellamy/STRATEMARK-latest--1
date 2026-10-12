import { METRIC_TYPES, companyMetricSchema, currentMetricRevision, metricPassageSupportSchema,
  validMetricVerificationValue, isSignalCardType, type CardWithCompany, type Company, type CompanyMetric } from '@mi/contracts';
import { currencyConversionNote, inspectMetricPassage } from './metric-support';
import { CARD_FACT_TYPES, reportedBandCitations, reportedStoredCitations } from './reported-metrics';
import { quotedStoredCitations } from './quoted-estimate';
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
export function projectCompanyFacts(company: Company, observations: readonly CompanyMetric[], attempts: unknown): CompanyMetric[] {
  return projectCompanyFactsFromOriginals(company, observations, companyOriginalReceipts(company.id, attempts, originalSupportReferences(observations, company.id)));
}

export function projectCompanyCardFacts(card: CardWithCompany, attempts: unknown): CardWithCompany {
  return { ...structuredClone(card), metrics: card.company && !isSignalCardType(card.card.cardType)
    ? projectCompanyFacts(card.company, card.metrics, attempts) : [] };
}

/** Method note on a fact withheld because current observations disagree. Later
 * passes (saved-profile repair) must keep it unknown, never pick a side. */
export const CONFLICTING_OBSERVATIONS_NOTE = 'Conflicting current observations; confirm before displaying a fact.';

/** For callers that have already scoped original receipts to this company. */
export function projectCompanyFactsFromOriginals(company: Company, observations: readonly CompanyMetric[], originals: readonly OriginalSourceReceipt[]): CompanyMetric[] {
  const valid = observations.flatMap(row => {
    const parsed = companyMetricSchema.safeParse(row);
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
      const quoted = quotedStoredCitations(company.name, metric, originals);
      if (quoted.length) return [{ ...structuredClone(metric), citations: quoted, source: quoted[0]!.url, passageSupport: null, lastVerifiedAt: null }];
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
      methodNote: `Source reported ${metric.reportedSupport!.definition ?? type} (${metric.reportedSupport!.asOf ? `as of ${metric.reportedSupport!.asOf}` : 'undated; reporting date not published'}); provider-grounded, not verified against an original.${CARD_FACT_TYPES.includes(type) ? ` Source statement: ${JSON.stringify(metric.reportedSupport!.support.text.replace(/\s+/g, ' ').trim().slice(0, 240))}` : ''}${metric.reportedSupport!.unit !== 'USD' && metric.reportedSupport!.unit !== 'count' && metric.reportedSupport!.unit !== 'percent' ? ` ${currencyConversionNote(metric.reportedSupport!.value, metric.reportedSupport!.unit)}` : ''}` }];
    const proof = metricPassageSupportSchema.safeParse(metric.passageSupport);
    // Market share needs a defined market/denominator/period contract. A dated
    // percentage in a sentence is not that contract; automatic shares wait.
    const assessment = !current.ambiguous && bounded && metric.confidence === 'verified' && proof.success && type !== 'market_share' &&
      !(type === 'users' && metric.value === 0)
      ? inspectMetricPassage({ companyName: company.name, officialWebsite: company.websiteUrl, metricType: type, value: metric.value, support: proof.data, originals }) : null;
    const citations = assessment?.citations ?? [];
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
