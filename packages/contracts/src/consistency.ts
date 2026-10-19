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
 *    missed ones — a "critical" here must be indefensible.
 */
import type { MetricType } from './enums';

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

/** The slice of a company the audit needs — kept minimal so any caller can map into it. */
export interface ConsistencyCompanyInput {
  companyId: string;
  name: string;
  metrics: Array<{
    metricType: MetricType;
    value: number | null;
    /** 'unknown' rows are ignored — an honest Unknown is never inconsistent. */
    confidence: string;
  }>;
}

/**
 * Market-share sum thresholds. Above 100 (+rounding slack) the shares cannot
 * all be true on the same measurement basis → warning; far above, at least
 * one figure is simply wrong → critical.
 */
export const SHARE_SUM_WARNING_PCT = 100.5;
export const SHARE_SUM_CRITICAL_PCT = 110;
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
 * Two figures that should agree (a market cap and a valuation, an ARR and a revenue) but differ by one of these factors are
 * the signature of a unit slip in one of them: $1.4B against $14B, or $2.2B against $220B.
 */
export const UNIT_SLIP_FACTORS = [10, 100, 1000] as const;
/** How far from an exact power of ten a ratio may be and still count as one (2%). */
export const UNIT_SLIP_TOLERANCE = 0.02;
/** More users than humans is not a growth story. */
export const WORLD_POPULATION_CEILING = 8_300_000_000;

function usable(m: { value: number | null; confidence: string }): m is {
  value: number;
  confidence: string;
} {
  return m.value !== null && m.confidence !== 'unknown';
}

function metricOf(
  company: ConsistencyCompanyInput,
  type: MetricType,
): { value: number; confidence: string } | null {
  const row = company.metrics.find((m) => m.metricType === type);
  return row && usable(row) ? row : null;
}

function fmtUsd(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${Math.round(value).toLocaleString()}`;
}

/**
 * The power of ten (10, 100 or 1000) that two figures differ by, within the tolerance, or null. Order does not matter.
 */
export function unitSlipFactor(a: number, b: number): (typeof UNIT_SLIP_FACTORS)[number] | null {
  if (!(a > 0) || !(b > 0)) return null;
  const ratio = Math.max(a, b) / Math.min(a, b);
  return UNIT_SLIP_FACTORS.find((factor) => Math.abs(ratio - factor) / factor <= UNIT_SLIP_TOLERANCE + 1e-9) ?? null;
}

/**
 * Audit one deck's companies against each other and against arithmetic.
 * Deterministic: same input → same findings in the same order.
 */
export function auditDeckConsistency(
  companies: ConsistencyCompanyInput[],
): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];

  // ── 1. Market shares cannot sum past the whole market ──
  const shared = companies
    .map((c) => ({ company: c, share: metricOf(c, 'market_share') }))
    .filter((x): x is { company: ConsistencyCompanyInput; share: { value: number; confidence: string } } => x.share !== null)
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
    const arr = metricOf(company, 'arr');
    const revenueRow = metricOf(company, 'revenue');
    // The card's revenue slot can hold either type; ARR is the one the audit has always read.
    const revenue = arr ?? revenueRow;
    const revenueType: MetricType = arr ? 'arr' : 'revenue';
    const revenueLabel = arr ? 'ARR' : 'revenue';
    const valuation = metricOf(company, 'valuation');
    const marketCap = metricOf(company, 'market_cap');
    const employees = metricOf(company, 'employees');
    const users = metricOf(company, 'users');

    // ── 2. A valuation below annual revenue is a near-certain data error ──
    if (revenue && valuation && valuation.value < revenue.value) {
      findings.push({
        code: 'valuation_below_arr',
        severity: 'critical',
        message: `${company.name} is stored with ${fmtUsd(revenue.value)} ${revenueLabel} but only ${fmtUsd(valuation.value)} valuation — revenue above valuation almost always means one figure is wrong.`,
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
 * reader sees, so it never queues one.
 */
export function verificationTargetsFrom(
  findings: ConsistencyFinding[],
): Array<{ companyId: string; metricType: MetricType }> {
  const seen = new Set<string>();
  const targets: Array<{ companyId: string; metricType: MetricType }> = [];
  for (const finding of findings) {
    if (finding.severity !== 'critical') continue;
    for (const companyId of finding.companyIds) {
      for (const metricType of finding.metricTypes) {
        const key = `${companyId}:${metricType}`;
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({ companyId, metricType });
      }
    }
  }
  return targets;
}
