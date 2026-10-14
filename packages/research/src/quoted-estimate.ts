/**
 * Quoted-original estimate lane.
 *
 * The verified gate (metric-support.ts) is deliberately mechanical: it wants
 * "Acme reported ARR of USD 40 million as of 2026-10-01" and rejects ordinary
 * press-release prose ("Today, Acme announced a $750 million round ...,
 * valuing the company at $44 billion"). The other estimated lane only accepts
 * Gemini's own grounded answer text. A figure found through real web search
 * and quoted word for word from a page we actually fetched therefore had
 * nowhere honest to land.
 *
 * This lane accepts such a figure as ESTIMATED (never verified) only when the
 * quote is verbatim in a retained original, names the company as written,
 * carries the metric's own wording and the exact value with its currency, is
 * dated within the evidence window (in the quote or the article's dateline
 * directly before it) and is not hedged. Anything else stays unknown.
 */
import { MONEY_METRIC_TYPES, validMetricVerificationValue, type Citation, type CompanyMetric, type MetricType } from '@mi/contracts';
import type { OriginalSourceReceipt } from './original-source';
import type { MetricPassageSupport } from './metric-support';
import { currencyMentionPattern, isConvertibleCurrency } from './fx';

const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const EVIDENCE_WINDOW_DAYS = 366;
/** Lookback for a dateline/byline date ahead of the quoted sentence. */
const DATELINE_CHARS = 400;

/** Metric wording a quote must carry. Market share and market cap are excluded:
 * share needs a market/denominator contract, and caps move daily. */
const WORDING: Partial<Record<MetricType, RegExp>> = {
  valuation: /\b(?:valuation|valued at|valuing (?:the company|the business|it) at)\b/i,
  arr: /\b(?:ARR|annual recurring revenue|annuali[sz]ed revenue|annual revenue)\b/i,
  revenue: /\b(?:revenues?|sales|turnover)\b/i,
  funding_total: /\b(?:total funding|funding to date|raised to date|in total|total (?:equity |capital )?(?:financing|funding|raised)|(?:has|have) raised(?!(?:[^.]|\.(?=\d))*\b(?:Series [A-Z]\d?|(?:pre-)?seed|bridge|(?:funding|financing|investment) round|round)\b)|raised a total of)\b/i,
  last_round: /\b(?:Series [A-Z]\d?|(?:pre-)?seed|(?:funding|investment|financing|equity) round|round of (?:funding|financing))\b/i,
  employees: /\b(?:employees|headcount|employs|staff of|workforce of)\b/i,
  users: /\b(?:users|customers)\b/i,
  aum: /\b(?:AUM|assets under management)\b/i,
  distribution: /\b(?:countries|markets|retailers|stores|doors|stockists|retail locations|points of sale)\b/i,
};

const HEDGE = /~|\b(?:roughly|about|approximately|around|nearly|almost|over|more than|less than|at least|up to|some|reportedly|reported(?:ly)? to|people familiar|familiar with the matter|sources? (?:said|say)|according to (?:people|sources)|in talks|seeking|considering|could|may|might|would|expects?|expected|plans? to|planning to|aims? to|targets? (?:a|an|of)|targeting|projected|projections?|forecasts?|estimated?|rumou?red|potential(?:ly)?|valuation of up to)\b/i;

/** Event figures dated by the event; a later article restating them does not re-date them. */
const EVENT_TYPES: readonly MetricType[] = ['valuation', 'last_round', 'funding_total'];
const RESTATED = /\b(?:previously|last valued|had been valued|prior valuation|earlier valuation|last year|a year ago|earlier this year)\b/i;

function dateForms(asOf: string): string[] {
  const date = new Date(`${asOf}T00:00:00.000Z`);
  const fmt = (locale: string, month: 'long' | 'short') =>
    new Intl.DateTimeFormat(locale, { year: 'numeric', month, day: 'numeric', timeZone: 'UTC' }).format(date);
  return [asOf, fmt('en-US', 'long'), fmt('en-US', 'short'), fmt('en-GB', 'long'), fmt('en-GB', 'short')];
}

function brandOf(companyName: string): string {
  return companyName.replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/,?\s+(?:Corporation|Corp\.?|Incorporated|Inc\.?|Limited|Ltd\.?|PBC|PLC|LLC|L\.L\.C\.|GmbH|S\.A\.|AG|Co\.)$/i, '').trim();
}

interface Amount { value: number; start: number; end: number }

function amountsIn(text: string): Amount[] {
  const scale: Record<string, number> = { trillion: 1e12, billion: 1e9, million: 1e6, thousand: 1e3, tn: 1e12, bn: 1e9, b: 1e9, mn: 1e6, m: 1e6, k: 1e3 };
  return [...text.matchAll(/(?<![A-Za-z\d])(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million|thousand|tn|bn|mn|[bmk])?\b/gi)]
    .map((match) => ({ value: Number(match[1]!.replaceAll(',', '')) * (scale[match[2]?.toLowerCase() ?? ''] ?? 1),
      start: match.index!, end: match.index! + match[0].length }));
}

/** The amount nearest to any occurrence of the metric's wording — the figure the
 * sentence actually attaches to that metric ("$750 million at a $44 billion
 * valuation": valuation -> 44B, never 750M). */
function nearestAmount(text: string, wording: RegExp): number | null {
  const amounts = amountsIn(text);
  const words = [...text.matchAll(new RegExp(wording.source, 'gi'))].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
  let best: { value: number; gap: number } | null = null;
  for (const word of words) {
    for (const amount of amounts) {
      const gap = amount.start >= word.end ? amount.start - word.end : word.start >= amount.end ? word.start - amount.end : 0;
      if (!best || gap < best.gap) best = { value: amount.value, gap };
    }
  }
  return best?.value ?? null;
}

