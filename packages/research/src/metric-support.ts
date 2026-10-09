import { hasVerificationGradeCitation, usableCitations, validMetricVerificationValue, type Citation, type MetricType, type CompanyMetric } from '@mi/contracts';
import type { OriginalSourceReceipt } from './original-source';
import { secFilingHeadcountObservation, secRevenueObservation } from './sec-revenue';
import { currencyMentionPattern, describeCurrencyConversion, isConvertibleCurrency, usdPerUnit } from './fx';

export type MetricPassageSupport = NonNullable<CompanyMetric['passageSupport']>;
const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function isIssuerOriginal(input: Parameters<typeof acceptedMetricPassage>[0]): boolean {
  try {
    const host = new URL(input.officialWebsite ?? '').hostname.toLowerCase().replace(/^www\./, '');
    return input.originals.some(source => {
      if (source.status !== 'retrieved' || !source.finalUrl || source.finalUrl !== input.support?.sourceUrl) return false;
      const url = new URL(source.finalUrl);
      const publisher = url.hostname.toLowerCase().replace(/^www\./, '');
      return url.protocol === 'https:' && (publisher === host || publisher.endsWith(`.${host}`));
    });
  } catch { return false; }
}
/** Explicit terminal legal suffixes only. Never strip a suffix or infer a trade
 * name: Acme Corp. may match Acme Corporation, not Acme Holdings or Acme Inc. */
