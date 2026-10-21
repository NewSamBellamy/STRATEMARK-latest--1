/**
 * Wires the CRAAP core (source-assessment.ts) into stored metric rows: how a
 * figure's evidence is read, how its confidence is capped when it is accepted
 * or shown, and (further down) which of two figures for the same slot wins.
 *
 * Pure: the clock is always passed in. Never produces or changes a value
 * (AGENTS.md Rule 9); it only labels the evidence and may lower `verified` to
 * `estimated`. `user_verified` is a human's call and is never touched.
 */
import type { CompanyMetric, Confidence, SourceAssessment } from '@mi/contracts';
import { hostOf } from './registries/shared';
import { assessFigure, capConfidence, confidenceCapReasons, type AssessableCitation } from './source-assessment';

/** The date a figure's own evidence states: the reported period, never when we captured it. */
export function figureDate(metric: Pick<CompanyMetric, 'reportedSupport' | 'passageSupport' | 'quotedSupport'>): string | null {
  const raw = metric.reportedSupport?.asOf ?? metric.passageSupport?.asOf ?? metric.quotedSupport?.asOf ?? null;
  // 1970-01-01 is the "no date found" placeholder some recovery paths write; it is not a date.
  return raw && !raw.startsWith('1970-') ? raw : null;
}

/** The citations behind a row, each carrying the figure's own stated period (the stored citation has no date of its own). */
export function metricAssessableCitations(metric: Pick<CompanyMetric, 'citations' | 'reportedSupport' | 'passageSupport' | 'quotedSupport'>): AssessableCitation[] {
  const asOf = figureDate(metric);
  return (metric.citations ?? []).map((c) => ({ url: c.url, title: c.title, publisher: c.title, asOf }));
}

/** The company's own domain, so its own pages read as company-issued. */
export const companyDomainOf = (website: string | null | undefined): string | null => hostOf(website);

/** The assessment of a row that holds a value; null for an empty slot (nothing to assess). */
export function assessMetric(metric: CompanyMetric, now: Date, companyDomain?: string | null, asOfHint?: string | null): SourceAssessment | null {
  if (metric.value == null || metric.confidence === 'unknown') return null;
  const citations = metricAssessableCitations(metric).map((c) => ({ ...c, asOf: c.asOf ?? asOfHint ?? null }));
  return { ...assessFigure({ metricType: metric.metricType, citations, now, companyDomain }), assessedAt: now.toISOString() };
}

const NOT_VERIFIED = 'Not verified: ';

/**
 * The confidence a row may keep given its assessment. Only ever `verified` ->
 * `estimated`, for stale, undated or weak-only evidence. "Only the company says
 * so" is deliberately NOT a reason here: an issuer's own filing or page that the
 * original-source gate accepted stays `verified` and keeps its existing
 * "issuer-reported, not independently corroborated" label (the assessment still
 * records `companyReportedOnly`). Owner decision: see the PR notes.
 */
export function cappedConfidenceFor(requested: Confidence, assessment: SourceAssessment | null): Confidence {
  return assessment ? capConfidence(requested, { ...assessment, companyReportedOnly: false }) : requested;
}

const capReasons = (assessment: SourceAssessment): string[] =>
  confidenceCapReasons({ ...assessment, companyReportedOnly: false });

/** Store the assessment on the row and lower a `verified` figure the evidence does not support. Returns the assessment. */
export function settleMetric(metric: CompanyMetric, now: Date, companyDomain?: string | null, asOfHint?: string | null): SourceAssessment | null {
  // A human's figure keeps its own standing: it is never relabelled here.
  if (metric.confidence === 'user_verified') return null;
  const assessment = assessMetric(metric, now, companyDomain, asOfHint);
  if (!assessment) return null;
  metric.assessment = assessment;
  if (metric.confidence === 'verified' && cappedConfidenceFor('verified', assessment) !== 'verified') {
    const reasons = capReasons(assessment).join(' ');
    metric.confidence = 'estimated';
    metric.lastVerifiedAt = null;
    metric.methodNote = [metric.methodNote?.replace(new RegExp(`\\s*${NOT_VERIFIED}.*$`, 's'), ''), `${NOT_VERIFIED}${reasons}`].filter(Boolean).join(' ');
  }
  return assessment;
}

/**
 * Read-time view of a figure: assessed afresh from its stored citations (so a
 * row written before assessments existed still gets one, and age keeps
 * counting), and labelled `estimated` when its evidence no longer supports
 * `verified`. The value is never changed or dropped.
 */
export function assessedForDisplay(metric: CompanyMetric, now: Date, companyDomain?: string | null): CompanyMetric {
  const row = structuredClone(metric);
  // The period stated when the figure was accepted survives the support blocks
  // being cleared (a figure confirmed by a retained original loses its
  // reportedSupport); a row never assessed before has no such date.
  settleMetric(row, now, companyDomain, metric.assessment?.currency.basis === 'asOf' ? metric.assessment.currency.date : null);
  // A read-time assessment is derived from the clock, not a stored fact, so it
  // carries no stamp (this also keeps repeated reads deep-equal).
  if (row.assessment) delete row.assessment.assessedAt;
  return row;
}