export interface QuotedEstimateInput {
  companyName: string;
  metricType: MetricType;
  value: number | null;
  support?: MetricPassageSupport | null;
  originals: readonly OriginalSourceReceipt[];
  nowMs?: number;
}

/** The checks a stored quote must pass on its own (no page needed): metric
 * wording, the company as written, the exact value bound to that wording with
 * its currency, a current reporting date, no hedging. Readers without the
 * retained page (the card face) re-run exactly this. */
export function quoteHolds(input: { companyName: string; metricType: MetricType; value: number | null;
  quote: string; asOf: string; unit: string; nowMs?: number }): boolean {
  const wording = WORDING[input.metricType];
  if (!wording || input.value == null || !validMetricVerificationValue(input.metricType, input.value) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) return false;
  const asOf = new Date(`${input.asOf}T00:00:00.000Z`);
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(asOf.getTime()) || asOf.toISOString().slice(0, 10) !== input.asOf ||
    asOf.getTime() > nowMs || nowMs - asOf.getTime() > EVIDENCE_WINDOW_DAYS * 86_400_000) return false;

  const quote = normalize(input.quote);
  if (quote.length < 15 || quote.length > 600 || HEDGE.test(quote) || !wording.test(quote)) return false;
  // The date here is usually the article's dateline. An article restating an
  // older round ("which was valued at $61.5 billion in 2024") is not dated by it.
  if (EVENT_TYPES.includes(input.metricType) && (RESTATED.test(quote) ||
    [...quote.matchAll(/(?<!(?:since|founded in|established in)\s)\b((?:19|20)\d{2})\b/gi)].some((m) => Number(m[1]) < asOf.getUTCFullYear()))) return false;

  // The company exactly as written (case-sensitive): "Ramp", not "ramp up".
  const brand = brandOf(input.companyName);
  if (brand.length < 2 || !new RegExp(`(?<![\\p{L}\\p{N}])${escape(brand)}(?![\\p{L}\\p{N}])`, 'u').test(quote)) return false;

  // The exact value, in the unit the source uses.
  const withoutDates = dateForms(input.asOf).reduce((text, form) => text.replaceAll(form, ' '), quote);
  const attached = nearestAmount(withoutDates, wording);
  if (attached == null || Math.abs(attached - input.value) > Math.max(1, input.value) * 1e-9) return false;
  if (MONEY_METRIC_TYPES.includes(input.metricType)) {
    const currency = input.unit === 'USD' ? /\$|\bUSD\b|U\.S\. dollars/ : isConvertibleCurrency(input.unit) ? currencyMentionPattern(input.unit) : null;
    return Boolean(currency && currency.test(quote));
  }
  return input.unit === 'count';
}

/** Card/reader re-check of a stored quoted-estimate row (no page available). */
export function quotedSupportHolds(companyName: string,
  metric: Pick<CompanyMetric, 'metricType' | 'confidence' | 'quotedSupport' | 'citations'>, nowMs?: number): boolean {
  const q = metric.quotedSupport;
  return metric.confidence === 'estimated' && q != null &&
    metric.citations.some((c) => c.url === q.sourceUrl) &&
    quoteHolds({ companyName, metricType: metric.metricType, value: q.value, quote: q.quote, asOf: q.asOf, unit: q.unit, nowMs });
}

/** Projection re-check with the retained originals: the full lane, page included. */
export function quotedStoredCitations(companyName: string,
  metric: Pick<CompanyMetric, 'metricType' | 'confidence' | 'quotedSupport'>,
  originals: readonly OriginalSourceReceipt[], nowMs?: number): Citation[] {
  const q = metric.quotedSupport;
  if (metric.confidence !== 'estimated' || !q) return [];
  return quotedOriginalEstimate({ companyName, metricType: metric.metricType, value: q.value, originals, nowMs,
    support: { sourceUrl: q.sourceUrl, quote: q.quote, asOf: q.asOf, basis: metric.metricType, unit: q.unit as MetricPassageSupport['unit'] } });
}

/** Citations when the figure qualifies as a quoted-original estimate, else []. */
export function quotedOriginalEstimate(input: QuotedEstimateInput): Citation[] {
  const proof = input.support;
  if (!proof || proof.basis !== input.metricType || !quoteHolds({ companyName: input.companyName, metricType: input.metricType,
    value: input.value, quote: proof.quote ?? '', asOf: proof.asOf, unit: proof.unit, nowMs: input.nowMs })) return [];
  const quote = normalize(proof.quote ?? '');
  const forms = dateForms(proof.asOf);

  // Verbatim in a page we fetched, and dated in the quote or its dateline.
  const page = input.originals.find((source) => source.status === 'retrieved' && source.text &&
    (source.finalUrl === proof.sourceUrl || source.requestedUrl === proof.sourceUrl) && normalize(source.text).includes(quote));
  if (!page) return [];
  const text = normalize(page.text!);
  const at = text.indexOf(quote);
  const window = text.slice(Math.max(0, at - DATELINE_CHARS), at + quote.length);
  if (!forms.some((form) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(form)}(?![\\p{L}\\p{N}])`, 'iu').test(window))) return [];

  const url = page.finalUrl ?? page.requestedUrl;
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep url */ }
  return [{ url, title: `${host} (original page, quoted)` }];
}

/** Method note for a quoted-original estimate row. */
export function quotedEstimateNote(support: MetricPassageSupport, citation: Citation): string {
  const quote = normalize(support.quote ?? '');
  return `Quoted from ${citation.title.replace(/ \(original page, quoted\)$/, '')} as of ${support.asOf}: "${quote.slice(0, 300)}${quote.length > 300 ? '…' : ''}" Read from the original page; not independently verified.`;
}
