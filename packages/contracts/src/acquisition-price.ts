/**
 * The valuation/acquisition-price rule — a process rule in the metric gates.
 *
 * A price someone paid to BUY a company is not that company's valuation. Poppi's
 * "$1.95B valuation" was PepsiCo's purchase price; shown as a valuation it reads
 * as a funding-round mark the company never had. So a valuation figure whose
 * own evidence sentence describes an acquisition/purchase price never fills the
 * valuation metric. The research lane routes that sentence to the company's
 * `ownership.price` instead (packages/research/src/ownership.ts).
 *
 * Applied in `enforceMetricProvenance`, so it holds at every write AND at every
 * read (cards, readers and dashboards all project through it): a stored deck
 * written before this rule existed is corrected the next time it is shown.
 */
import type { CompanyMetric } from './types';

/** Acquisition / purchase wording. "deal valued at" is a price, not a valuation. */
const ACQUISITION_WORDING =
  /\b(?:acquir(?:e|es|ed|ing)|acquisition|bought|buy(?:s|ing)?|buyout|purchas(?:e|es|ed|ing)|takeover|take-private|merger|sold (?:itself |the company )?to|sale (?:of (?:the company|itself) )?to|DEALPRICE)\b/i;
/** Phrases that read like a valuation but state a deal price. */
const DEAL_PRICE_PHRASES =
  /\b(?:deal|transaction|acquisition|purchase|takeover|buyout|merger|offer)\s+(?:that\s+)?(?:valu(?:ed|ing|es)|worth|priced)\b(?:\s+\w+)?(?:\s+at)?/gi;
/** A valuation that belongs to a funding round, not a sale. */
const VALUATION_WORDING = /\b(?:valuation|valued at|valuing (?:the company|the business|it) at|post-money|pre-money)\b/i;
const ROUND_WORDING = /\b(?:raised|raises|raising|funding|financing|round|Series [A-Z]\d?|(?:pre-)?seed|investors?|led by|tender offer|secondary sale)\b/i;

const SCALE: Record<string, number> = { trillion: 1e12, billion: 1e9, million: 1e6, thousand: 1e3, tn: 1e12, bn: 1e9, b: 1e9, mn: 1e6, m: 1e6, k: 1e3 };

interface Span { start: number; end: number }
interface Amount extends Span { value: number }

function amountsIn(text: string): Amount[] {
  return [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million|thousand|tn|bn|mn|[bmk])?\b/gi)]
    .map((m) => ({ value: Number(m[1]!.replaceAll(',', '')) * (SCALE[m[2]?.toLowerCase() ?? ''] ?? 1), start: m.index!, end: m.index! + m[0].length }));
}

function spans(text: string, pattern: RegExp): Span[] {
  return [...text.matchAll(new RegExp(pattern.source, 'gi'))].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
}

function gap(a: Span, b: Span): number {
  return a.start >= b.end ? a.start - b.end : b.start >= a.end ? b.start - a.end : 0;
}

/** Same figure within rounding: a stored $1.95B and a quoted "$1.95 billion". */
function sameFigure(a: number, b: number): boolean {
  return a > 0 && b > 0 && Math.abs(a - b) <= Math.max(a, b) * 0.005;
}

function sentencesOf(text: string): string[] {
  return text.normalize('NFKC').replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z"“‘'(])/u).map((s) => s.trim()).filter(Boolean);
}

/**
 * The sentence in `text` that states `value` as an acquisition/purchase price,
 * or null. `value` null means "any figure": used when the stored figure was
 * converted from another currency and can no longer be matched literally.
 *
 * Within a sentence carrying the figure: deal-price phrases count as
 * acquisition wording; the figure is an acquisition price when acquisition
 * wording sits at least as close to it as valuation wording does, or when the
 * sentence carries acquisition wording and no funding-round wording at all.
 * Fail-closed by design: a mixed sentence that cannot be told apart loses the
 * valuation (shown unknown), never gains one.
 */
export function acquisitionPriceSentence(text: string | null | undefined, value: number | null): string | null {
  if (!text) return null;
  for (const raw of sentencesOf(text)) {
    const sentence = raw.replace(DEAL_PRICE_PHRASES, ' DEALPRICE ');
    if (!ACQUISITION_WORDING.test(sentence)) continue;
    const amounts = amountsIn(sentence).filter((a) => value == null ? a.value >= 1e5 : sameFigure(a.value, value));
    if (!amounts.length) continue;
    const acq = spans(sentence, ACQUISITION_WORDING);
    const val = spans(sentence, VALUATION_WORDING);
    const roundSentence = ROUND_WORDING.test(sentence);
    for (const amount of amounts) {
      const dAcq = Math.min(...acq.map((s) => gap(amount, s)));
      const dVal = val.length ? Math.min(...val.map((s) => gap(amount, s))) : Infinity;
      if (!roundSentence || dAcq <= dVal) return raw;
    }
  }
  return null;
}

/** Every evidence text a metric row carries, the sentence that states it first. */
export function metricEvidenceTexts(metric: Pick<CompanyMetric, 'passageSupport' | 'reportedSupport' | 'quotedSupport' | 'methodNote'>): string[] {
  return [
    metric.quotedSupport?.quote,
    metric.passageSupport?.quote,
    metric.reportedSupport?.support.text,
    metric.methodNote,
  ].filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
}

/** Reason stamped on a valuation row whose evidence was an acquisition price. */
export const ACQUISITION_PRICE_NOTE =
  'Not shown as a valuation: its source describes a price paid to acquire the company, which is recorded as the acquisition price under ownership, not as a valuation.';

/**
 * True when this valuation row's evidence states its figure as an acquisition
 * price. The literal stored value is matched first; a non-USD source (stored
 * converted) is matched against the native figure its evidence records.
 */
export function isAcquisitionPriceValuation(metric: Pick<CompanyMetric, 'metricType' | 'value' | 'confidence' | 'passageSupport' | 'reportedSupport' | 'quotedSupport' | 'methodNote'>): boolean {
  if (metric.metricType !== 'valuation' || metric.value == null) return false;
  const natives = [metric.value, metric.quotedSupport?.value, metric.reportedSupport?.value]
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  return metricEvidenceTexts(metric).some((text) => natives.some((v) => acquisitionPriceSentence(text, v) !== null));
}
