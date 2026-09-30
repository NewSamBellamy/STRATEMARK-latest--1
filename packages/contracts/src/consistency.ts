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
import type { MetricType, UserFootprintBasis } from './enums';
import { inferUserFootprintBasis } from './user-footprint';

export type ConsistencySeverity = 'warning' | 'critical';

export type ConsistencyCode =
  | 'share_sum_exceeds_market'
  | 'valuation_below_arr'
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
    userBasis?: UserFootprintBasis;
    methodNote?: string | null;
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
/** More users than humans is not a growth story. */
export const WORLD_POPULATION_CEILING = 8_300_000_000;
const HUMAN_USER_BASES = new Set<UserFootprintBasis>([
  'daily_active_users',
  'weekly_active_users',
  'monthly_active_users',
  'active_users_unspecified',
  'individual_paying_customers',
]);

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
    const valuation = metricOf(company, 'valuation') ?? metricOf(company, 'market_cap');
    const employees = metricOf(company, 'employees');
    const usersMetric = company.metrics.find((m) => m.metricType === 'users');
    const users = usersMetric && usable(usersMetric) ? usersMetric : null;
    const userBasis = usersMetric?.userBasis ?? inferUserFootprintBasis(usersMetric?.methodNote);

    // ── 2. A valuation below annual revenue is a near-certain data error ──
    if (arr && valuation && valuation.value < arr.value) {
      findings.push({
        code: 'valuation_below_arr',
        severity: 'critical',
        message: `${company.name} is stored with ${fmtUsd(arr.value)} ARR but only ${fmtUsd(valuation.value)} valuation — revenue above valuation almost always means one figure is wrong.`,
        companyIds: [company.companyId],
        metricTypes: ['arr', 'valuation'],
      });
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
    if (users && HUMAN_USER_BASES.has(userBasis) && users.value > WORLD_POPULATION_CEILING) {
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
 * Rank the metric re-verifications that would resolve the current findings,
 * most severe first, deduplicated. This is the bridge between the audit and
 * the living runtime's verification queue.
 */
export function verificationTargetsFrom(
  findings: ConsistencyFinding[],
): Array<{ companyId: string; metricType: MetricType }> {
  const seen = new Set<string>();
  const targets: Array<{ companyId: string; metricType: MetricType }> = [];
  const ordered = [...findings].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1,
  );
  for (const finding of ordered) {
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