function legalCompanyPattern(company: string): string {
  const suffix = /\s+(corporation|corp\.?|incorporated|inc\.?|limited|ltd\.?)$/i.exec(company);
  if (!suffix) return escape(company);
  const forms = /^(corporation|corp\.?)/i.test(suffix[1]!) ? '(?:Corporation|Corp\\.?)'
    : /^(incorporated|inc\.?)/i.test(suffix[1]!) ? '(?:Incorporated|Inc\\.?)' : '(?:Limited|Ltd\\.?)';
  return `${escape(company.slice(0, suffix.index))}\\s+${forms}`;
}
const basis: Record<MetricType, RegExp> = {
  arr: /\b(?:ARR|annual recurring revenue|annual revenue)\b/i,
  valuation: /\b(?:valuation|valued at)\b/i,
  market_cap: /\b(?:market cap|market capitalization)\b/i,
  users: /\b(?:users|customers)\b/i,
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
  if (proof?.format === 'sec-companyconcept') {
    const observed = secRevenueObservation(input.companyName, input.originals.filter(source => source.finalUrl === proof.sourceUrl), input.nowMs);
    return input.metricType === 'arr' && observed && input.value === observed.value &&
      proof.basis === 'arr' && proof.unit === 'USD' && proof.definition === 'annual_revenue' &&
      proof.asOf === observed.passageSupport.asOf && proof.periodStart === observed.passageSupport.periodStart &&
      proof.quote === observed.passageSupport.quote
      ? { citations: observed.citations, reason: null }
      : reject('SEC financial observation does not match the retained issuer, revenue definition, value and reporting interval.');
  }
  if (proof?.format === 'sec-filing') {
    const observed = secFilingHeadcountObservation(input.companyName, input.originals.filter(source => source.finalUrl === proof.sourceUrl), input.nowMs);
    return input.metricType === 'employees' && observed && input.value === observed.value &&
      proof.basis === 'employees' && proof.unit === 'count' && proof.definition === 'employees' &&
      proof.asOf === observed.passageSupport.asOf && proof.quote === observed.passageSupport.quote
      ? { citations: observed.citations, reason: null }
      : reject('SEC filing headcount does not match the retained issuer, employee disclosure and reporting date.');
  }
  if (!proof || !validMetricVerificationValue(input.metricType, input.value) || proof.basis !== input.metricType ||
    !/^\d{4}-\d{2}-\d{2}$/.test(proof.asOf)) return reject('Missing or incompatible claim evidence. Research needs a dated passage for this metric and unit.');
  const date = new Date(`${proof.asOf}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== proof.asOf) return reject('Reporting date is not a valid calendar date.');
  // Reopening an old receipt or checking it again does not renew its reporting
  // period. This is the existing 366-day outer ceiling, not per-metric freshness.
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs) || date.getTime() > nowMs || nowMs - date.getTime() > 366 * 86400000) return reject('Reporting date is outside the current evidence window. Find a current, explicitly dated source.');
  const quote = normalize(proof.quote);
  const dateForms = [proof.asOf, ...(['long', 'short'] as const).flatMap((month) => [
    new Intl.DateTimeFormat('en-US', { year: 'numeric', month, day: 'numeric', timeZone: 'UTC' }).format(date),
    new Intl.DateTimeFormat('en-GB', { year: 'numeric', month, day: 'numeric', timeZone: 'UTC' }).format(date),
  ])];
  const literalDate = dateForms.find((value) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(value)}(?![\\p{L}\\p{N}])`, 'iu').test(quote));
  const definition = proof.definition ?? input.metricType;
  const definitions: Record<string, RegExp> = {
    arr: /\b(?:ARR|annual recurring revenue)\b/i,
    annual_revenue: /\bannual revenue\b/i,
    users: /\busers\b/i, active_users: /\bactive users\b/i,
    monthly_active_users: /\bmonthly active users\b/i, daily_active_users: /\bdaily active users\b/i,
    customers: /\bcustomers\b/i, paying_customers: /\bpaying customers\b/i,
  };
  const definitionBasis = definition === 'annual_revenue' ? 'arr'
    : ['active_users', 'monthly_active_users', 'daily_active_users', 'customers', 'paying_customers'].includes(definition) ? 'users' : definition;
  if (definitionBasis !== input.metricType || !(definitions[definition] ?? basis[input.metricType]).test(quote) ||
    /\b(?:division|subsidiary|segment|department|business unit)\b/i.test(quote)) return reject('Measurement definition or whole-company scope is not explicitly supported.');
  if (input.metricType === 'users') {
    const populationPattern = /\b(?:monthly active users|daily active users|active users|paying customers|customers|users)\b/gi;
    const population = quote.match(populationPattern) ?? [];
    const populationName = definition.replaceAll('_', ' ');
    if (!population.length || population.some(value => value.toLowerCase() !== populationName) ||
      /\b(?:weekly|monthly|daily|active|paying|new|registered|downloads|installs|followers)\b/i.test(quote.replace(populationPattern, ''))) return reject('User/customer populations are not interchangeable; an explicit matching definition is required.');
  }
  if (input.metricType === 'arr' && (definition === 'arr' ? /\bannual revenue|run[- ]?rate\b/i.test(quote) : /\bARR|annual recurring revenue|run[- ]?rate\b/i.test(quote))) return reject('Annual revenue, recurring revenue and run-rate are different measurements.');
  let intervalDate: string | undefined;
  if (definition === 'annual_revenue') {
    intervalDate = proof.periodStart;
    const start = new Date(`${intervalDate}T00:00:00.000Z`);
    const days = (date.getTime() - start.getTime()) / 86400000 + 1;
    if (!intervalDate || !Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== intervalDate ||
      ![364, 365, 366, 371].includes(days) ||
      !(quote.includes(`for the period ${intervalDate} to ${proof.asOf}`) ||
        literalDate && new RegExp(`\\bfor (?:the )?(?:fiscal )?year ended ${escape(literalDate)}(?![\\p{L}\\p{N}])`, 'iu').test(quote))) return reject('Annual revenue requires a literal matching annual reporting interval, not a collection date.');
  } else if (proof.periodStart) return reject('This measurement does not support an annual reporting interval.');
  const company = normalize(input.companyName);
  // An issuer may use its exact brand without its terminal legal designation.
  // This is allowed only on a retained original from that issuer's own host;
  // never infer aliases, remove Holdings/Group, or borrow a partner's figure.
  const brand = company.replace(/,?\s+(?:Corporation|Corp\.?|Incorporated|Inc\.?|Limited|Ltd\.?|PBC|PLC|LLC)$/i, '').trim();
  const companyPattern = isIssuerOriginal(input) && brand.length >= 3 && brand !== company
    ? `(?:${legalCompanyPattern(company)}|${escape(brand)})` : legalCompanyPattern(company);
  if (quote.length < 10 || quote.length > 600 || !company ||
    !new RegExp(`(?<![\\p{L}\\p{N}])${companyPattern}(?![\\p{L}\\p{N}])`, 'iu').test(quote) || !literalDate ||
    !basis[input.metricType].test(quote) || /\b(?:not|estimated?|projects?|projected|forecasts?|targets?|expects?|expected|might|could|would|may|approximately|about)\b|~/i.test(quote)) return reject('Passage does not explicitly support this company, metric and reporting date, or describes an estimate.');
  // Keyword co-occurrence is not attribution: the company, metric and date
  // must form one direct statement. Ambiguous prose stays unknown rather than
  // borrowing a partner's figure or mistaking an article date for an as-of date.
  const subject = new RegExp(`(?<![\\p{L}\\p{N}])${companyPattern}(?![\\p{L}\\p{N}])(?:['’]s)?\\s+(?:reports?|reported|has|had|recorded|disclosed|announced|employs?|employed|was|is)\\b`, 'iu');
  const withoutCompany = quote.replace(new RegExp(`(?<![\\p{L}\\p{N}])${companyPattern}(?![\\p{L}\\p{N}])(?:['’]s)?`, 'giu'), 'COMPANY');
  if (!subject.test(quote) || /[.!?;]\s+/.test(withoutCompany) ||
    /\bthat\b|[\p{L}\p{N}]+['’]s\b/iu.test(withoutCompany) ||
    /\b(?:article|published|publication|posted|retrieved|updated)\b/i.test(quote) ||
    (!intervalDate && !new RegExp(`\\b(?:as of|on|at)\\s+${escape(literalDate)}(?![\\p{L}\\p{N}])`, 'iu').test(quote)) ||
    Object.entries(basis).some(([type, pattern]) => type !== input.metricType && pattern.test(quote))) return reject('Claim attribution is ambiguous. A direct company statement and metric reporting date are required, not an article date or another company’s figure.');
  const expectedUnit = ['arr', 'valuation', 'market_cap'].includes(input.metricType) ? 'USD' : input.metricType === 'market_share' ? 'percent' : 'count';
  // A money figure may be quoted natively in a convertible currency: the model
  // sets unit to the ISO code the SOURCE uses and the quote must name that
  // currency. The stored metric row is converted to USD at the frozen
  // reference rate (normalizeMetricToUsd); the quote keeps the native figure.
  const unitIsNative = expectedUnit === 'USD' && isConvertibleCurrency(proof.unit);
  if ((expectedUnit === 'USD' ? !(proof.unit === 'USD' || unitIsNative) : proof.unit !== expectedUnit) ||
    (unitIsNative && !currencyMentionPattern(proof.unit)!.test(quote)) ||
    (proof.unit === 'USD' && !/\bUSD\b|US\$|U\.S\. dollars/i.test(quote)) ||
    (expectedUnit === 'percent' && !/%|\bpercent\b/i.test(quote))) return reject('Metric unit is not explicitly supported. Revenue, ARR and currencies are not interchangeable.');
  // Exactly one distinct number (apart from the explicit date) avoids choosing
  // among conflicting/adjacent figures. Do not coerce revenue into ARR.
  const withoutDate = quote.replace(new RegExp(escape(literalDate), 'gi'), '').replace(intervalDate ? new RegExp(escape(intervalDate), 'g') : /$^/, '');
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

const MONEY_METRICS: readonly MetricType[] = ['arr', 'valuation', 'market_cap'];

/**
 * The stored metric row is USD for money metrics so decks stay comparable.
 * A natively-quoted figure converts at the frozen reference rate; the
 * passageSupport quote and unit keep the native observation. count/percent,
 * USD figures and missing rates pass through unchanged.
 */
export function normalizeMetricToUsd(metricType: MetricType, value: number | null | undefined, unit: string | null | undefined): number | null {
  if (value == null) return null;
  if (!MONEY_METRICS.includes(metricType) || !isConvertibleCurrency(unit)) return value;
  const rate = usdPerUnit(unit);
  return rate == null ? value : value * rate;
}

/** The methodNote sentence that keeps a converted figure honest on the card. */
export function currencyConversionNote(value: number | null | undefined, unit: string | null | undefined): string {
  if (value == null || !isConvertibleCurrency(unit)) return '';
  const rate = usdPerUnit(unit);
  return rate == null ? '' : describeCurrencyConversion(value, unit!, value * rate);
}
