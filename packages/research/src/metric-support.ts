import { hasVerificationGradeCitation, usableCitations, validMetricVerificationValue, type Citation, type MetricType } from '@mi/contracts';
import type { OriginalSourceReceipt } from './original-source';

export interface MetricPassageSupport { sourceUrl: string; quote: string; asOf: string; basis: MetricType; unit: 'USD' | 'count' | 'percent' }
const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const basis: Record<MetricType, RegExp> = {
  arr: /\b(?:ARR|annual recurring revenue)\b/i,
  valuation: /\b(?:valuation|valued at)\b/i,
  market_cap: /\b(?:market cap|market capitalization)\b/i,
  users: /\b(?:users|active users)\b/i,
  employees: /\b(?:employees|headcount)\b/i,
  market_share: /\bmarket share\b/i,
};

/** Conservative mechanical passage support, not semantic truth or exhaustive evidence. */
export function acceptedMetricPassage(input: { companyName: string; officialWebsite?: string | null; nowMs?: number; metricType: MetricType; value: number | null; support?: MetricPassageSupport | null; originals: readonly OriginalSourceReceipt[] }): Citation[] {
  return inspectMetricPassage(input).citations;
}

/** One acceptance decision and its explanation. Never re-fetch or relax proof
 * to explain a gap; existing callers keep the citations-only interface. */
