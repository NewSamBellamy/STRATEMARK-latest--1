import {
  CARD_TYPE_LABELS, CONFIDENCE_LABELS, TIER_LABELS, enforceMetricProvenance,
  isSignalCardType, usableCitations, type CardWithCompany, type CompanyMetric, type MetricType,
} from '@mi/contracts';

const LABELS: Record<MetricType, string> = {
  arr: 'ARR', valuation: 'Valuation', market_cap: 'Market cap',
  market_share: 'Market share', users: 'Users', employees: 'Employees',
};
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function sentences(value: string | null | undefined): string[] {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  return (normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [normalized])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function uniqueLines(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return values.flatMap(sentences).filter((line) => {
    const key = line.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function frontTitle(value: string): string {
  if (value.length <= 64) return value;
  const withoutParenthetical = value.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (withoutParenthetical.length > 0 && withoutParenthetical.length <= 64) return withoutParenthetical;
  const firstClause = withoutParenthetical.split(/\s+(?:—|–|vs\.)\s+|:\s+/i)[0]?.trim();
  return firstClause && firstClause.length >= 16 && firstClause.length <= 64 ? firstClause : value;
}

function profileLabel(key: string, metric: CompanyMetric | undefined): string {
  if (key === 'employees') return 'Employees';
  if (key === 'revenue') {
    const note = metric?.methodNote?.toLowerCase() ?? '';
    if (/\brun[- ]?rate\b/.test(note)) return 'Revenue run-rate';
    if (/\bannual revenue\b/.test(note)) return 'Annual revenue';
    if (/\barr\b|recurring revenue/.test(note)) return 'ARR';
    return 'Revenue / ARR';
  }
  if (key === 'reach') {
    const note = metric?.methodNote?.toLowerCase() ?? '';
    if (/\bgit\s?hub stars?\b/.test(note)) return 'GitHub stars';
    if (/\b(downloads?|installs?)\b/.test(note)) return 'Installs / downloads';
    if (/\bfollowers?\b/.test(note)) return 'Followers';
    if (/\bcustomers?\b/.test(note) && !/\busers?\b/.test(note)) return 'Customers';
    if (/\b(active|monthly|daily) users?\b/.test(note)) return 'Active users';
    if (/\busers?\b/.test(note) && !/\bcustomers?\b/.test(note)) return 'Users';
    return 'Users / customers';
  }
  if (key === 'company_value') {
    if (metric?.metricType === 'market_cap') return 'Market cap';
    if (metric?.metricType === 'valuation') return 'Valuation';
    return 'Valuation / market cap';
  }
  return key;
}

/** Shared read-only evidence projection for cards, readers and quantitative dashboards. */
export function buildMetricViews(input: readonly CompanyMetric[]) {
  const groups = new Map<string, CompanyMetric[]>();
  for (const metric of input) {
    const key = JSON.stringify([metric.companyId, metric.metricType]);
    const group = groups.get(key);
    if (group) group.push(metric);
    else groups.set(key, [metric]);
  }
  return [...groups.values()].map((rows) => {
    // Recording/attempt time orders stored revisions, not the age or truth of
    // the source. Never resurrect an older badge after a newer failed check.
    const human = rows.filter(m => m.confidence === 'user_verified');
    const candidates = human.length ? human : rows;
    const activity = (m: CompanyMetric) => Math.max(0, ...[
      m.capturedAt, m.lastVerificationAttemptAt, m.lastVerifiedAt,
    ].map(date => Date.parse(date ?? '')).filter(Number.isFinite));
    const newest = Math.max(...candidates.map(activity));
    const current = candidates.filter(m => activity(m) === newest).sort((a, b) => a.id.localeCompare(b.id));
    let original = current[0]!;
    if (current.some(m => !Object.is(m.value, original.value) || m.confidence !== original.confidence)) {
      original = { ...original, value: null, confidence: 'unknown',
        citations: current.flatMap(m => m.citations),
        methodNote: 'Conflicting stored figures have no unambiguous current revision. Confirm the figure before treating it as fact.' };
    }
    const legacy = sourceUrl(original.source);
    const citations = usableCitations([
      ...original.citations.filter((c) => sourceUrl(c.url)),
      ...(legacy ? [{ url: legacy, title: '' }] : []),
    ]);
    let metric = enforceMetricProvenance({ ...original, citations });
    let note = metric.methodNote;
    if (metric.metricType === 'users' && metric.value === 0 && metric.confidence !== 'user_verified') {
      metric = { ...metric, value: null, confidence: 'unknown' };
      note = 'A zero user count was not explicitly established by its source. Shown as unknown until confirmed.';
    }
    if (metric.confidence === 'verified' && citations.length === 0) {
      metric = { ...metric, confidence: 'estimated' };
      note = 'No clickable source was recorded. Treat this figure as an estimate until checked.';
    }
    if (metric.value != null && (!Number.isFinite(metric.value) || metric.value < 0 ||
      (metric.metricType === 'market_share' && metric.value > 100))) {
      metric = { ...metric, value: null, confidence: 'unknown' };
      note = 'Invalid stored value. Not displayed or used in this card’s maturity breakdown.';
    }
    return {
      metric, label: LABELS[metric.metricType], display: displayValue(metric),
      confidence: CONFIDENCE_LABELS[metric.confidence], note, citations,
    };
  });
}

/** A single read-only boundary for deck and inspection. Never updates stored research. */
export function buildCardView(data: CardWithCompany) {
  const signal = isSignalCardType(data.card.cardType) || !data.company;
  const metrics = buildMetricViews(signal ? [] : data.metrics);
  const knownCount = metrics.filter((m) => m.metric.value != null).length;
  const sourcedCount = metrics.filter((m) => m.metric.value != null && m.citations.length > 0).length;
  const profileMetrics = signal
    ? []
    : [
        { key: 'employees', types: ['employees'] as MetricType[] },
        { key: 'revenue', types: ['arr'] as MetricType[] },
        { key: 'reach', types: ['users'] as MetricType[] },
        { key: 'company_value', types: ['valuation', 'market_cap'] as MetricType[] },
      ].map(({ key, types }) => {
        const candidates = types.flatMap((type) => metrics.filter((m) => m.metric.metricType === type));
        const confirmed = candidates.find((m) => m.metric.value != null && (
          m.metric.confidence === 'user_verified' ||
          (m.metric.confidence === 'verified' && m.citations.length > 0)
        ));
        if (confirmed) return { ...confirmed, key, label: profileLabel(key, confirmed.metric) };
        const estimate = candidates.find((m) => m.metric.value != null);
        if (estimate) {
          return {
            ...estimate,
            key,
            label: profileLabel(key, estimate.metric),
            display: 'Unknown',
            confidence: 'Unknown',
            note: 'An estimate exists in research, but no confirmed company figure is available.',
            citations: [],
            metric: undefined,
          };
        }
        const unknown = candidates[0];
        if (unknown) {
          return {
            ...unknown,
            key,
            label: profileLabel(key, unknown.metric),
            display: 'Unknown',
            confidence: 'Unknown',
            metric: undefined,
          };
        }
        return {
          key,
          label: profileLabel(key, undefined),
          display: 'Unknown',
          confidence: 'Unknown',
          note: 'No reliable figure is recorded yet.',
          citations: [],
          metric: undefined,
        };
      });
  const maturity = data.card.cardType === 'company' && !signal && data.card.tier != null &&
    profileMetrics.some((m) => m.metric?.value != null && m.citations.length > 0)
    ? { tier: data.card.tier, label: TIER_LABELS[data.card.tier] } : null;
  const position = signal ? 'Market signal' : data.card.cardType !== 'company' ? 'Entity profile' : !maturity ? 'Stage pending' :
    sourcedCount >= 2 ? `Maturity · T${maturity.tier}` : `Indicative · T${maturity.tier}`;
  const viceCitations = data.viceClaims.flatMap((claim) => sourceUrl(claim.sourceUrl)
    ? [{ url: claim.sourceUrl, title: claim.sourceTitle || 'Source' }]
    : []);
  const citations = usableCitations([
    ...(data.card.citations ?? []).filter((c) => sourceUrl(c.url)),
    ...viceCitations,
    ...metrics.flatMap((m) => m.citations),
  ]);
  const signalLines = signal ? uniqueLines([
    data.card.summary,
    ...data.viceClaims.map((claim) => claim.claimText),
    ...data.card.keyPoints,
  ]) : [];
  const description = signal
    ? data.card.summary ?? data.viceClaims[0]?.claimText ?? data.card.keyPoints[0] ?? null
    : data.company?.oneLiner;
  const title = data.company?.name ?? data.card.title ?? 'Research card';
  return {
    title,
    frontTitle: signal ? frontTitle(title) : title,
    description,
    frontDescription: signal ? signalLines[0] ?? null : description,
    frontFinding: signal ? signalLines[1] ?? null : null,
    type: CARD_TYPE_LABELS[data.card.cardType], signal, maturity, position, metrics,
    profileMetrics, knownCount, sourcedCount, sourceCount: citations.length, citations,
  };
}

export function sourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function displayValue(metric: CompanyMetric): string {
  if (metric.value == null || metric.confidence === 'unknown') return 'Unknown';
  const number = compact.format(metric.value);
  return ['arr', 'valuation', 'market_cap'].includes(metric.metricType) ? `$${number}` :
    metric.metricType === 'market_share' ? `${metric.value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%` : number;
}
export type CardView = ReturnType<typeof buildCardView>;
