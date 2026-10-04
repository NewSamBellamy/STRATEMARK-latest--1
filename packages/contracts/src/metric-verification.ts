import type { CompanyMetric } from './types';
import type { Citation } from './repository';
import type { MetricType } from './enums';
import { hasVerificationGradeCitation, usableCitations } from './provenance';
import { markVerified } from './freshness';

/** Value bounds, not evidence of truth. Do not coerce API strings to numbers. */
export function validMetricVerificationValue(metricType: MetricType, value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
    (metricType !== 'market_share' || value <= 100);
}

export function metricVerificationDiffers(prior: number | null, value: number): boolean {
  return prior === null || Math.abs(value - prior) / Math.max(Math.abs(prior), 1) > 0.02;
}

/** Shared local/cloud transition. Publisher-grade citations are NOT passage proof. */
export function applyMetricVerification(
  current: CompanyMetric,
  observation: { verdict: 'supported' | 'contradicted' | 'unverified'; currentValue: number | null; rationale: string; methodNote: string | null },
  citations: readonly Citation[],
  nowIso: string,
): { metric: CompanyMetric; verdict: 'supported' | 'contradicted' | 'unverified'; changed: boolean } {
  const metric = { ...current, lastVerificationAttemptAt: nowIso };
  const cited = usableCitations(citations);
  const value = observation.currentValue;
  const valid = validMetricVerificationValue(current.metricType, value);
  const differs = valid && metricVerificationDiffers(current.value, value);
  const corroborated = valid && hasVerificationGradeCitation(cited) &&
    ((observation.verdict === 'supported' && !differs) || (observation.verdict === 'contradicted' && differs));
  const verdict = corroborated ? observation.verdict : 'unverified';
  let changed = false;
  if (current.confidence !== 'user_verified') {
    if (corroborated) {
      if (differs || current.confidence !== 'verified') {
        if (differs) metric.value = value;
        metric.confidence = 'verified';
        metric.citations = cited;
        metric.source = cited[0]?.url ?? current.source;
        metric.methodNote = observation.methodNote ?? `Live verification: ${observation.rationale}`;
        if (differs) metric.capturedAt = nowIso;
        changed = true;
      }
      Object.assign(metric, markVerified(metric, nowIso));
    } else if (current.confidence === 'verified') {
      metric.confidence = 'estimated';
      metric.methodNote = `Could not re-corroborate from live sources on ${nowIso.slice(0, 10)}; badge downgraded pending fresh evidence.`;
      changed = true;
    }
  }
  return { metric, verdict, changed };
}
