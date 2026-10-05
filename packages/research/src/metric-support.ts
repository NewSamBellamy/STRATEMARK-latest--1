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
export function acceptedMetricPassage(input: { companyName: string; metricType: MetricType; value: number | null; support?: MetricPassageSupport | null; originals: readonly OriginalSourceReceipt[] }): Citation[] {
  const proof = input.support;
  if (!proof || !validMetricVerificationValue(input.metricType, input.value) || proof.basis !== input.metricType ||
    !/^\d{4}-\d{2}-\d{2}$/.test(proof.asOf)) return [];
  const date = new Date(`${proof.asOf}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== proof.asOf) return [];
  const quote = normalize(proof.quote);
  const company = normalize(input.companyName);
  const dateForms = [proof.asOf, ...(['long', 'short'] as const).flatMap((month) => [
    new Intl.DateTimeFormat('en-US', { year: 'numeric', month, day: 'numeric', timeZone: 'UTC' }).format(date),
    new Intl.DateTimeFormat('en-GB', { year: 'numeric', month, day: 'numeric', timeZone: 'UTC' }).format(date),
  ])];
  const literalDate = dateForms.find((value) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(value)}(?![\\p{L}\\p{N}])`, 'iu').test(quote));
  if (quote.length < 10 || quote.length > 600 || !company ||
    !new RegExp(`(?<![\\p{L}\\p{N}])${escape(company)}(?![\\p{L}\\p{N}])`, 'iu').test(quote) || !literalDate ||
    !basis[input.metricType].test(quote) || /\b(?:not|estimated?|projects?|projected|forecasts?|targets?|expects?|expected|might|could|would|may|approximately|about)\b|~/i.test(quote)) return [];
  // Keyword co-occurrence is not attribution: the company, metric and date
  // must form one direct statement. Ambiguous prose stays unknown rather than
  // borrowing a partner's figure or mistaking an article date for an as-of date.
  const subject = new RegExp(`(?<![\\p{L}\\p{N}])${escape(company)}(?![\\p{L}\\p{N}])(?:['’]s)?\\s+(?:reports?|reported|has|had|recorded|disclosed|announced|employs?|employed|was|is)\\b`, 'iu');
  const withoutCompany = quote.replace(new RegExp(`${escape(company)}(?:['’]s)?`, 'giu'), 'COMPANY');
  if (!subject.test(quote) || /[.!?;]\s+/.test(withoutCompany) ||
    /\bthat\b|[\p{L}\p{N}]+['’]s\b/iu.test(withoutCompany) ||
    /\b(?:article|published|publication|posted|retrieved|updated)\b/i.test(quote) ||
    !new RegExp(`\\b(?:as of|on|at)\\s+${escape(literalDate)}(?![\\p{L}\\p{N}])`, 'iu').test(quote) ||
    Object.entries(basis).some(([type, pattern]) => type !== input.metricType && pattern.test(quote))) return [];
  const expectedUnit = ['arr', 'valuation', 'market_cap'].includes(input.metricType) ? 'USD' : input.metricType === 'market_share' ? 'percent' : 'count';
  if (proof.unit !== expectedUnit || (expectedUnit === 'USD' && !/\bUSD\b|US\$|U\.S\. dollars/i.test(quote)) ||
    (expectedUnit === 'percent' && !/%|\bpercent\b/i.test(quote))) return [];
  // Exactly one distinct number (apart from the explicit date) avoids choosing
  // among conflicting/adjacent figures. Do not coerce revenue into ARR.
  const withoutDate = quote.replace(new RegExp(escape(literalDate), 'gi'), '');
  const numbers = [...withoutDate.matchAll(/\b(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million|thousand|[TBMK])?\b/gi)]
    .map((match) => Number(match[1]!.replaceAll(',', '')) * ({ trillion: 1e12, billion: 1e9, million: 1e6, thousand: 1e3, t: 1e12, b: 1e9, m: 1e6, k: 1e3 }[match[2]?.toLowerCase() ?? ''] ?? 1));
  if (!numbers.length || numbers.some((number) => Math.abs(number - input.value!) > Math.max(1, input.value!) * 1e-9)) return [];
  const receipt = input.originals.find((source) => source.status === 'retrieved' && source.httpStatus === 200 &&
    /^[a-f0-9]{64}$/.test(source.contentHash ?? '') && source.finalUrl &&
    (source.finalUrl === proof.sourceUrl || source.requestedUrl === proof.sourceUrl) &&
    source.text && normalize(source.text).includes(quote) && proof.asOf <= source.retrievedAt.slice(0, 10) &&
    Number.isFinite(Date.parse(source.retrievedAt)) && Date.parse(source.retrievedAt) - date.getTime() <= 366 * 86400000);
  if (!receipt?.finalUrl) return [];
  const citations = usableCitations([{ title: `Original passage (${proof.asOf})`, url: receipt.finalUrl }]);
  return hasVerificationGradeCitation(citations) ? citations : [];
}
