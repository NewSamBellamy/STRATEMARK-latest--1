import {
  CARD_TYPE_LABELS,
  CONFIDENCE_LABELS,
  TIER_LABELS,
  enforceMetricProvenance,
  isSignalCardType,
  metricDisplayLabel,
  usableCitations,
  type CardWithCompany,
  type CompanyMetric,
  type MetricType,
} from '@mi/contracts';
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const facePriority: MetricType[] = ['arr', 'market_cap', 'valuation', 'users', 'employees'];

export const metricLabel = metricDisplayLabel;

/** A single read-only boundary for deck and inspection. Never updates stored research. */
export function buildCardView(data: CardWithCompany) {
  const signal = isSignalCardType(data.card.cardType) || !data.company;
  const metrics = (signal ? [] : data.metrics).map((original) => {
    const legacy = sourceUrl(original.source);
    const citations = usableCitations([
      ...original.citations.filter((c) => sourceUrl(c.url)),
      ...(legacy ? [{ url: legacy, title: '' }] : []),
    ]);
    let metric = enforceMetricProvenance({ ...original, citations });
    let note = metric.methodNote;
    if (metric.confidence === 'verified' && citations.length === 0) {
      metric = { ...metric, confidence: 'estimated' };
      note = 'No clickable source was recorded. Treat this figure as an estimate until checked.';
    }
    if (
      metric.value != null &&
      (!Number.isFinite(metric.value) ||
        metric.value < 0 ||
        (metric.metricType === 'market_share' && metric.value > 100))
    ) {
      metric = { ...metric, value: null, confidence: 'unknown' };
      note = 'Invalid stored value. Not displayed or used in this card’s scale-band calculation.';
    }
    return {
      metric,
      label: metricLabel(metric),
      display: displayValue(metric),
      confidence: CONFIDENCE_LABELS[metric.confidence],
      note,
      citations,
    };
  });
  const knownCount = metrics.filter((m) => m.metric.value != null).length;
  const sourcedCount = metrics.filter(
    (m) => m.metric.value != null && m.citations.length > 0,
  ).length;
  const stageMetrics = metrics.filter(
    (m) =>
      m.metric.value != null &&
      m.metric.confidence !== 'unknown' &&
      m.metric.metricType !== 'market_share',
  );
  const metricFamily = (metricType: MetricType) =>
    ['valuation', 'market_cap'].includes(metricType) ? 'company_value' : metricType;
  const stageFamilies = new Set(stageMetrics.map((m) => metricFamily(m.metric.metricType)));
  const sourcedStageFamilies = new Set(
    stageMetrics
      .filter((m) => m.citations.length > 0)
      .map((m) => metricFamily(m.metric.metricType)),
  );
  const latestCapturedAt = metrics.reduce<number | null>((latest, entry) => {
    const captured = new Date(entry.metric.capturedAt).getTime();
    return Number.isFinite(captured) && (latest == null || captured > latest) ? captured : latest;
  }, null);
  // Face space goes to the strongest usable facts, not a fixed ARR/valuation template.
  // Market share stays in Evidence until the research records its market scope.
  const ranked = signal
    ? []
    : metrics
        .filter((m) => m.metric.value != null && facePriority.includes(m.metric.metricType))
        .sort((a, b) => {
          const strength = (m: typeof a) =>
            (m.metric.confidence === 'user_verified'
              ? 6
              : m.metric.confidence === 'verified'
                ? 4
                : 2) + (m.citations.length > 0 ? 1 : 0);
          return (
            strength(b) - strength(a) ||
            facePriority.indexOf(a.metric.metricType) - facePriority.indexOf(b.metric.metricType)
          );
        });
  const seen = new Set<string>();
  const faceMetrics = ranked
    .filter((m) => {
      const family = ['valuation', 'market_cap'].includes(m.metric.metricType)
        ? 'company_value'
        : m.metric.metricType;
      if (seen.has(family)) return false;
      seen.add(family);
      return true;
    })
    .slice(0, 2);
  const maturity =
    data.card.cardType === 'company' &&
    !signal &&
    data.card.tier != null &&
    stageFamilies.size >= 2 &&
    sourcedStageFamilies.size >= 1
      ? { tier: data.card.tier, label: TIER_LABELS[data.card.tier] }
      : null;
  const position = signal
    ? 'Market signal'
    : data.card.cardType !== 'company'
      ? 'Entity profile'
      : !maturity
        ? 'Scale unverified'
        : `T${maturity.tier} · ${maturity.label}`;
  return {
    title: data.company?.name ?? data.card.title ?? 'Research card',
    description: signal ? data.card.summary : data.company?.oneLiner,
    type: CARD_TYPE_LABELS[data.card.cardType],
    signal,
    maturity,
    position,
    metrics,
    faceMetrics,
    knownCount,
    sourcedCount,
    latestCapturedAt,
    citations: usableCitations([
      ...(data.card.citations ?? []).filter((c) => sourceUrl(c.url)),
      ...metrics.flatMap((m) => m.citations),
      ...data.viceClaims.map((claim) => ({
        url: claim.sourceUrl,
        title: claim.sourceTitle ?? '',
      })),
    ]),
  };
}

/** Order browsing by evidenced size-signal band, then sourced figure count—not business quality. */
export function sortCompanyCardsForBrowse(cards: CardWithCompany[]): CardWithCompany[] {
  return [...cards].sort((a, b) => {
    const aView = buildCardView(a);
    const bView = buildCardView(b);
    return (
      (bView.maturity?.tier ?? 0) - (aView.maturity?.tier ?? 0) ||
      bView.sourcedCount - aView.sourcedCount ||
      aView.title.localeCompare(bView.title)
    );
  });
}

export function sourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function displayValue(metric: CompanyMetric): string {
  if (metric.value == null || metric.confidence === 'unknown') return 'Unknown';
  const number = compact.format(metric.value);
  return ['arr', 'valuation', 'market_cap'].includes(metric.metricType)
    ? `$${number}`
    : metric.metricType === 'market_share'
      ? `${metric.value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
      : number;
}
export type CardView = ReturnType<typeof buildCardView>;
