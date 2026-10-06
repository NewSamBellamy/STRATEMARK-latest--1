import type { CompanyMetric } from './types';
import type { Citation } from './repository';
import type { MetricType } from './enums';
import { hasVerificationGradeCitation, usableCitations } from './provenance';
import { markVerified } from './freshness';

/** Select a stored revision, not a source reporting period or a claim of truth.
 * Returns the original row for writes; ambiguous ties must not be auto-mutated.
 */
export function currentMetricRevision(input: readonly CompanyMetric[], companyId: string, metricType: MetricType) {
  const rows = input.filter(m => m.companyId === companyId && m.metricType === metricType);
  if (!rows.length) return undefined;
  const human = rows.filter(m => m.confidence === 'user_verified');
  const candidates = human.length ? human : rows;
  const activity = (m: CompanyMetric) => Math.max(0, ...[
    m.capturedAt, m.lastVerificationAttemptAt, m.lastVerifiedAt,
  ].map(date => Date.parse(date ?? '')).filter(Number.isFinite));
  const newest = Math.max(...candidates.map(activity));
  const tied = candidates.filter(m => activity(m) === newest).sort((a, b) => a.id.localeCompare(b.id));
  const metric = tied[0]!;
  return { metric, tied, ambiguous: tied.some(m => !Object.is(m.value, metric.value) || m.confidence !== metric.confidence) };
}

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
  officialWebsite?: string | null,
): { metric: CompanyMetric; verdict: 'supported' | 'contradicted' | 'unverified'; changed: boolean } {
  const metric = { ...current, lastVerificationAttemptAt: nowIso };
  const cited = usableCitations(citations, officialWebsite);
  const value = observation.currentValue;
  const valid = validMetricVerificationValue(current.metricType, value);
  const differs = valid && metricVerificationDiffers(current.value, value);
  const corroborated = valid && hasVerificationGradeCitation(cited, officialWebsite) &&
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
