/**
 * Provenance enforcement — the product's central promise, in code.
 *
 * Audit finding (2026-07-29): 3 of 29 metrics labelled `verified` in a real
 * research run carried **no citation at all**. The model had claimed high
 * confidence without pointing at a source, and nothing downstream objected. For
 * a tool people make financial decisions on, that is the worst possible bug: it
 * is indistinguishable from an invented number.
 *
 * So "verified" is no longer something a model can simply assert. It is a
 * *derived* state that requires evidence, enforced here and applied at every
 * point a metric is created or updated.
 */
import { MODEL_PROPOSABLE_CONFIDENCE, type Confidence } from './enums';
import type { Citation, MetricConflict, SourceCredibility } from './repository';
import type { CompanyMetric } from './types';

/** Reason text stamped on a figure that lost its "verified" claim. */
export const UNSOURCED_DOWNGRADE_NOTE =
  'Confidence lowered automatically: the research pass claimed this figure was verified but returned no usable clickable source for it.';

/**
 * Confidence levels a model is allowed to assert on its own.
 * `verified` is absent by design — it must be earned with a citation.
 * `user_verified` is absent too: only a human override may set it.
 */
const MODEL_ASSERTABLE: readonly Confidence[] = MODEL_PROPOSABLE_CONFIDENCE.filter(
  (level) => level !== 'verified',
);

export function isModelAssertable(confidence: Confidence): boolean {
  return MODEL_ASSERTABLE.includes(confidence);
}

/** Reason text stamped on a figure whose forged human sign-off was removed. */
export const HUMAN_ONLY_CONFIDENCE_NOTE =
  'Human-verification claim removed automatically: only a person can mark a figure user-verified, and no person did.';

/** Drop citations that can't be shown or clicked. */
export function usableCitations(citations: readonly Citation[] | undefined): Citation[] {
  if (!Array.isArray(citations)) return [];
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of citations) {
    // Provider responses and imported vaults are not made safe by TS types.
    // Drop malformed rows without taking down their well-formed siblings.
    if (!c || typeof c.url !== 'string') continue;
    const url = c.url.trim();
    const title = typeof c.title === 'string' ? c.title.trim() : '';
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    try {
      const parsed = new URL(url);
      if (!parsed.hostname || parsed.username || parsed.password) continue;
    } catch { continue; }
    seen.add(url);
    out.push({
      url,
      title: title || publisherOf(url),
      // Supplied labels are untrusted (model output and imported snapshots).
      credibility: classifySource(url, title),
    });
  }
  return out;
}

/**
 * Human-readable publisher for a citation URL.
 *
 * Grounded citations arrive as `vertexaisearch.cloud.google.com/grounding-api-
 * redirect/...`, which tells a user nothing. Google supplies the real publisher
 * in the citation title, so prefer that; fall back to the hostname.
 */
