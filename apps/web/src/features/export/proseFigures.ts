/**
 * Free prose is not a source-checked figure.
 *
 * A company one-liner, an overview paragraph, a product line or a history event is stored text with no figure gate
 * behind it. When an export prints "a $5B robotics company with 12,000 employees" next to a Valuation row that says
 * Unknown, the page contradicts itself and states a number nobody checked (AGENTS.md Rule 9). So a sentence that
 * states a figure is left out of every export, and the sentences around it are kept as stored. Nothing is rewritten.
 *
 * The recogniser fails closed: it would rather drop a sentence that merely looks like a figure ("Boeing 737") than
 * print one that is. A sentence states a figure when it holds
 *   - a currency amount (a symbol or code, "5 billion dollars"),
 *   - any number of three or more digits that is not a plain year (1900-2100), so "1,200", "400 FTEs" and
 *     "a 400-person company" all count,
 *   - "percent", "per cent" or a % sign,
 *   - a scale or fraction word ("hundred", "thousand", "million", "billion", "trillion", "half a", "a third",
 *     "quarter of"), which also catches "twelve thousand people" and "half a billion",
 *   - a smaller count of people or customers ("12 employees", "a 50-person team", "3 clients").
 * Years, quarters, round names ("Series C") and counts of things that are not people or money are not figures.
 */

const FIGURE_WORDS = new RegExp([
  String.raw`[$€£¥]\s?\d`,
  String.raw`\b(?:usd|eur|gbp|us\$)\s?\d`,
  String.raw`\d\s?(?:dollars|euros|pounds)\b`,
  String.raw`%`,
  String.raw`\b(?:per ?cent|hundreds?|thousands?|millions?|billions?|trillions?)\b`,
  String.raw`\b(?:half an?|quarter of|half of|thirds)\b`,
  String.raw`\ba (?:third|quarter|fifth)\b(?!\s*-?\s*part(?:y|ies)\b)`,
  String.raw`\b\d[\d,.]*(?:bn|mn|[kmb])\b`,
  String.raw`\d[\d,]*\+?\s*-?\s*(?:full[- ]time\s+|part[- ]time\s+)?(?:employees?|staff|people|persons?|workers|engineers|developers|researchers|professionals|team members|associates|ftes?)\b`,
  String.raw`\b(?:employs|employing|headcount|workforce|team of|staff of)\b[^.]{0,30}?\d`,
  String.raw`\d[\d,.]*\s?[kmb]?\+?\s+(?:(?:monthly|daily|weekly|active|paying|registered|enterprise|business|corporate)\s+)*(?:users|customers|clients|merchants|subscribers|members|accounts|downloads|installs)\b`,
  String.raw`\bmarket share\b[^.]{0,30}\d`,
].join('|'), 'i');

/** A number written with digits: "1,200,000", "40000", "3.5". */
const NUMBER = /\d+(?:,\d{3})*(?:\.\d+)?/g;

/** Any number of three or more digits that is not a plain year. A number with a thousands separator is never a year. */
function hasBigNumber(text: string): boolean {
  for (const [token] of text.matchAll(NUMBER)) {
    const whole = token.split('.')[0]!;
    const digits = whole.replace(/,/g, '');
    if (digits.length < 3) continue;
    if (!whole.includes(',') && digits.length === 4 && Number(digits) >= 1900 && Number(digits) <= 2100) continue;
    return true;
  }
  return false;
}

/** True when the text states a figure nobody source-checked (see the module note). */
export const hasProseFigure = (text: string | null | undefined): boolean => {
  const t = text ?? '';
  return FIGURE_WORDS.test(t) || hasBigNumber(t);
};

/** The sentences of `text` that state no such figure, as stored and in their order; null when none is left. */
export function withoutProseFigures(text: string | null | undefined): string | null {
  const kept = (text ?? '').split(/(?<=[.!?])\s+(?=[A-Z“"‘'(])/u).map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !hasProseFigure(sentence));
  return kept.length > 0 ? kept.join(' ') : null;
}
