/**
 * Cross-metric consistency sentinel — pure, deterministic plausibility audits
 * across a deck's stored figures.
 *
 * The research pipeline verifies each figure in isolation; nothing ever asked
 * "do these numbers make sense NEXT TO EACH OTHER?" That gap is how a deck
 * shipped two companies claiming 61.7% + 40% of the same market and an ARR
 * 27× larger than a rival's while carrying a smaller valuation.
 *
 * Design rules:
 *  - PURE functions of stored metrics — no I/O, no model calls, so the audit
 *    can run on every render, every transport, every test, for free.
 *  - A finding NEVER mutates data. It names the suspect metrics so the living
 *    runtime can prioritize re-verification, and the UI can disclose doubt.
 *  - Conservative thresholds: every check flags only what is mathematically
 *    impossible or wildly implausible. False alarms erode trust faster than
 *    missed ones — a "critical" here must be indefensible. A warning is a doubt
 *    the reader sees; only a critical finding ever queues a paid re-check.
 *  - It judges what the card face shows. A figure the face withholds (an
 *    acquired company's deal-time valuation) is not audited.
 *  - It never throws: a string, a negative number, a missing row or a missing
 *    list is ignored, not an exception that stops the living runtime's plan.
 */
import { isAcquisitionPriceValuation } from './acquisition-price';
import type { MetricType } from './enums';
import { ownershipWithholdsValuation } from './ownership';
import type { CompanyMetric, Ownership } from './types';

export type ConsistencySeverity = 'warning' | 'critical';

export type ConsistencyCode =
  | 'share_sum_exceeds_market'
  | 'valuation_below_arr'
  | 'figures_differ_by_power_of_ten'
  | 'arr_per_employee_implausible'
  | 'users_exceed_population';

export interface ConsistencyFinding {
  code: ConsistencyCode;
  severity: ConsistencySeverity;
  /** Human sentence naming companies and figures — rendered as-is in the UI. */
  message: string;
  /** Offending companies (order = descending contribution to the problem). */
  companyIds: string[];
  /** The metrics whose re-verification would resolve the doubt. */
  metricTypes: MetricType[];
}

/**
 * The slice of a stored metric the audit needs. A full CompanyMetric fits, and its dates and evidence are what let the
 * audit pick the newest row of a type and see which figures the card face withholds.
 */
export interface ConsistencyMetricInput extends Partial<Pick<CompanyMetric, 'capturedAt' | 'methodNote' | 'passageSupport' | 'reportedSupport' | 'quotedSupport'>> {
  metricType: MetricType;
  value: number | null;
  /** 'unknown' rows are ignored — an honest Unknown is never inconsistent. */
  confidence: string;
  /** When the source dates the figure (YYYY-MM-DD); the row's own evidence dates are read too. */
  asOf?: string | null;
}

/** The slice of a company the audit needs — kept minimal so any caller can map into it. */
export interface ConsistencyCompanyInput {
  companyId: string;
  name: string;
  metrics: ConsistencyMetricInput[];
  /** The company's stored ownership: an acquired company's deal-time valuation is withheld on the face, so it is not audited. */
  ownership?: Ownership | null;
}

/**
 * Market-share sum thresholds. Above 100 (+rounding slack) the shares cannot
 * all be true on the same measurement basis → warning. Shares from different
 * sources are routinely measured on different bases (web traffic, API revenue,
 * seats), so only a sum far past 100 means a figure is simply wrong → critical.
 */
export const SHARE_SUM_WARNING_PCT = 100.5;
export const SHARE_SUM_CRITICAL_PCT = 150;
/** A share-sum finding re-checks only this many companies, the largest shares: not every company with a share. */
export const MAX_SHARE_SUM_TARGETS = 3;
/** NVIDIA peaks near ~$4.5M revenue/employee; $15M+ is a data error, not a business. */
export const MAX_PLAUSIBLE_ARR_PER_EMPLOYEE_USD = 15_000_000;
/**
 * Revenue this many times a LISTED company's market cap is worth a note; below it nothing is said (Sunrun: $3.0B revenue,
 * $1.8B market cap, is ordinary). It is a doubt, never an error: a distressed company can sit anywhere in this range, and a
 * warning is shown to the reader but never re-checked at a cost.
 */
