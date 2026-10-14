import {
  CARD_TYPE_LABELS, CONFIDENCE_LABELS, TIER_LABELS, enforceMetricProvenance, currentMetricRevision,
  isSignalCardType, usableCitations, metricDefinitionLabel, classifyMarketProfile, PROFILE_CORE_SLOTS, MONEY_METRIC_TYPES,
  CARD_FACE_SIZE, faceFamilyOf,
  type CardWithCompany, type Company, type CompanyMetric, type MetricType, type Ownership,
} from '@mi/contracts';
import { quotedSupportHolds, reportedBandCitations, reportedSupportCitations } from '@mi/research';
import type { OvrBreakdown } from './rating';

const LABELS: Record<MetricType, string> = {
  arr: 'ARR', valuation: 'Valuation', market_cap: 'Market cap',
  market_share: 'Market share', users: 'Users', employees: 'Employees', aum: 'AUM',
  revenue: 'Revenue', funding_total: 'Total raised', last_round: 'Latest round', distribution: 'Distribution',
};
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function sentences(value: string | null | undefined): string[] {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  // Decimal prices, ratios and domain names are not sentence boundaries.
  return normalized.split(/(?<=[.!?])\s+(?=[A-Z“"‘'])/u)
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

const LEGAL_SUFFIX = /,?\s+(?:Inc\.?|Incorporated|Corp\.?|Corporation|Co\.,?\s*Ltd\.?|Co\.|Ltd\.?|Limited|LLC|L\.L\.C\.|PLC|plc|GmbH|AG|S\.?A\.?S?\.?|SE|N\.?V\.?|B\.?V\.?|AB|Oy|ASA|A\/S|S\.p\.A\.|Pty\.?\s*Ltd\.?|Pte\.?\s*Ltd\.?|K\.K\.)$/;

/** "SZ DJI Technology Co., Ltd. (DJI)" → "DJI"; "Skydio, Inc." → "Skydio".
 * Display only: the stored name stays the legal name research matched on. */
export function companyFrontName(name: string): string {
  let outer = name.trim();
  const paren = /^(.+?)\s*\(([^)]+)\)\s*$/.exec(outer);
  if (paren) {
    const inner = paren[2]!.trim();
    if (inner.length <= 20 && !LEGAL_SUFFIX.test(` ${inner}`) && !/[,/]/.test(inner)) return inner;
    outer = paren[1]!.trim();
  }
  for (let i = 0; i < 3 && LEGAL_SUFFIX.test(outer); i++) outer = outer.replace(LEGAL_SUFFIX, '').trim();
  return outer.length >= 2 ? outer : name;
}

/** The face label must name the figure actually shown, never the slot's default. */
function metricTypeLabel(metric: CompanyMetric): string | null {
  switch (metric.metricType) {
    case 'revenue': return 'Revenue';
    case 'funding_total': return 'Total raised';
    case 'last_round': return 'Latest round';
    case 'distribution': {
      const text = `${metric.passageSupport?.quote ?? ''} ${metric.reportedSupport?.support.text ?? ''} ${metric.methodNote ?? ''}`.toLowerCase();
      if (/\b(?:stockists?|retailers?|retail doors?|doors|stores|retail locations?|points of sale)\b/.test(text)) return 'Stockists';
      if (/\b(?:countries|country|markets)\b/.test(text)) return 'Countries';
      return 'Distribution';
    }
    default: return null;
  }
}

function profileLabel(key: string, metric: CompanyMetric | undefined): string {
  const typed = metric ? metricTypeLabel(metric) : null;
  if (typed) return typed;
  if (metric && metricDefinitionLabel(metric)) return metricDefinitionLabel(metric)!;
  if (key === 'employees') return 'Employees';
  if (key === 'aum') return 'AUM';
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
export function buildMetricViews(input: readonly CompanyMetric[], officialWebsite?: string | null, ownership?: Ownership | null) {
  const groups = new Map<string, CompanyMetric[]>();
  for (const metric of input) {
    const key = JSON.stringify([metric.companyId, metric.metricType]);
    const group = groups.get(key);
    if (group) group.push(metric);
    else groups.set(key, [metric]);
  }
  return [...groups.values()].map((rows) => {
    const revision = currentMetricRevision(rows, rows[0]!.companyId, rows[0]!.metricType)!;
    let original = revision.metric;
    if (revision.ambiguous) {
      original = { ...original, value: null, confidence: 'unknown',
        citations: revision.tied.flatMap(m => m.citations),
        methodNote: 'Conflicting stored figures have no unambiguous current revision. Confirm the figure before treating it as fact.' };
    }
    const legacy = sourceUrl(original.source);
    const citations = usableCitations([
      ...original.citations.filter((c) => sourceUrl(c.url)),
      ...(legacy ? [{ url: legacy, title: '' }] : []),
    ], officialWebsite);
    let metric = enforceMetricProvenance({ ...original, citations }, officialWebsite, ownership);
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
      note = 'Invalid stored value, so it is not displayed.';
    }
    return {
      metric, label: metricDefinitionLabel(metric) ?? LABELS[metric.metricType], display: displayValue(metric),
      confidence: CONFIDENCE_LABELS[metric.confidence], note, citations,
    };
  });
}

type MetricView = ReturnType<typeof buildMetricViews>[number];
type ProfileSlot = {
  key: string; label: string; display: string; confidence: string; citations: MetricView['citations'];
  metric?: CompanyMetric; note?: string | null;
};

/** Most useful first when two figures are equally well sourced. */
const FACE_IMPORTANCE: Record<'operating_company' | 'financial_firm', readonly MetricType[]> = {
  operating_company: ['arr', 'revenue', 'valuation', 'market_cap', 'employees', 'users', 'funding_total', 'last_round', 'distribution', 'aum', 'market_share'],
  financial_firm: ['aum', 'valuation', 'market_cap', 'arr', 'revenue', 'employees', 'funding_total', 'last_round', 'users', 'distribution', 'market_share'],
};
const FACE_KEY: Partial<Record<MetricType, string>> = { arr: 'revenue', revenue: 'revenue', valuation: 'company_value', market_cap: 'company_value', users: 'reach', employees: 'employees', aum: 'aum' };

/**
 * The card face: the four strongest SOURCED figures this company has, whatever
 * they are — human-checked, then verified, then source-reported estimates —
 * instead of four fixed families that leave "Unknown" holes while other good
 * figures sit unused. Every figure shown still carries its citation (the rows
 * arrive already projected through the repository's acceptance gates). When a
 * company has fewer than four sourced figures, the remaining places say so
 * plainly ("Not found yet"); a figure is never invented to fill a slot.
 */
function strongestFaceMetrics(metrics: readonly MetricView[], profile: readonly ProfileSlot[],
  marketProfile: 'operating_company' | 'financial_firm', company: CardWithCompany['company']): ProfileSlot[] {
  const importance = FACE_IMPORTANCE[marketProfile];
  const rank = (type: MetricType) => { const i = importance.indexOf(type); return i < 0 ? importance.length : i; };
  type Candidate = ProfileSlot & { strength: number; type: MetricType };
  const candidates: Candidate[] = [];
  for (const m of metrics) {
    const metric = m.metric;
    const type = metric.metricType;
    const key = FACE_KEY[type] ?? type;
    // A human-checked figure stands on its own; every other figure needs a source.
    if (metric.value != null && (m.citations.length > 0 || metric.confidence === 'user_verified')) {
      const strength = metric.confidence === 'user_verified' ? 0 : metric.confidence === 'verified' ? 1 : metric.confidence === 'estimated' ? 2 : -1;
      if (strength < 0) continue;
      // Estimates must re-check here: a grounded-answer sentence or a quote from
      // a fetched page. An estimate with neither stays off the face.
      if (strength === 2 && !(company && (
        (metric.reportedSupport != null && reportedSupportCitations(company.name, company.websiteUrl, metric).length > 0) ||
        quotedSupportHolds(company.name, metric)))) continue;
      const label = FACE_KEY[type] ? profileLabel(key, metric) : (metricTypeLabel(metric) ?? LABELS[type]);
      candidates.push({ ...m, key, label, type, strength, confidence: strength === 2 ? 'Source reported' : m.confidence });
    } else if (type === 'employees' && metric.value === null && metric.confidence === 'estimated' && metric.reportedBand && company &&
      reportedBandCitations(company.name, company.websiteUrl, metric).length > 0) {
      const range = metric.reportedBand;
      candidates.push({ ...m, key, label: 'Employees (range)', display: `${range.low}–${range.high}`, type, strength: 3, confidence: 'Source reported' });
    }
  }
  candidates.sort((a, b) => a.strength - b.strength || rank(a.type) - rank(b.type));
  const families = new Set<string>();
  const chosen: Candidate[] = [];
  for (const c of candidates) {
    const family = faceFamilyOf(c.type);
    if (families.has(family)) continue;
    families.add(family);
    chosen.push(c);
    if (chosen.length === CARD_FACE_SIZE) break;
  }
  // Stable reading order on the face: by importance, not by strength.
  chosen.sort((a, b) => rank(a.type) - rank(b.type));
  const face: ProfileSlot[] = chosen.map(({ strength: _s, type: _t, ...slot }) => slot);
  // Fewer than four sourced figures: name what is still missing, most useful first.
  // A slot is skipped when a figure it accepts is already on the face (a
  // "Total raised" figure never sits beside a "Total raised: Not found yet").
  const shownTypes = new Set(chosen.map((c) => c.type));
  const shownLabels = new Set(face.map((f) => f.label));
  const slotTypes = PROFILE_CORE_SLOTS[marketProfile];
  for (const [index, slot] of profile.entries()) {
    if (face.length >= CARD_FACE_SIZE) break;
    if (face.some((f) => f.key === slot.key) || shownLabels.has(slot.label)) continue;
    if ((slotTypes[index] ?? []).some((type) => shownTypes.has(type))) continue;
    shownLabels.add(slot.label);
    face.push(notFoundYet(slot.key, slot.label));
  }
  // Still short (a slot's figure is already shown under another name): name
  // the next most useful figure the face does not have, so a card always
  // reads as four places.
  for (const [type, label] of FACE_FALLBACK_SLOTS) {
    if (face.length >= CARD_FACE_SIZE) break;
    if (shownLabels.has(label) || [...shownTypes].some((t) => faceFamilyOf(t) === faceFamilyOf(type))) continue;
    if (face.some((f) => f.key === (FACE_KEY[type] ?? type))) continue;
    shownLabels.add(label);
    face.push(notFoundYet(FACE_KEY[type] ?? type, label));
  }
  return face;
}

const FACE_FALLBACK_SLOTS: ReadonlyArray<readonly [MetricType, string]> = [
  ['arr', 'Revenue / ARR'], ['valuation', 'Valuation'], ['employees', 'Employees'],
  ['funding_total', 'Total raised'], ['users', 'Users / customers'], ['last_round', 'Last round'],
];

function notFoundYet(key: string, label: string): ProfileSlot {
  return { key, label, display: 'Not found yet', confidence: 'Unknown', citations: [], metric: undefined,
    note: 'No source-backed figure has been found for this yet. It is never estimated without a source.' };
}

/** A single read-only boundary for deck and inspection. Never updates stored research. */
/** One plain-English trust line per face figure, shared by the reader and the dashboard. */
export function faceFigureStatus(item: Pick<ProfileSlot, 'metric' | 'confidence' | 'citations'>): string {
  const metric = item.metric;
  const citation = item.citations[0];
  return metric?.confidence === 'user_verified' ? 'Human checked' :
    item.confidence === 'Source reported' ? 'Source reported · not verified' :
      citation?.credibility === 'primary' ? 'Primary source' :
        citation?.credibility === 'reputable_secondary' ? 'Independent reporting' :
          citation?.credibility === 'industry' ? 'Industry source' :
            citation ? 'Source linked' : 'No source-backed figure';
}

export function buildCardView(data: CardWithCompany, rating: OvrBreakdown | null = null) {
  const signal = isSignalCardType(data.card.cardType) || !data.company;
  const metrics = buildMetricViews(signal ? [] : data.metrics, data.company?.websiteUrl, data.company?.ownership);
  const knownCount = metrics.filter((m) => m.metric.value != null).length;
  const sourcedCount = metrics.filter((m) => m.metric.value != null && m.citations.length > 0).length;
  // The four front slots come from the market profile: an operating company
  // keeps the original four; a financial firm swaps its reach slot for AUM so
  // the figure its market actually publishes has somewhere to land (spec-level
  // rule: fit the card to the market, never pressure the gates).
  const marketProfile = signal || !data.company
    ? 'operating_company'
    : classifyMarketProfile(data.company);
  const shown = new Set<MetricType>();
  const profileMetrics = signal
    ? []
    : PROFILE_CORE_SLOTS[marketProfile].map((slotTypes) => {
        const lead = slotTypes[0];
        const key = lead === 'arr' ? 'revenue'
          : lead === 'aum' ? 'aum'
            : lead === 'users' ? 'reach'
              : lead === 'employees' ? 'employees' : 'company_value';
        // Ordered alternatives; a metric row already shown in an earlier slot
        // (e.g. funding_total in slot 2) is never repeated in a later one.
        const types = [...slotTypes].filter((type) => !shown.has(type)) as MetricType[];
        const candidates = types.flatMap((type) => metrics.filter((m) => m.metric.metricType === type));
        const confirmed = candidates.find((m) => m.metric.value != null && (
          m.metric.confidence === 'user_verified' ||
          (m.metric.confidence === 'verified' && m.citations.length > 0)
        ));
        if (confirmed) {
          shown.add(confirmed.metric.metricType);
          return { ...confirmed, key, label: profileLabel(key, confirmed.metric) };
        }
        // The row was accepted by the full identity-aware gate when written;
        // this recheck validates everything that survives without the retained
        // answer text (subject, basis, units, citations). Re-running the claim
        // gates here would show every fragment-recovered figure as Unknown.
        const reported = candidates.find(m => m.metric.confidence === 'estimated' && data.company &&
          m.metric.reportedSupport != null &&
          reportedSupportCitations(data.company.name, data.company.websiteUrl, m.metric).length > 0);
        if (reported) {
          shown.add(reported.metric.metricType);
          return { ...reported, key, label: profileLabel(key, reported.metric), confidence: 'Source reported' };
        }
        // A stated headcount BAND ("51–100") is shown as a range, never a point:
        // the row's value stays null, confidence stays estimated, and the same
        // company-named-sentence + usable-citation gate that stored it re-runs.
        const band = data.company ? candidates.find(m => m.metric.metricType === 'employees' &&
          m.metric.value === null && m.metric.confidence === 'estimated' && m.metric.reportedBand != null &&
          reportedBandCitations(data.company!.name, data.company!.websiteUrl, m.metric).length > 0) : undefined;
        if (band) {
          const range = band.metric.reportedBand!;
          shown.add('employees');
          return { ...band, key, label: 'Employees (range)', display: `${range.low}–${range.high}`, confidence: 'Source reported' };
        }
        // A figure quoted word for word from a fetched page, re-checked here.
        const quoted = data.company ? candidates.find((m) => m.metric.value != null && quotedSupportHolds(data.company!.name, m.metric)) : undefined;
        if (quoted) {
          shown.add(quoted.metric.metricType);
          return { ...quoted, key, label: profileLabel(key, quoted.metric), confidence: 'Source reported' };
        }
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
  const faceMetrics = signal ? [] : strongestFaceMetrics(metrics, profileMetrics, marketProfile, data.company);
  const maturity = data.card.cardType === 'company' && !signal && data.card.tier != null &&
    profileMetrics.some((m) => m.metric?.value != null && m.citations.length > 0)
    ? { tier: data.card.tier, label: TIER_LABELS[data.card.tier] } : null;
  // Scoring (tiers, OVR) is parked: the face footer reports evidence, not a grade.
  // The footer counts what the face actually shows.
  const faceSourced = faceMetrics.filter((m) => (m.metric?.value != null || m.metric?.reportedBand != null) &&
    (m.citations.length > 0 || m.metric?.confidence === 'user_verified')).length;
  const position = signal ? 'Market signal' : data.card.cardType !== 'company' ? 'Entity profile' :
    faceMetrics.length ? `${faceSourced}/${faceMetrics.length} figures sourced` : 'Research pending';
  const viceCitations = data.viceClaims.flatMap((claim) => sourceUrl(claim.sourceUrl)
    ? [{ url: claim.sourceUrl, title: claim.sourceTitle || 'Source' }]
    : []);
  const citations = usableCitations([
    ...(data.card.citations ?? []).filter((c) => sourceUrl(c.url)),
    ...viceCitations,
    ...metrics.flatMap((m) => m.citations),
  ], signal ? null : data.company?.websiteUrl);
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
    frontTitle: signal ? frontTitle(title) : data.company?.name ? companyFrontName(data.company.name) : title,
    description,
    frontDescription: signal ? signalLines[0] ?? null : description,
    frontFinding: signal ? signalLines[1] ?? null : null,
    type: CARD_TYPE_LABELS[data.card.cardType], signal, maturity, rating, position, metrics,
    profileMetrics, faceMetrics, knownCount, sourcedCount,
    // A source count is evidence DEPTH, not retrieved-item volume: the same
    // receipt repeated across metrics is one source, not many. Distinct pages,
    // not distinct hosts — different pages on one domain are real evidence.
    sourceCount: new Set(citations.map((c) =>
      c.url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '').toLowerCase())).size,
    citations,
  };
}

/**
 * The card face for a company without needing its deck card: the same four
 * strongest sourced figures the collectible shows, so every surface that
 * mirrors "the card" (dashboard overview, reader) agrees however it was opened.
 */
export function companyFace(company: Company, metrics: readonly CompanyMetric[]): CardView['faceMetrics'] {
  const card = { id: `face_${company.id}`, deckId: '', companyId: company.id, cardType: 'company', title: company.name,
    tier: null, summary: null, keyPoints: [], citations: [] } as unknown as CardWithCompany['card'];
  return buildCardView({ card, company, metrics: [...metrics], viceClaims: [] }).faceMetrics;
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
  if (metric.metricType === 'distribution') {
    // Keep the source's "60+" qualifier only when the retained text states it.
    const text = `${metric.passageSupport?.quote ?? ''} ${metric.reportedSupport?.support.text ?? ''} ${metric.methodNote ?? ''}`;
    const plus = new RegExp(`(?<![0-9,.])${metric.value.toLocaleString('en-US')}\\s?\\+`).test(text);
    return plus ? `${number}+` : number;
  }
  return MONEY_METRIC_TYPES.includes(metric.metricType) ? `$${number}` :
    metric.metricType === 'market_share' ? `${metric.value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%` : number;
}
export type CardView = ReturnType<typeof buildCardView>;
