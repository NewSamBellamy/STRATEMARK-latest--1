/**
 * Deterministic plausibility gate for UNVERIFIED scale figures.
 *
 * A provider-grounded figure is a model's reading of a search answer. When
 * that reading binds another company's number to the subject — Alphabet's
 * $4.09T market cap and $402.84B revenue stored on Mixmax, a 48-person
 * startup, in the same deck that showed them on Google — every per-row gate
 * can pass, because the number really is in the source. Two cheap checks
 * catch it without a fetch or a model call:
 *
 * - implausible_scale: the company's own headcount cannot carry the figure.
 *   Revenue/ARR of at least $1B implying more than $10M per employee, or a
 *   market cap/valuation of at least $50B implying more than $1B per employee.
 *   (Real extremes pass: Jane Street ~$8M revenue/employee, OpenAI ~$190M
 *   valuation/employee, Snowflake ~$17M market cap/employee.)
 * - cross_company_figure: the identical (within 0.5%) large money figure sits
 *   on two companies of one deck/market, and this holder is the wrong one —
 *   its own evidence names the other holder and not itself, its retained
 *   answer places the support in the other company's `### section`, or its
 *   per-employee scale is 100x the other holder's. Undecidable duplicates stay
 *   (a parent and its product line can legitimately share Alphabet's figure).
 *
 * - headcount_is_reach / headcount_too_large (v9): an unverified `employees`
 *   row whose stored support frames the number as people the company serves
 *   ("6 million employees use DailyPay"), or that exceeds any real employer
 *   (> 2.5M), is not a headcount (headcount-reach.ts). It is withheld first and
 *   never used as the denominator above: a reach figure as headcount would hide
 *   exactly the cross-company figures this gate exists to catch.
 * - date_digit_figure (v11): an unverified figure whose value appears in its
 *   own stored support only as a digit of a date (a day of the month, a year,
 *   a quarter — "as reported on September 29, 2026" stored as 29 employees)
 *   and never as a standalone number there (date-digits.ts). Withheld first,
 *   like reach, so it never serves as a headcount denominator.
 *
 * Only 'estimated' rows are judged: verified rows carry an original citation
 * and only a human may touch user_verified. A withheld figure is null with
 * confidence unknown (Rule 9: never zero-filled, never imputed).
 */
import type { CompanyMetric, MetricType } from '@mi/contracts';
import { namesCompany, supportSectionOwner } from './reported-metrics';
import { unverifiedHeadcountProblem, type HeadcountProblem } from './headcount-reach';
import { storedValueIsDateDigit } from './date-digits';

export type ScaleGate = 'implausible_scale' | 'cross_company_figure' | HeadcountProblem | 'date_digit_figure';

export const SCALE_NOTES: Record<ScaleGate, string> = {
  implausible_scale: 'Withheld: this unverified figure is implausible for the company\'s own reported headcount (far beyond any real company\'s revenue or value per employee), the signature of another company\'s figure bound to this one. Unknown until re-researched.',
  cross_company_figure: 'Withheld: the same unverified figure is stored on another company in this deck, and the evidence attributes it to that company, not this one. Unknown until re-researched.',
  headcount_is_reach: 'Withheld: the stored source counts people the company serves or reaches (employees of its clients using the product), not the company\'s own staff. Unknown until re-researched.',
  date_digit_figure: 'Withheld: the stored figure is a digit of a date in its own source sentence (a day of the month, a year or a quarter), not a figure the source states. Unknown until re-researched.',
  headcount_too_large: 'Withheld: this unverified headcount exceeds any real employer (no company employs more than about 2.3 million people), so it is not the company\'s own staff. Unknown until re-researched.',
};

const REVENUE_TYPES: readonly MetricType[] = ['arr', 'revenue'];
const VALUE_TYPES: readonly MetricType[] = ['market_cap', 'valuation'];
const DUPLICATE_TYPES: readonly MetricType[] = [...VALUE_TYPES, ...REVENUE_TYPES, 'funding_total'];

/** Revenue at or above this, per employee above REVENUE_PER_EMPLOYEE, is implausible. */
export const REVENUE_FLOOR = 1e9;
export const REVENUE_PER_EMPLOYEE = 10e6;
/** Market cap / valuation at or above this, per employee above VALUE_PER_EMPLOYEE, is implausible. */
export const VALUE_FLOOR = 50e9;
export const VALUE_PER_EMPLOYEE = 1e9;
/** Duplicates are only judged at this scale: small round figures repeat honestly. */
export const DUPLICATE_FLOOR = 1e9;
const DUPLICATE_TOLERANCE = 0.005;
const SCALE_GAP = 100;

export interface ScaleGateInput {
  companies: ReadonlyArray<{ id: string; name: string }>;
  metrics: readonly CompanyMetric[];
  /** Groups of company ids that share a deck or market; duplicates are compared within a group. */
  scopes?: ReadonlyArray<readonly string[]>;
  /** Retained provider answers (any company's) used to find whose section a support sits in. */
  answers?: readonly string[];
}