export function publisherOf(url: string, title?: string | null): string {
  const t = (title ?? '').trim();
  if (t && !/vertexaisearch|grounding-api-redirect/i.test(t)) return t;
  // A redirect with no usable title means the publisher was never recorded.
  // Showing "vertexaisearch.cloud.google.com" would imply Google published the
  // figure, which is false and worse than admitting the gap.
  if (isRedirectCitation(url)) return UNRECORDED_PUBLISHER;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

/** Shown when a citation survived but the publisher name did not. */
export const UNRECORDED_PUBLISHER = 'Publisher not recorded';

/**
 * Classify a source conservatively. This is a routing signal, not a claim that a
 * publisher is always correct: verified still requires the source to state the
 * exact figure and survive provenance enforcement.
 */
export function classifySource(url: string, title?: string | null, officialWebsite?: string | null): SourceCredibility {
  const hostOf = (value: string): string | null => {
    try {
      const parsed = new URL(value.includes('://') ? value : `https://${value}`);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.toLowerCase().replace(/^www\./, '') : null;
    } catch { return null; }
  };
  let host = hostOf(url);
  // Grounding's opaque redirect carries a publisher domain in its metadata.
  // Accept only a bare domain, never free-form titles such as "Reuters says...".
  if (host === 'vertexaisearch.cloud.google.com') {
    host = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test((title ?? '').trim()) ? hostOf(title!.trim()) : null;
  }
  if (!host) return 'unknown';
  const belongsTo = (domain: string) => host === domain || host!.endsWith(`.${domain}`);
  if (['reddit.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'quora.com', 'stocktwits.com'].some(belongsTo))
    return 'user_generated';
  if (['sec.gov', 'uscourts.gov', 'companieshouse.gov.uk', 'find-and-update.company-information.service.gov.uk', 'sedarplus.ca', 'hkexnews.hk'].some(belongsTo))
    return 'primary';
  const official = officialWebsite ? hostOf(officialWebsite) : null;
  if (official && belongsTo(official)) return 'primary';
  if (['reuters.com', 'bloomberg.com', 'wsj.com', 'ft.com', 'apnews.com', 'nytimes.com', 'bbc.com', 'bbc.co.uk', 'economist.com'].some(belongsTo))
    return 'reputable_secondary';
  if (['techcrunch.com', 'theinformation.com', 'crunchbase.com', 'pitchbook.com', 'venturebeat.com', 'wired.com', 'arstechnica.com', 'statista.com', 'counterpointresearch.com', 'canalys.com', 'gartner.com', 'idc.com', 'similarweb.com', 'sacra.com', 'cbinsights.com', 'sensortower.com', 'tradingview.com', 'morningstar.com', 'factset.com'].some(belongsTo))
    return 'industry';
  return 'unknown';
}

/** True when a citation URL is an opaque grounding redirect (may expire). */
export function isRedirectCitation(url: string): boolean {
  return /vertexaisearch\.cloud\.google\.com|grounding-api-redirect/i.test(url);
}

/**
 * Sources that must NEVER support a "verified" badge: SEO/link-building shops,
 * content farms, coupon/promo mills. Discovered in production — a company's
 * market share was displayed as "verified per fatjoe.com" (an SEO-services
 * site). A junk domain can still appear in a citation list for transparency;
 * it just carries no verification weight.
 *
 * Conservative by design: unknown-but-legitimate niche outlets (analyst firms,
 * trade press) are NOT junk — only recognizable content-mill patterns are.
 */
const JUNK_SOURCE_PATTERN =
  /fatjoe\.|backlinko|linkbuild|link-build|guest-?post|seo-?(service|agency|blog|tool)|buy-?backlink|promo-?code|coupon|essaywrit|articleforge|contentfarm|prnewswire\.com\/promo/i;

export function isJunkSource(url: string, title?: string | null): boolean {
  return JUNK_SOURCE_PATTERN.test(`${url} ${title ?? ''}`);
}

/**
 * Recognized publisher gate, NOT proof that a page supports a claim. Unknown
 * sources remain inspectable but need independent review before verification.
 * Ignore supplied credibility; never let it override the URL classification.
 */
export function hasVerificationGradeCitation(
  citations: readonly Citation[] | undefined,
): boolean {
  if (!citations) return false;
  return usableCitations(citations).some(
    (c) =>
      !isJunkSource(c.url, c.title) &&
      ['primary', 'reputable_secondary', 'industry'].includes(classifySource(c.url, c.title)),
  );
}

const JUNK_DOWNGRADE_NOTE =
  'Downgraded: sources are low-credibility, user-generated or not independently classified; a recognized source and claim-support review are required for verification.';

/**
 * Bring a freshly-researched metric in line with the provenance rules.
 *
 * - `verified` without a usable citation is demoted to `estimated` and stamped
 *   with why. It is never silently kept, and never promoted.
 * - `user_verified` is preserved: a human said so, which outranks the model.
 * - `unknown` must not carry a value (an unknown with a number is a contradiction).
 * - `source` is kept in sync with the first citation.
 */
export function enforceMetricProvenance(metric: CompanyMetric): CompanyMetric {
  const citations = usableCitations(metric.citations);
  // Prose attribution survives for transparency but cannot earn verification.
  const proseSource = (metric.source ?? '').trim();
  const hasEvidence = citations.length > 0;

  let confidence = metric.confidence;
  let methodNote = metric.methodNote;

  if (confidence === 'verified' && !hasEvidence) {
    confidence = 'estimated';
    methodNote = methodNote
      ? `${methodNote} — ${UNSOURCED_DOWNGRADE_NOTE}`
      : UNSOURCED_DOWNGRADE_NOTE;
  }

  // CREDIBILITY GATE: citations exist, but none is fit to verify (all junk
  // domains / user-generated). The figure stays, the badge honestly drops.
  if (
    confidence === 'verified' &&
    citations.length > 0 &&
    !hasVerificationGradeCitation(citations)
  ) {
    confidence = 'estimated';
    methodNote = methodNote
      ? `${methodNote} — ${JUNK_DOWNGRADE_NOTE}`
      : JUNK_DOWNGRADE_NOTE;
  }

  // An "unknown" figure cannot carry a number.
  const value = confidence === 'unknown' ? null : metric.value;
  // Conversely, a null value can only be unknown or a deliberate human override.
  if (value === null && confidence !== 'unknown' && confidence !== 'user_verified') {
    confidence = 'unknown';
  }

  return {
    ...metric,
    value,
    confidence,
    citations,
    // Prefer a clickable citation; otherwise keep whatever written attribution
    // exists so the reader can still see where the figure came from.
    source: citations[0]?.url ?? (proseSource.length > 0 ? proseSource : null),
    methodNote,
  };
}

/**
 * The automation-ingest gate. Use this — never `enforceMetricProvenance` — at
 * every point a metric enters the system from a MODEL.
 *
 * `enforceMetricProvenance` deliberately preserves `user_verified`, because on
 * the canonical path a human really did set it and a refresh must not erase it.
 * That same leniency is a hole on the way IN: a model that returns
 * `confidence: "user_verified"` is asserting a human sign-off that never
 * happened, and because `evidenceWeight` ranks `user_verified` above
 * `verified`, an unchallenged forgery would also WIN a value conflict in
 * `reconcileMetric` against a genuinely sourced observation.
 *
 * So automation may propose evidence, never authorship of a human decision. A
 * forged claim is demoted to `verified` — the strongest thing a model may aim
 * at — and then has to earn even that from a citation under the ordinary rules
 * below. The figure itself always survives; only the claim about it drops.
 */
export function enforceModelMetricProvenance(metric: CompanyMetric): CompanyMetric {
  if (isModelAssertable(metric.confidence) || metric.confidence === 'verified') {
    return enforceMetricProvenance(metric);
  }
  return enforceMetricProvenance({
    ...metric,
    confidence: 'verified',
    methodNote: metric.methodNote
      ? `${metric.methodNote} — ${HUMAN_ONLY_CONFIDENCE_NOTE}`
      : HUMAN_ONLY_CONFIDENCE_NOTE,
  });
}

/** Convenience for whole model-sourced rows at once. */
export function enforceModelMetricsProvenance(metrics: CompanyMetric[]): CompanyMetric[] {
  return metrics.map(enforceModelMetricProvenance);
}

function evidenceWeight(metric: CompanyMetric): number {
  const sourceWeight: Record<SourceCredibility, number> = {
    primary: 100,
    reputable_secondary: 90,
    industry: 70,
    user_generated: 20,
    unknown: 10,
  };
  const credibility = metric.citations[0]?.credibility ?? classifySource(metric.source ?? '', '');
  const confidenceWeight =
    metric.confidence === 'user_verified'
      ? 40
      : metric.confidence === 'verified'
        ? 30
        : metric.confidence === 'estimated'
          ? 20
          : 0;
  return (sourceWeight[credibility] ?? 0) + confidenceWeight;
}

/**
 * Merge a newly researched metric into the canonical row. Contradictory values
 * are never silently discarded: both observations are retained, while the most
 * credible observation becomes the canonical value used by existing cards/tabs.
 */
export function reconcileMetric(existing: CompanyMetric, incoming: CompanyMetric): CompanyMetric {
  const current = enforceMetricProvenance(existing);
  const next = enforceMetricProvenance(incoming);
  const humanLocked = current.confidence === 'user_verified' && next.confidence !== 'user_verified';
  const preferNext = !humanLocked && (next.confidence === 'user_verified' || evidenceWeight(next) > evidenceWeight(current));
  if (current.value === next.value || next.value === null) {
    const preferred = next.value !== null && preferNext ? next : current;
    return {
      ...preferred,
      conflicts: [...(current.conflicts ?? []), ...(next.conflicts ?? [])],
      revision: Math.max(current.revision ?? 0, next.revision ?? 0) + 1,
    };
  }
  const observations = [
    {
      value: current.value,
      confidence: current.confidence,
      source: current.source,
      capturedAt: current.capturedAt,
    },
    {
      value: next.value,
      confidence: next.confidence,
      source: next.source,
      capturedAt: next.capturedAt,
    },
  ];
  const preferredObservation = preferNext ? 1 : 0;
  const conflict: MetricConflict = {
    metricType: current.metricType,
    observations,
    detectedAt: new Date().toISOString(),
    preferredObservation,
  };
  const preferred = preferredObservation === 1 ? next : current;
  return {
    ...preferred,
    conflicts: [...(current.conflicts ?? []), ...(next.conflicts ?? []), conflict],
    revision: Math.max(current.revision ?? 0, next.revision ?? 0) + 1,
  };
}

/**
 * Reconcile metrics and keep one canonical row per company/type.
 *
 * Both sides use the CANONICAL path deliberately. This is a merge primitive:
 * `existing` is the stored snapshot, which legitimately holds human overrides,
 * and a future caller could just as well merge two stored snapshots. Applying
 * the model-ingest gate here would therefore strip real `user_verified` rows.
 * Model output is gated where it ENTERS the system (`metricRows`), so anything
 * reaching this function has already been through
 * `enforceModelMetricsProvenance`.
 */
export function reconcileMetrics(
  existing: CompanyMetric[],
  incoming: CompanyMetric[],
): CompanyMetric[] {
  const byType = new Map<string, CompanyMetric>();
  // Stored duplicates must pass the same conflict/human-lock rules, not a
  // last-row-wins Map constructor that silently discards an override.
  for (const metric of [...existing, ...incoming]) {
    const key = JSON.stringify([metric.companyId, metric.metricType]);
    const current = byType.get(key);
    byType.set(
      key,
      current ? reconcileMetric(current, metric) : enforceMetricProvenance(metric),
    );
  }
  return [...byType.values()];
}

/** Convenience for whole rows at once. */
export function enforceMetricsProvenance(metrics: CompanyMetric[]): CompanyMetric[] {
  return metrics.map(enforceMetricProvenance);
}
