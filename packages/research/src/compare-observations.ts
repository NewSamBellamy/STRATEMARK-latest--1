/**
 * Latest wins (PLAN-CRAAP 1.3): when a figure arrives for a slot that already holds
 * one, decide by evidence and date which stays, never by who arrived last and never
 * by averaging.
 *
 *   1. A human figure always wins; automation never replaces it.
 *   2. Comparable only on the same measurement and period kind (FY and TTM revenue
 *      never replace each other).
 *   3. "At least as authoritative": publisher fit no worse AND lane rank no lower
 *      (verified 3, page-backed estimate 2, search-attributed or band 1), reading
 *      the DISPLAYED confidence.
 *   4. Undated never beats dated; both undated: the fresh lookup replaces when it is
 *      at least as authoritative (as hunts always did).
 *   5. Newer and at least as authoritative replaces (the old value is kept dated);
 *      newer but weaker is kept out and recorded as `newerObservation`.
 *   6. Older keeps. 7. Same date: values within 2% agree; differing values: the
 *      stronger wins, a tie is a conflict.
 *   8-9. Replaced values are kept, conflicts are capped at 8, nothing is synthesised.
 *
 * Pure: the clock is passed in.
 */
import { figureAsOf, metricObservationIdentity, readCurrency, type CompanyMetric } from '@mi/contracts';
import { assessFigure, laneRank, periodKind, type AssessContext } from './source-assessment';
import { figurePublisher } from './metric-assessment';

export type ObservationDecision = 'replace' | 'keep' | 'conflict' | 'not_comparable';
export interface ObservationComparison {
  decision: ObservationDecision;
  reason: string;
  /** Set when a newer figure was kept out because it is less authoritative. */
  newerObservation?: boolean;
}

export const PRIOR_FIGURES_MAX = 8;
export const CONFLICTS_MAX = 8;
/** Same 366-day window the read path uses to show a verified figure as an estimate. */
const AGED_OUT_MS = 366 * 86_400_000;
const LEVEL_RANK = { strong: 3, acceptable: 2, weak: 1 } as const;

/** Displayed lane and publisher level of a stored figure, after the read-time demotions. */
function standing(metric: CompanyMetric, ctx: AssessContext): { lane: number; level: number; asOf: string | null } {
  const assessment = assessFigure(metric, ctx);
  const own = figureAsOf(metric);
  const reading = readCurrency({ metricType: metric.metricType, asOf: own.asOf, asOfSource: own.source, now: ctx.now });
  const demoted = assessment?.effect === 'demoted_stale' || assessment?.effect === 'demoted_authority'
    || (metric.confidence === 'verified' && reading.asOf != null && ctx.now.getTime() - Date.parse(`${reading.asOf}T00:00:00.000Z`) > AGED_OUT_MS);
  const lane = demoted && laneRank(metric) === 3 ? 2 : laneRank(metric);
  const level = assessment?.authority.level ? LEVEL_RANK[assessment.authority.level] : 0;
  return { lane, level, asOf: reading.asOf };
}

const within2pct = (a: number, b: number): boolean => Math.abs(a - b) <= 0.02 * Math.max(Math.abs(a), Math.abs(b));