export interface ScaleFinding {
  metricId: string;
  companyId: string;
  metricType: MetricType;
  gate: ScaleGate;
  previousValue: number | null;
}

/** The largest headcount the company's own rows state (band high end counts).
 * A row that is not really a headcount (reach, impossible size) never counts. */
function headcounts(metrics: readonly CompanyMetric[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of metrics) {
    if (row.metricType !== 'employees' || row.confidence === 'unknown' || unverifiedHeadcountProblem(row) ||
      storedValueIsDateDigit(row)) continue;
    const count = row.value != null && row.value > 0 ? row.value : row.reportedBand?.high ?? null;
    if (count == null || !(count > 0)) continue;
    out.set(row.companyId, Math.max(out.get(row.companyId) ?? 0, count));
  }
  return out;
}

const judged = (row: CompanyMetric) => row.confidence === 'estimated' && row.value != null && Number.isFinite(row.value);

/** True when the figure cannot be carried by `employees` people. */
export function implausibleForHeadcount(metricType: MetricType, value: number, employees: number | undefined): boolean {
  if (!employees || employees <= 0) return false;
  if (REVENUE_TYPES.includes(metricType)) return value >= REVENUE_FLOOR && value / employees > REVENUE_PER_EMPLOYEE;
  if (VALUE_TYPES.includes(metricType)) return value >= VALUE_FLOOR && value / employees > VALUE_PER_EMPLOYEE;
  return false;
}

const evidenceText = (row: CompanyMetric) =>
  [row.reportedSupport?.support.text, row.quotedSupport?.quote].filter((t): t is string => !!t).join(' ');

/** Findings for every estimated row the two rules withhold. Pure and deterministic. */
export function implausibleScaleFigures(input: ScaleGateInput): ScaleFinding[] {
  const names = new Map(input.companies.map((c) => [c.id, c.name]));
  const staff = headcounts(input.metrics);
  const found = new Map<string, ScaleFinding>();
  const flag = (row: CompanyMetric, gate: ScaleGate) => {
    if (!found.has(row.id)) found.set(row.id, { metricId: row.id, companyId: row.companyId, metricType: row.metricType, gate, previousValue: row.value });
  };

  for (const row of input.metrics) {
    if (storedValueIsDateDigit(row)) { flag(row, 'date_digit_figure'); continue; }
    const headcount = unverifiedHeadcountProblem(row);
    if (headcount) flag(row, headcount);
  }
  for (const row of input.metrics) {
    if (judged(row) && implausibleForHeadcount(row.metricType, row.value!, staff.get(row.companyId))) flag(row, 'implausible_scale');
  }

  const peersOf = new Map<string, Set<string>>();
  for (const scope of input.scopes ?? []) {
    for (const id of scope) {
      const peers = peersOf.get(id) ?? new Set<string>();
      for (const other of scope) if (other !== id) peers.add(other);
      peersOf.set(id, peers);
    }
  }
  const large = input.metrics.filter((row) => DUPLICATE_TYPES.includes(row.metricType) && row.value != null &&
    row.value >= DUPLICATE_FLOOR && row.confidence !== 'unknown');
  for (const row of large) {
    if (!judged(row) || found.has(row.id)) continue;
    const name = names.get(row.companyId);
    const peers = peersOf.get(row.companyId);
    if (!name || !peers?.size) continue;
    const holders = large.filter((other) => other.companyId !== row.companyId && peers.has(other.companyId) &&
      Math.abs(other.value! - row.value!) <= DUPLICATE_TOLERANCE * Math.max(other.value!, row.value!));
    if (!holders.length) continue;
    const text = evidenceText(row);
    const ownStaff = staff.get(row.companyId);
    const wrongHolder = holders.some((other) => {
      const otherName = names.get(other.companyId);
      if (!otherName) return false;
      // The evidence names the other holder and never this company.
      if (text && namesCompany(text, otherName) && !namesCompany(text, name)) return true;
      // The same figure, but this company is 100x smaller per head than the other holder.
      const otherStaff = staff.get(other.companyId);
      return !!ownStaff && !!otherStaff && (row.value! / ownStaff) >= SCALE_GAP * (other.value! / otherStaff);
    });
    // A retained batch answer places this support in another company's section.
    const support = row.reportedSupport?.support;
    const roster = [...peers].map((id) => names.get(id)).filter((n): n is string => !!n);
    const inRivalSection = !!support && (input.answers ?? []).some((answer) => answer.includes(support.text)) &&
      (input.answers ?? []).filter((answer) => answer.includes(support.text))
        .every((answer) => supportSectionOwner(name, answer, support.text, support.startIndex, roster) === 'rival');
    if (wrongHolder || inRivalSection) flag(row, 'cross_company_figure');
  }
  return [...found.values()];
}

/** The withheld form of a row: null value, unknown confidence, no citation. */
export function withheldScaleRow(row: CompanyMetric, gate: ScaleGate): CompanyMetric {
  return { ...row, value: null, confidence: 'unknown', source: null, citations: [], methodNote: SCALE_NOTES[gate],
    passageSupport: null, reportedSupport: null, quotedSupport: null, lastVerifiedAt: null };
}
