/**
 * Headcount vs. reach.
 *
 * `employees` is the company's OWN workforce. Payroll, earned-wage-access, HR
 * and benefits companies describe their reach in the same noun: "6 million
 * employees use DailyPay", "available to 4M employees", "serving 112,000
 * employees at 12,000 employers". Every basis pattern in the pipeline reads
 * "<N> employees" as a headcount, so those reach figures were stored as staff
 * (DailyPay 6,000,000; Stream 4,000,000; Dayforce 7,600,000; Tapcheck 112,000)
 * — and then, as the denominator of the scale-plausibility gate, hid real
 * cross-company figures behind an absurd headcount.
 *
 * The rule is phrase-local: a number counts as headcount only when the clause
 * that carries it does not frame it as people the company serves or reaches.
 * "DailyPay has 600 employees" is headcount; "6 million employees use DailyPay"
 * is reach. A reach figure is never relabelled here — the users lane reads the
 * same evidence under its own rules.
 *
 * Separately, no company employs more than ~2.3M people (Walmart ~2.1M), so an
 * UNVERIFIED headcount above {@link MAX_PLAUSIBLE_HEADCOUNT} is not a headcount.
 */
import type { CompanyMetric } from '@mi/contracts';

/** Above this an unverified headcount is withheld (largest real employer ~2.3M). */
export const MAX_PLAUSIBLE_HEADCOUNT = 2_500_000;

const SCALE: Record<string, number> = { billion: 1e9, million: 1e6, thousand: 1e3, bn: 1e9, b: 1e9, mn: 1e6, m: 1e6, k: 1e3 };

interface Occurrence { value: number; start: number; end: number }

function occurrences(text: string): Occurrence[] {
  return [...text.matchAll(/(?<![A-Za-z\d.])(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|mn|[bmk])?\b\s*\+?/gi)]
    .map((match) => ({ value: Number(match[1]!.replaceAll(',', '')) * (SCALE[match[2]?.toLowerCase() ?? ''] ?? 1),
      start: match.index!, end: match.index! + match[0].length }));
}

/** A reach verb ahead of the number, in the same clause, with no other number between. */
const REACH_BEFORE = new RegExp(String.raw`\b(?:serv(?:e|es|ed|ing)|support(?:s|ed|ing)?|reach(?:es|ed|ing)?|available to|access(?:ible)? to|offer(?:s|ed|ing)? (?:\w+ ){0,3}to|provid(?:e|es|ed|ing) (?:\w+ ){0,3}to|used by|trusted by|chosen by|relied (?:up)?on by|empower(?:s|ed|ing)?|help(?:s|ed|ing)?|benefit(?:s|ed|ing)?|cover(?:s|ed|ing)?|enroll(?:s|ed|ing)?|onboard(?:s|ed|ing)?|payroll (?:for|of)|pay(?:s|ing)?(?! (?:its|our|their)\b)|paid(?! (?:its|our|their)\b)|for (?:over |more than |nearly |some |about |approximately )?$)(?:(?!\b(?:has|have|had|employs?|employing|employed|with|headcount|staff|workforce|team)\b)[^.,;:!?\d]){0,30}$`, 'i');

/** What follows the number frames it as people using or reached by the product. */
const REACH_AFTER = new RegExp(String.raw`^\s*(?:(?:\w+[- ]){0,2}?(?:employees|workers|staff|people|team members)\s+(?:(?:who|that)\s+)?(?:now\s+)?(?:use|uses|using|rely|relies|access|accessing|enroll|enrolled|have access|had access|are using|on (?:the|its|our|their) (?:platform|app)|at\s+(?:over\s+|more than\s+|nearly\s+)?[\d,.]+\s*(?:million|thousand|[mk])?\s*\+?\s*(?:employers|companies|businesses|organi[sz]ations|clients|customers|brands|locations)|(?:of|at|across) (?:its |our |their )?(?:clients?|customers?|partners?|employers|client companies|partner companies|customer companies)|(?:of|at|across) (?:over |more than )?[\d,.]+\s*(?:million|thousand|[mk])?\s*\+?\s*(?:employers|companies|businesses|organi[sz]ations|clients|customers))|(?:\w+[- ]){0,2}?(?:users|members|subscribers|cardholders|customers|clients|end[- ]users|account holders)\b)`, 'i');

/** A clause around the occurrence: the text back to the previous and on to the next clause break. */
function clauseAround(text: string, at: Occurrence): { before: string; after: string } {
  const head = text.slice(0, at.start);
  const cut = Math.max(head.lastIndexOf('.'), head.lastIndexOf(';'), head.lastIndexOf('!'), head.lastIndexOf('?'), head.lastIndexOf('\n'));
  const tail = text.slice(at.end);
  const stop = tail.search(/[;!?\n]|\.(?!\d)/);
  return { before: head.slice(cut + 1), after: stop >= 0 ? tail.slice(0, stop) : tail };
}

function occurrenceIsReach(text: string, at: Occurrence): boolean {
  const { before, after } = clauseAround(text, at);
  return REACH_BEFORE.test(before) || REACH_AFTER.test(after);
}

const EMPLOYEE_WORD = /\b(?:employees|workers|staff)\b/i;

/**
 * True when `text` frames the employee figure as people the company serves or
 * reaches, not its own staff. With `value`, only the clauses carrying that
 * number are judged, and every one of them must be reach-framed ("DailyPay has
 * 600 employees; 6 million employees use it" — 600 is headcount, 6M is reach).
 * Without a value (or when the value is not written in the text) the text is
 * reach-framed when any number in it is.
 */
export function headcountFramedAsReach(text: string, value?: number | null): boolean {
  if (!text || !EMPLOYEE_WORD.test(text) && !/\b(?:users|members|subscribers|cardholders)\b/i.test(text)) return false;
  const all = occurrences(text);
  const carrying = value == null ? [] : all.filter((at) => Math.abs(at.value - value) <= Math.max(1, value) * 1e-9);
  if (carrying.length) return carrying.every((at) => occurrenceIsReach(text, at));
  return all.some((at) => occurrenceIsReach(text, at));
}

/** The stored evidence text of a metric row: everything a lane kept as the claim. */
function storedEvidence(row: CompanyMetric): string[] {
  return [row.reportedSupport?.support.text, row.quotedSupport?.quote, row.passageSupport?.quote]
    .filter((text): text is string => !!text && text.trim().length > 0);
}

export type HeadcountProblem = 'headcount_is_reach' | 'headcount_too_large';

/**
 * Why an UNVERIFIED stored headcount is not the company's own workforce, or
 * null. Only `estimated` rows are judged: verified rows carry an original
 * citation, and only a human may touch user_verified.
 */
export function unverifiedHeadcountProblem(row: CompanyMetric): HeadcountProblem | null {
  if (row.metricType !== 'employees' || row.confidence !== 'estimated' || row.value == null) return null;
  // Reach first: it names what the number really counts.
  if (storedEvidence(row).some((text) => headcountFramedAsReach(text, row.value))) return 'headcount_is_reach';
  return row.value > MAX_PLAUSIBLE_HEADCOUNT ? 'headcount_too_large' : null;
}