export const MARKET_CAP_UNIT_SLIP_FACTOR = 10;
/** Revenue more than this many times a market cap is no distressed company: it is a unit slip, and an error. */
export const MARKET_CAP_CRITICAL_FACTOR = 1000;
/**
 * Revenue above a valuation is a note from the first dollar (a distributor, an installer, a stale round, a private-equity
 * holding all do it), and an error only past this ratio, where it can only be a unit slip.
 */
export const VALUATION_CRITICAL_FACTOR = 1000;
/**
 * Two figures that should agree (a market cap and a valuation, an ARR and a revenue) but differ by one of these factors are
 * the signature of a unit slip in one of them: $1.4B against $14B, $2.2B against $220B, or a thousand-fold millions/billions.
 */
export const UNIT_SLIP_FACTORS = [10, 100, 1000, 10_000, 100_000, 1_000_000] as const;
/** How far from an exact power of ten a ratio may be and still count as one (2%). */
export const UNIT_SLIP_TOLERANCE = 0.02;
/** More users than humans is not a growth story. */
export const WORLD_POPULATION_CEILING = 8_300_000_000;

type UsableMetric = ConsistencyMetricInput & { value: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A figure the audit may reason about: a finite, non-negative number that is not an honest Unknown. */
function usable(m: ConsistencyMetricInput): m is UsableMetric {
  return typeof m.value === 'number' && Number.isFinite(m.value) && m.value >= 0 && m.confidence !== 'unknown';
}

function time(value: unknown): number {
  return typeof value === 'string' ? Date.parse(value) : Number.NaN;
}

/** How recent a row is: the date its source gives the figure, else when it was stored. Unknown is the oldest. */
function recency(m: ConsistencyMetricInput): number {
  const asOf = [m.asOf, m.quotedSupport?.asOf, m.reportedSupport?.asOf, m.passageSupport?.asOf].map(time).filter(Number.isFinite);
  if (asOf.length > 0) return Math.max(...asOf);
  const captured = time(m.capturedAt);
  return Number.isFinite(captured) ? captured : Number.NEGATIVE_INFINITY;
}

/**
 * The row of this type that is current, as the card face reads it: a human-checked row first, else the newest. When the
 * newest rows disagree and nothing tells them apart, no figure is current, and an Unknown is never inconsistent.
 */
function metricOf(rows: readonly ConsistencyMetricInput[], type: MetricType): UsableMetric | null {
  const ofType = rows.filter((row) => row.metricType === type);
  if (ofType.length === 0) return null;
  const human = ofType.filter((row) => row.confidence === 'user_verified');
  const pool = human.length > 0 ? human : ofType;
  const newest = Math.max(...pool.map(recency));
  const tied = pool.filter((row) => recency(row) === newest);
  const first = tied[0]!;
  if (tied.some((row) => !Object.is(row.value, first.value))) return null;
  return usable(first) ? first : null;
}

/** True when the card face withholds this row (so the audit must not judge it): the face shows Valuation Unknown. */
function withheldByFace(row: ConsistencyMetricInput, ownership: Ownership | null | undefined): boolean {
  if (row.metricType !== 'valuation') return false;
  try {
    const metric = row as unknown as CompanyMetric;
    // The two rules enforceMetricProvenance applies on every read. A human's own figure is theirs to keep.
    if (row.confidence !== 'user_verified' && isAcquisitionPriceValuation(metric)) return true;
    return ownershipWithholdsValuation(metric, ownership);
  } catch {
    // Cannot tell what the face shows: do not judge the figure.
    return true;
  }
}

interface AuditedCompany {
  companyId: string;
  name: string;
  rows: ConsistencyMetricInput[];
}

/** Anything the caller hands in becomes a well-formed company, or nothing. */
function audited(raw: unknown): AuditedCompany[] {
  if (!isRecord(raw)) return [];
  const ownership = isRecord(raw.ownership) ? (raw.ownership as unknown as Ownership) : null;
  const rows = (Array.isArray(raw.metrics) ? raw.metrics : [])
    .filter((row): row is ConsistencyMetricInput => isRecord(row) && typeof row.metricType === 'string')
    // A withheld figure stays in place as an Unknown, so a stale row listed before it cannot step in as the current one.
    .map((row) => (withheldByFace(row, ownership) ? { ...row, value: null, confidence: 'unknown' } : row));
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'A company';
  return [{ companyId: String(raw.companyId ?? ''), name, rows }];
}

function fmtUsd(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${Math.round(value).toLocaleString()}`;
}

/**
 * The power of ten (10, 100, 1000 ... 1,000,000) that two figures differ by, within the tolerance, or null. Order does not
 * matter.
 */
export function unitSlipFactor(a: number, b: number): (typeof UNIT_SLIP_FACTORS)[number] | null {
  if (!(a > 0) || !(b > 0) || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const ratio = Math.max(a, b) / Math.min(a, b);
  return UNIT_SLIP_FACTORS.find((factor) => Math.abs(ratio - factor) / factor <= UNIT_SLIP_TOLERANCE + 1e-9) ?? null;
}

/**
 * Audit one deck's companies against each other and against arithmetic.
 * Deterministic: same input → same findings in the same order. Never throws.
 */
export function auditDeckConsistency(
  input: ConsistencyCompanyInput[],
): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];
  const companies = (Array.isArray(input) ? input : []).flatMap(audited);

  // ── 1. Market shares cannot sum past the whole market ──
  const shared = companies
    .map((company) => ({ company, share: metricOf(company.rows, 'market_share') }))
    .filter((x): x is { company: AuditedCompany; share: UsableMetric } => x.share !== null)
    .sort((a, b) => b.share.value - a.share.value);
  const shareSum = shared.reduce((sum, x) => sum + x.share.value, 0);
  if (shareSum > SHARE_SUM_WARNING_PCT) {
    const critical = shareSum > SHARE_SUM_CRITICAL_PCT;
    findings.push({
      code: 'share_sum_exceeds_market',
      severity: critical ? 'critical' : 'warning',
      message: `Stated market shares add up to ${shareSum.toFixed(1)}% — more than the whole market${
        critical
          ? '; at least one figure is wrong'
          : ', so they are likely measured on different bases (e.g. web traffic vs. enterprise API share)'
      }. Largest claims: ${shared
        .slice(0, 3)
        .map((x) => `${x.company.name} ${x.share.value.toFixed(1)}%`)
        .join(', ')}.`,
      companyIds: shared.map((x) => x.company.companyId),
      metricTypes: ['market_share'],
    });
  }

  for (const company of companies) {
    const arr = metricOf(company.rows, 'arr');
    const revenueRow = metricOf(company.rows, 'revenue');
    // The card's revenue slot can hold either type; ARR is the one the audit has always read.
    const revenue = arr ?? revenueRow;
    const revenueType: MetricType = arr ? 'arr' : 'revenue';
    const revenueLabel = arr ? 'ARR' : 'revenue';
    const valuation = metricOf(company.rows, 'valuation');
    const marketCap = metricOf(company.rows, 'market_cap');
    const employees = metricOf(company.rows, 'employees');
    const users = metricOf(company.rows, 'users');

    // ── 2. Revenue above a valuation is a doubt, and an error only as a unit slip. A distributor, an installer, a stale
    // round or a private-equity holding all sit here; only a gap of a thousand-fold or more is not a business. ──
    if (revenue && valuation && valuation.value > 0 && revenue.value > valuation.value) {
      const ratio = revenue.value / valuation.value;
      const slip = ratio > VALUATION_CRITICAL_FACTOR;
      findings.push({
        code: 'valuation_below_arr',
        severity: slip ? 'critical' : 'warning',
        message: slip
          ? `${company.name} is stored with ${fmtUsd(revenue.value)} ${revenueLabel} but only ${fmtUsd(valuation.value)} valuation — ${Math.round(ratio).toLocaleString()}× apart, which is a unit slip in one of them.`
          : `${company.name} is stored with ${fmtUsd(revenue.value)} ${revenueLabel} against a ${fmtUsd(valuation.value)} valuation — possible for a distributor, an installer or a stale round, so worth a look rather than an error.`,
        companyIds: [company.companyId],
        metricTypes: [revenueType, 'valuation'],
      });
    }

    // ── 2b. A LISTED company's market cap can sit below its revenue (Sunrun: $3B revenue, $1.8B market cap; a distressed
    // company far lower), so that alone is a doubt at most, and only a gap that large is even that. Past 1000x it cannot be a
    // business, only a unit slip, and it is an error. A warning is never re-verified: re-checking a correct figure every half
    // hour cost real money and told the reader it was wrong. ──
    if (revenue && marketCap && marketCap.value > 0 && revenue.value > marketCap.value) {
      const ratio = revenue.value / marketCap.value;
      if (ratio >= MARKET_CAP_UNIT_SLIP_FACTOR) {
        const slip = ratio > MARKET_CAP_CRITICAL_FACTOR;
        findings.push({
          code: 'valuation_below_arr',
          severity: slip ? 'critical' : 'warning',
          message: slip
            ? `${company.name} is stored with ${fmtUsd(revenue.value)} ${revenueLabel} but only ${fmtUsd(marketCap.value)} market cap — ${Math.round(ratio).toLocaleString()}× apart, which is a unit slip in one of them, not a cheap stock.`
            : `${company.name} is stored with ${fmtUsd(revenue.value)} ${revenueLabel} against a ${fmtUsd(marketCap.value)} market cap (${Math.round(ratio).toLocaleString()}×) — unusual, though possible for a distressed listed company.`,
          companyIds: [company.companyId],
          metricTypes: [revenueType, 'market_cap'],
        });
      }
    }

    // ── 2c. Two figures that should agree but differ by exactly a power of ten are a unit slip in one of them ──
    if (valuation && marketCap) {
      const factor = unitSlipFactor(valuation.value, marketCap.value);
      if (factor) {
        findings.push({
          code: 'figures_differ_by_power_of_ten',
          severity: 'critical',
          message: `${company.name} is stored with ${fmtUsd(valuation.value)} valuation and ${fmtUsd(marketCap.value)} market cap — the two differ by ${factor}×, the signature of a unit slip in one of them.`,
          companyIds: [company.companyId],
          metricTypes: ['valuation', 'market_cap'],
        });
      }
    }
    if (arr && revenueRow) {
      const factor = unitSlipFactor(arr.value, revenueRow.value);
      if (factor) {
        findings.push({
          code: 'figures_differ_by_power_of_ten',
          severity: 'critical',
          message: `${company.name} is stored with ${fmtUsd(arr.value)} ARR and ${fmtUsd(revenueRow.value)} revenue — the two differ by ${factor}×, the signature of a unit slip in one of them.`,
          companyIds: [company.companyId],
          metricTypes: ['arr', 'revenue'],
        });
      }
    }

    // ── 3. Revenue per employee beyond any real business ──
    if (arr && employees && employees.value > 0) {
      const perHead = arr.value / employees.value;
      if (perHead > MAX_PLAUSIBLE_ARR_PER_EMPLOYEE_USD) {
        findings.push({
          code: 'arr_per_employee_implausible',
          severity: 'warning',
          message: `${company.name} would be earning ${fmtUsd(perHead)} per employee (${fmtUsd(arr.value)} ARR ÷ ${employees.value.toLocaleString()} staff) — beyond any known business; one of the two figures deserves a re-check.`,
          companyIds: [company.companyId],
          metricTypes: ['arr', 'employees'],
        });
      }
    }

    // ── 4. More users than people on Earth ──
    if (users && users.value > WORLD_POPULATION_CEILING) {
      findings.push({
        code: 'users_exceed_population',
        severity: 'critical',
        message: `${company.name} is stored with ${users.value.toLocaleString()} users — more than the world's population.`,
        companyIds: [company.companyId],
        metricTypes: ['users'],
      });
    }
  }

  return findings;
}