export function inspectMetricPassage(input: Parameters<typeof acceptedMetricPassage>[0]): { citations: Citation[]; reason: string | null } {
  const reject = (reason: string) => ({ citations: [] as Citation[], reason });
  const proof = input.support;
  if (!proof || !validMetricVerificationValue(input.metricType, input.value) || proof.basis !== input.metricType ||
    !/^\d{4}-\d{2}-\d{2}$/.test(proof.asOf)) return reject('Missing or incompatible claim evidence. Research needs a dated passage for this metric and unit.');
  const date = new Date(`${proof.asOf}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== proof.asOf) return reject('Reporting date is not a valid calendar date.');
  // Reopening an old receipt or checking it again does not renew its reporting
  // period. This is the existing 366-day outer ceiling, not per-metric freshness.
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs) || date.getTime() > nowMs || nowMs - date.getTime() > 366 * 86400000) return reject('Reporting date is outside the current evidence window. Find a current, explicitly dated source.');
  const quote = normalize(proof.quote);
  const company = normalize(input.companyName);
  const dateForms = [proof.asOf, ...(['long', 'short'] as const).flatMap((month) => [
    new Intl.DateTimeFormat('en-US', { year: 'numeric', month, day: 'numeric', timeZone: 'UTC' }).format(date),
    new Intl.DateTimeFormat('en-GB', { year: 'numeric', month, day: 'numeric', timeZone: 'UTC' }).format(date),
  ])];
  const literalDate = dateForms.find((value) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(value)}(?![\\p{L}\\p{N}])`, 'iu').test(quote));
  if (quote.length < 10 || quote.length > 600 || !company ||
    !new RegExp(`(?<![\\p{L}\\p{N}])${escape(company)}(?![\\p{L}\\p{N}])`, 'iu').test(quote) || !literalDate ||
    !basis[input.metricType].test(quote) || /\b(?:not|estimated?|projects?|projected|forecasts?|targets?|expects?|expected|might|could|would|may|approximately|about)\b|~/i.test(quote)) return reject('Passage does not explicitly support this company, metric and reporting date, or describes an estimate.');
  // Keyword co-occurrence is not attribution: the company, metric and date
  // must form one direct statement. Ambiguous prose stays unknown rather than
  // borrowing a partner's figure or mistaking an article date for an as-of date.
  const subject = new RegExp(`(?<![\\p{L}\\p{N}])${escape(company)}(?![\\p{L}\\p{N}])(?:['’]s)?\\s+(?:reports?|reported|has|had|recorded|disclosed|announced|employs?|employed|was|is)\\b`, 'iu');
  const withoutCompany = quote.replace(new RegExp(`${escape(company)}(?:['’]s)?`, 'giu'), 'COMPANY');
  if (!subject.test(quote) || /[.!?;]\s+/.test(withoutCompany) ||
    /\bthat\b|[\p{L}\p{N}]+['’]s\b/iu.test(withoutCompany) ||
    /\b(?:article|published|publication|posted|retrieved|updated)\b/i.test(quote) ||
    !new RegExp(`\\b(?:as of|on|at)\\s+${escape(literalDate)}(?![\\p{L}\\p{N}])`, 'iu').test(quote) ||
    Object.entries(basis).some(([type, pattern]) => type !== input.metricType && pattern.test(quote))) return reject('Claim attribution is ambiguous. A direct company statement and metric reporting date are required, not an article date or another company’s figure.');
  const expectedUnit = ['arr', 'valuation', 'market_cap'].includes(input.metricType) ? 'USD' : input.metricType === 'market_share' ? 'percent' : 'count';
  if (proof.unit !== expectedUnit || (expectedUnit === 'USD' && !/\bUSD\b|US\$|U\.S\. dollars/i.test(quote)) ||
    (expectedUnit === 'percent' && !/%|\bpercent\b/i.test(quote))) return reject('Metric unit is not explicitly supported. Revenue, ARR and currencies are not interchangeable.');
  // Exactly one distinct number (apart from the explicit date) avoids choosing
  // among conflicting/adjacent figures. Do not coerce revenue into ARR.
  const withoutDate = quote.replace(new RegExp(escape(literalDate), 'gi'), '');
  const numbers = [...withoutDate.matchAll(/\b(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million|thousand|[TBMK])?\b/gi)]
    .map((match) => Number(match[1]!.replaceAll(',', '')) * ({ trillion: 1e12, billion: 1e9, million: 1e6, thousand: 1e3, t: 1e12, b: 1e9, m: 1e6, k: 1e3 }[match[2]?.toLowerCase() ?? ''] ?? 1));
  if (!numbers.length || numbers.some((number) => Math.abs(number - input.value!) > Math.max(1, input.value!) * 1e-9)) return reject('Passage contains a different or ambiguous numeric value.');
  const matching = input.originals.filter(source => source.finalUrl === proof.sourceUrl || source.requestedUrl === proof.sourceUrl);
  if (!matching.length) return reject('No saved original passage for this claim. Retrieve the original source before accepting the figure.');
  if (!matching.some(source => source.status === 'retrieved')) return reject('Original source could not be read. Try an accessible original publisher or provide a human correction.');
  if (!matching.some(source => source.status === 'retrieved' && source.text && normalize(source.text).includes(quote))) return reject('Claim is not present in the saved original passage. Find an exact supporting passage rather than relying on search summaries.');
  const receipt = input.originals.find((source) => source.status === 'retrieved' && source.httpStatus === 200 &&
    /^[a-f0-9]{64}$/.test(source.contentHash ?? '') && source.finalUrl &&
    (source.finalUrl === proof.sourceUrl || source.requestedUrl === proof.sourceUrl) &&
    source.text && normalize(source.text).includes(quote) && proof.asOf <= source.retrievedAt.slice(0, 10) &&
    Number.isFinite(Date.parse(source.retrievedAt)) && Date.parse(source.retrievedAt) - date.getTime() <= 366 * 86400000);
  if (!receipt?.finalUrl) return reject('Saved original receipt does not meet integrity or reporting-date requirements. Retrieve a valid original before accepting the figure.');
  const citations = usableCitations([{ title: `Original passage (${proof.asOf})`, url: receipt.finalUrl }], input.officialWebsite);
  if (!hasVerificationGradeCitation(citations, input.officialWebsite)) return reject('Original publisher does not meet the source-quality requirements for this company. Find an eligible issuer or reputable reporting source.');
  return { reason: null, citations: hasVerificationGradeCitation(citations) ? citations : citations.map(citation => ({ ...citation,
    title: `Issuer-reported original passage (${proof.asOf}); not independently corroborated` })) };
}