export function compareObservations(next: CompanyMetric, current: CompanyMetric, ctx: AssessContext): ObservationComparison {
  if (current.confidence === 'user_verified') return { decision: next.confidence === 'user_verified' ? 'replace' : 'keep', reason: 'a human figure is never replaced by automation' };
  if (next.confidence === 'user_verified') return { decision: 'replace', reason: 'a human figure always wins' };
  if (current.value == null || current.confidence === 'unknown') return { decision: 'replace', reason: 'the slot was empty' };
  if (next.value == null || next.confidence === 'unknown') return { decision: 'keep', reason: 'an empty result never replaces a figure' };

  const sameMeasure = JSON.parse(metricObservationIdentity(next))[0] === JSON.parse(metricObservationIdentity(current))[0];
  const kindNext = periodKind(next);
  const kindCurrent = periodKind(current);
  if (!sameMeasure || (kindNext !== kindCurrent && kindNext !== 'unstated' && kindCurrent !== 'unstated')) {
    return { decision: 'not_comparable', reason: `different measurement basis (${kindNext} vs ${kindCurrent}): kept as a separate dated observation` };
  }

  const n = standing(next, ctx);
  const c = standing(current, ctx);
  const atLeast = n.lane >= c.lane && n.level >= c.level;
  if (n.asOf == null && c.asOf != null) return { decision: 'keep', reason: 'an undated figure never beats a dated one' };
  if (n.asOf != null && c.asOf == null) {
    return atLeast ? { decision: 'replace', reason: 'dated figure replaces an undated one' }
      : { decision: 'keep', reason: 'dated but less authoritative; the current figure stays', newerObservation: true };
  }
  if (n.asOf == null && c.asOf == null) {
    return atLeast ? { decision: 'replace', reason: 'replaced by a fresh lookup; neither could be dated apart' }
      : { decision: 'keep', reason: 'less authoritative than the current figure' };
  }
  if (n.asOf! > c.asOf!) {
    return atLeast ? { decision: 'replace', reason: `newer figure (${n.asOf}) from an at-least-as-authoritative source` }
      : { decision: 'keep', reason: `newer figure (${n.asOf}) is less authoritative; the current figure stays`, newerObservation: true };
  }
  if (n.asOf! < c.asOf!) return { decision: 'keep', reason: 'older than the current figure' };
  // Same date.
  if (within2pct(next.value, current.value)) {
    // Agreement is corroboration: a re-confirmation by at-least-as-strong evidence refreshes the row.
    return atLeast ? { decision: 'replace', reason: 'same date, values agree; re-confirmed' }
      : { decision: 'keep', reason: 'same date, values agree; the current evidence is stronger' };
  }
  if (n.lane !== c.lane || n.level !== c.level) {
    return n.lane > c.lane || (n.lane === c.lane && n.level > c.level)
      ? { decision: 'replace', reason: 'same date, values differ; the stronger evidence wins' }
      : { decision: 'keep', reason: 'same date, values differ; the current evidence is stronger' };
  }
  return { decision: 'conflict', reason: 'same date, equally strong evidence, values differ' };
}

const entryOf = (m: CompanyMetric) => ({
  value: m.value, confidence: m.confidence, source: m.source ?? null, capturedAt: m.capturedAt,
  asOf: figureAsOf(m).asOf, publisher: figurePublisher(m),
});

/**
 * A figure was just written over `metric` in place; `prior` is the row as it stood
 * before. Apply `compareObservations`: the new figure stays (the old is kept in
 * `priorFigures` with its date and reason), or the row is put back exactly as it was
 * (a newer but weaker figure is recorded as `newerObservation`, a different basis or a
 * conflict is recorded without touching the figure). Returns true when the new figure
 * stays. Never invents or averages a value.
 */
export function resolveWrite(metric: CompanyMetric, prior: CompanyMetric | null, ctx: AssessContext): boolean {
  if (!prior || prior.value == null || prior.confidence === 'unknown') return true;
  const verdict = compareObservations(metric, prior, ctx);
  const next = structuredClone(metric);
  if (verdict.decision === 'replace') {
    const old = entryOf(prior);
    // Re-stating the same figure for the same date is a confirmation, not a replacement worth remembering.
    const same = old.value === next.value && old.asOf === figureAsOf(next).asOf;
    metric.priorFigures = same ? prior.priorFigures : [...(prior.priorFigures ?? []), {
      value: old.value, confidence: old.confidence, source: old.source, asOf: old.asOf, capturedAt: old.capturedAt,
      supersededAt: ctx.now.toISOString(), reason: verdict.reason.slice(0, 300),
    }].slice(-PRIOR_FIGURES_MAX);
    if (metric.priorFigures === undefined) delete metric.priorFigures;
    delete metric.newerObservation;
    return true;
  }
  for (const key of Object.keys(metric)) if (!(key in prior)) delete (metric as unknown as Record<string, unknown>)[key];
  Object.assign(metric, structuredClone(prior));
  const seen = entryOf(next);
  if (verdict.decision === 'keep' && verdict.newerObservation) {
    metric.newerObservation = { value: seen.value, asOf: seen.asOf, publisher: seen.publisher, capturedAt: ctx.now.toISOString() };
  } else if (verdict.decision === 'not_comparable') {
    metric.priorFigures = [...(prior.priorFigures ?? []), {
      value: seen.value, confidence: seen.confidence, source: seen.source, asOf: seen.asOf, capturedAt: seen.capturedAt,
      supersededAt: ctx.now.toISOString(), reason: verdict.reason.slice(0, 300),
    }].slice(-PRIOR_FIGURES_MAX);
  } else if (verdict.decision === 'conflict') {
    const here = entryOf(prior);
    metric.conflicts = [...(prior.conflicts ?? []), {
      metricType: metric.metricType,
      observations: [here, seen].map((o) => ({ value: o.value, confidence: o.confidence, source: o.source, capturedAt: o.capturedAt, asOf: o.asOf, publisher: o.publisher })),
      detectedAt: ctx.now.toISOString(), preferredObservation: 0,
    }].slice(-CONFLICTS_MAX);
  }
  return false;
}