/**
 * The metric re-verifications that would resolve the current CRITICAL findings,
 * deduplicated. This is the bridge between the audit and the living runtime's
 * verification queue, and re-verification costs money: a warning is a doubt the
 * reader sees, so it never queues one. A share-sum finding names every company
 * with a share, but only the largest few are worth a paid check.
 */
export function verificationTargetsFrom(
  findings: ConsistencyFinding[],
): Array<{ companyId: string; metricType: MetricType }> {
  const seen = new Set<string>();
  const targets: Array<{ companyId: string; metricType: MetricType }> = [];
  for (const finding of Array.isArray(findings) ? findings : []) {
    if (!isRecord(finding) || finding.severity !== 'critical') continue;
    const companyIds = Array.isArray(finding.companyIds) ? finding.companyIds : [];
    const metricTypes = Array.isArray(finding.metricTypes) ? finding.metricTypes : [];
    // Share findings list companies by descending share, so the first few are the largest.
    const queued = finding.code === 'share_sum_exceeds_market' ? companyIds.slice(0, MAX_SHARE_SUM_TARGETS) : companyIds;
    for (const companyId of queued) {
      for (const metricType of metricTypes) {
        const key = `${companyId}:${metricType}`;
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({ companyId, metricType });
      }
    }
  }
  return targets;
}
