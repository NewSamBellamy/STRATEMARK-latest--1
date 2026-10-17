/**
 * Date digits are never figures.
 *
 * Every metric lane reads numbers out of prose. A date carries numbers too —
 * "as reported on September 29, 2026" holds a 29 and a 2026 — and a binder
 * that only looks for the nearest basis word ("workforce, as reported on
 * September 29") stored Ecolab's headcount as 29. A number that is part of a
 * date is the date, not a measurement, so it is ineligible as a metric value
 * in every lane:
 *
 * - month name + day (+ year): "September 29, 2026", "Sept. 29", "Sep 29th"
 * - day + month name (+ year): "29 September 2026", "29th of September"
 * - month name + year: "September 2026", "Sept. of 2026"
 * - numeric dates: "2026-09-29", "2026/09/29", "9/29/2026", "29.09.2026"
 * - quarters, halves and fiscal years: "Q3 2026", "Q3'26", "H1 2025", "FY2025", "3Q 2026"
 *
 * Month names are matched capitalised only: "50 may leave" is not a date.
 * A bare year is not treated as a date on its own ("2,000 employees" is a
 * figure); only a year inside one of the forms above is.
 */
import type { CompanyMetric } from '@mi/contracts';

const MONTH = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?`;
const DAY = String.raw`(?:[12]\d|3[01]|0?[1-9])(?:st|nd|rd|th)?`;
const YEAR = String.raw`(?:19|20|21)\d{2}`;

const DATE_FORMS: readonly RegExp[] = [
  // September 29, 2026 / Sept. 29 / Sep 29th, 2026
  new RegExp(String.raw`(?<![A-Za-z])${MONTH}\s+${DAY}(?![\d,.]*\d)(?:,?\s+${YEAR}(?!\d))?`, 'g'),
  // 29 September 2026 / 29th of September, 2026
  new RegExp(String.raw`(?<![\d,.])${DAY}\s+(?:of\s+)?${MONTH}(?![A-Za-z])(?:,?\s+${YEAR}(?!\d))?`, 'g'),
  // September 2026 / Sept. of 2026
  new RegExp(String.raw`(?<![A-Za-z])${MONTH}\s+(?:of\s+)?${YEAR}(?!\d)`, 'g'),
  // 2026-09-29 / 2026/09/29
  new RegExp(String.raw`(?<![\d.,])${YEAR}([-/.])(?:0?[1-9]|1[0-2])\1(?:[12]\d|3[01]|0?[1-9])(?![\d])`, 'g'),
  // 9/29/2026 / 29.09.2026 / 9-29-26
  new RegExp(String.raw`(?<![\d.,/])\d{1,2}([-/.])\d{1,2}\1(?:\d{4}|\d{2})(?![\d])`, 'g'),
  // Q3 2026 / Q3'26 / H1 2025 / FY2025 / FY 2025 / 3Q 2026 / 3Q26
  new RegExp(String.raw`(?<![A-Za-z\d])(?:Q[1-4]|H[12]|[1-4]Q|FY|CY)(?:\s*(?:of\s+)?${YEAR}|\s*['’]\d{2}|\d{2})(?!\d)`, 'gi'),
];

export interface Span { start: number; end: number }

/** Every date span in `text`, as character ranges. */
export function dateSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const form of DATE_FORMS) {
    for (const match of text.matchAll(new RegExp(form.source, form.flags))) {
      spans.push({ start: match.index!, end: match.index! + match[0].length });
    }
  }
  return spans;
}

/** True when the characters [start, end) overlap a date in `text`. */
export function withinDate(text: string, start: number, end: number, spans: readonly Span[] = dateSpans(text)): boolean {
  return spans.some((span) => start < span.end && end > span.start);
}

// A decimal part followed by another ".digits" is a dotted date ("29.09.2026"), not a decimal.
const NUMBER = /(?<![A-Za-z\d.,])(\d[\d,]*(?:\.\d+(?![.\d]))?)/g;

/** Every numeric token in `text` with its value and whether it sits inside a date. */
export function numberTokens(text: string): Array<{ value: number; start: number; end: number; inDate: boolean }> {
  const spans = dateSpans(text);
  return [...text.matchAll(NUMBER)].map((match) => {
    const raw = match[1]!.replace(/[,.]$/, '');
    const start = match.index!, end = start + raw.length;
    return { value: Number(raw.replaceAll(',', '')), start, end, inDate: withinDate(text, start, end, spans) };
  }).filter((token) => Number.isFinite(token.value));
}

/**
 * True when `value` appears in `text` only as a digit of a date (a day of the
 * month, a year, a quarter) and never as a standalone number. Scaled figures
 * ("26 thousand", "$1.2 billion") are standalone numbers whose literal digits
 * differ from the value, so they never trip this.
 */
export function valueOnlyInDates(text: string, value: number): boolean {
  const tokens = numberTokens(text).filter((token) => token.value === value);
  return tokens.length > 0 && tokens.every((token) => token.inDate);
}

/**
 * An UNVERIFIED stored figure whose value is a date digit of its own support
 * text and appears nowhere there as a figure ("… as reported on September 29,
 * 2026" stored as 29 employees). Verified and user_verified rows are never
 * judged; a row with no stored text decides nothing.
 */
export function storedValueIsDateDigit(row: CompanyMetric): boolean {
  if (row.confidence !== 'estimated' || row.value == null) return false;
  const value = row.value;
  const texts = [row.reportedSupport?.support.text, row.quotedSupport?.quote, row.passageSupport?.quote]
    .filter((text): text is string => !!text && text.trim().length > 0);
  // The stored row may be USD-converted; the text carries the native proof value.
  const proofValue = row.reportedSupport?.value ?? row.quotedSupport?.value ?? value;
  return texts.length > 0 && texts.every((text) => valueOnlyInDates(text, proofValue));
}
