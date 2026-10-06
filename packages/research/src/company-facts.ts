import { METRIC_TYPES, companyMetricSchema, currentMetricRevision, metricPassageSupportSchema,
  validMetricVerificationValue, isSignalCardType, type CardWithCompany, type Company, type CompanyMetric } from '@mi/contracts';
import { acceptedMetricPassage } from './metric-support';
import { isOriginalSourceAttempt, type OriginalSourceAttempt, type OriginalSourceReceipt } from './original-source';

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
export function companyOriginalReceipts(companyId: string, attempts: unknown): OriginalSourceReceipt[] {
  return Array.isArray(attempts) ? attempts.filter(isOriginalSourceAttempt).filter(row => row.companyId === companyId)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, 20).flatMap(row => row.receipts) : [];
}

/** The public facts lane. Raw observations remain separate, never rewritten.
 * A citation or a retained model proposal alone cannot establish a figure. */
export function projectCompanyFacts(company: Company, observations: readonly CompanyMetric[], attempts: unknown): CompanyMetric[] {
  return projectCompanyFactsFromOriginals(company, observations, companyOriginalReceipts(company.id, attempts));
}

export function projectCompanyCardFacts(card: CardWithCompany, attempts: unknown): CardWithCompany {
  return { ...structuredClone(card), metrics: card.company && !isSignalCardType(card.card.cardType)
    ? projectCompanyFacts(card.company, card.metrics, attempts) : [] };
}

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
    const bounded = validMetricVerificationValue(type, metric.value) &&
      (!['employees', 'users'].includes(type) || Number.isSafeInteger(metric.value));
    if (!current.ambiguous && bounded && metric.confidence === 'user_verified') return [structuredClone(metric)];
    const proof = metricPassageSupportSchema.safeParse(metric.passageSupport);
    // Market share needs a defined market/denominator/period contract. A dated
    // percentage in a sentence is not that contract; automatic shares wait.
    const citations = !current.ambiguous && bounded && metric.confidence === 'verified' && proof.success && type !== 'market_share' &&
      !(type === 'users' && metric.value === 0)
      ? acceptedMetricPassage({ companyName: company.name, officialWebsite: company.websiteUrl, metricType: type, value: metric.value, support: proof.data, originals }) : [];
    if (citations.length) return [{ ...structuredClone(metric), citations, source: citations[0]!.url,
      methodNote: citations[0]!.title.startsWith('Issuer-reported')
        ? `Issuer-reported figure; original passage checked, not independently corroborated. ${metric.methodNote ?? ''}`.trim()
        : metric.methodNote }];
    return [{ ...structuredClone(metric), value: null, confidence: 'unknown' as const, citations: [], source: null,
      passageSupport: null, lastVerifiedAt: null,
      methodNote: current.ambiguous ? 'Conflicting current observations; confirm before displaying a fact.'
        : type === 'market_share' ? 'No accepted market definition, denominator and reporting-period evidence. Raw observations remain saved.'
          : 'No accepted original-backed current fact. Raw observations remain saved for inspection and correction.' }];
  });
}
