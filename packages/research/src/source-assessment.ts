/**
 * The Source check (PLAN-CRAAP 1): how current, relevant, authoritative, accurate
 * and independent the evidence behind one stored figure looks. Pure and
 * deterministic: the clock is passed in, nothing is read or written elsewhere.
 *
 * It never produces or changes a value (AGENTS.md Rule 9). It is computed on READ
 * (assess-facts.ts) and is never trusted from storage, shares or transport. Only the
 * `effect` it names may lower a label (verified -> estimated, value kept).
 */
import {
  isRedirectCitation, publisherFit, publisherTier, independenceKey, registryHost, readCurrency, figureAsOf, notAfterFromUrl,
  isWireHost, WIRE_DATELINE, horizonMonths, METRIC_TYPE_LABELS,
  type CompanyMetric, type FigureAssessment, type MetricType, type Ownership, type PeriodKind, type PublisherTier, type PurposeKind,
} from '@mi/contracts';

/** D5 (default ON): a verified figure resting only on sponsored or contributor content shows as estimated. */
export const DEMOTE_SPONSORED_VERIFIED: boolean = true;
/** D4 (default OFF): a verified figure resting only on an aggregator weak for that metric shows as estimated. */
export const DEMOTE_WEAK_AGGREGATOR_VERIFIED: boolean = false;

/** Marks a displayed copy that was outside the 366-day window and is shown as a dated estimate (company-facts.ts). */
export const AGED_OUT_NOTE_PREFIX = 'Outside the 366-day verified window: ';
export const isAgedOutRow = (metric: Pick<CompanyMetric, 'confidence' | 'methodNote'>): boolean =>
  metric.confidence === 'estimated' && (metric.methodNote ?? '').startsWith(AGED_OUT_NOTE_PREFIX);

export interface AssessContext {
  now: Date;
  companyWebsite?: string | null;
  ownership?: Pick<Ownership, 'status' | 'acquirer'> | null;
  /** Websites of roster rivals, for the competitor purpose. */
  rivalHosts?: readonly string[];
  /** Metric types a plausibility check flagged for this company (absent = not checked). */
  plausibilityFlagged?: ReadonlySet<MetricType> | null;
  /** The saved page's own publication date, when a reader recorded one (WP2: not recorded yet). */
  pageDate?: string | null;
}

/** Every statement text kept for the figure, used only to read wording (period, purpose, parent). */
export function supportTextOf(metric: Pick<CompanyMetric, 'passageSupport' | 'quotedSupport' | 'reportedSupport' | 'reportedBand'>): string {
  return [metric.passageSupport?.quote, metric.quotedSupport?.quote, metric.reportedSupport?.support.text, metric.reportedBand?.support.text]
    .filter((t): t is string => !!t).join(' ');
}

const DAY_MS = 86_400_000;

/** What period the figure covers, from the support wording and the stored period start. */
export function periodKind(metric: Pick<CompanyMetric, 'metricType' | 'passageSupport' | 'quotedSupport' | 'reportedSupport' | 'reportedBand'>): PeriodKind {
  const text = supportTextOf(metric);
  const definition = metric.passageSupport?.definition ?? metric.reportedSupport?.definition;
  if (/\bTTM\b|trailing (?:twelve|12)[- ]months?|last (?:twelve|12) months/i.test(text)) return 'ttm';
  if (metric.metricType === 'arr' || definition === 'arr' || /run[- ]rate|annuali[sz]ed|\bARR\b|annual recurring/i.test(text)) return 'run_rate';
  if (/\bQ[1-4]\b|\bquarter\b|three months ended/i.test(text)) return 'quarter';
  const support = metric.passageSupport ?? metric.reportedSupport;
  const start = support?.periodStart ? Date.parse(`${support.periodStart}T00:00:00Z`) : NaN;
  const end = support?.asOf ? Date.parse(`${support.asOf}T00:00:00Z`) : NaN;
  const span = (end - start) / DAY_MS;
  if (/fiscal year|full[- ]year|year ended|annual revenue|for (?:fy|the year)|\bFY ?\d{2,4}\b/i.test(text) || (span >= 350 && span <= 380)) return 'fiscal_year';
  if (metric.metricType === 'last_round') return 'event';
  if (metric.metricType === 'revenue') return 'unstated';
  return 'point_in_time';
}

const DEFINITION_WORDING: Partial<Record<MetricType, RegExp>> = {
  arr: /\bARR\b|recurring revenue|annualized|run[- ]rate|revenue/i,
  revenue: /revenue|sales/i,
  users: /users|customers|subscribers|members|downloads|accounts/i,
  employees: /employees|staff|headcount|people|workers/i,
  valuation: /valu(?:ed|ation)/i,
  market_cap: /market (?:cap|value)|capitali[sz]ation/i,
  market_share: /share|%|percent/i,
  aum: /assets under management|\bAUM\b|managed/i,
  funding_total: /raised|funding|capital/i,
  last_round: /series|seed|round|raised/i,
  distribution: /stores|locations|countries|distributors|retail|outlets|partners|markets/i,
};

const SPONSORED_PATH = /\/(?:brandvoice|sponsored|partner-content|paid-post|advertorial|paid-program)(?:\/|$)|brandvoice/i;
const SPONSORED_TEXT = /\b(?:sponsored content|paid post|partner content|brandvoice)\b/i;
/** A small explicit list only. */
const ADVOCACY_HOSTS = ['greenpeace.org', 'sierraclub.org', 'foe.org', '350.org', 'stopthemoneypipeline.com'];
const belongsTo = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

/** The URL the figure rests on, with a grounding redirect resolved through a bare-domain title. */
function effectiveUrl(url: string, title: string | null | undefined): string {
  if (isRedirectCitation(url)) return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test((title ?? '').trim()) ? `https://${title!.trim()}/` : url;
  return url;
}

function sourcesOf(metric: CompanyMetric): Array<{ url: string; title: string | null; text: string }> {
  const list: Array<{ url: string; title: string | null; text: string }> = [];
  const add = (url: string | null | undefined, title: string | null, text: string) => {
    if (url && !list.some((s) => s.url === url)) list.push({ url, title, text });
  };
  const own = metric.passageSupport ? { url: metric.passageSupport.sourceUrl, text: metric.passageSupport.quote }
    : metric.quotedSupport ? { url: metric.quotedSupport.sourceUrl, text: metric.quotedSupport.quote }
      : metric.reportedSupport ? { url: metric.reportedSupport.support.sources[0]?.url ?? '', text: metric.reportedSupport.support.text }
        : null;
  if (own?.url) add(own.url, metric.citations.find((c) => c.url === own.url)?.title ?? null, own.text);
  for (const c of metric.citations ?? []) add(c.url, c.title, c.url === own?.url ? own.text : '');
  add(metric.source, null, '');
  return list;
}

export type SupportKind = FigureAssessment['accuracy']['support'];

export function supportKindOf(metric: CompanyMetric): SupportKind {
  if (metric.confidence === 'user_verified') return 'human';
  if (metric.passageSupport) return 'original_passage';
  if (metric.quotedSupport) return 'page_quote';
  if (metric.reportedSupport) return metric.reportedSupport.provider === 'page-quote' || metric.citations.length ? 'page_confirmed' : 'search_attributed';
  if (metric.reportedBand) return 'search_attributed';
  if (!metric.citations?.length) return 'none';
  return metric.metricType === 'market_cap' ? 'computed' : 'search_attributed';
}

/** Lane rank for latest-wins: verified 3, page-backed estimate 2, search-attributed or band 1, else 0. */
export function laneRank(metric: CompanyMetric): number {
  if (metric.confidence === 'user_verified') return 4;
  const support = supportKindOf(metric);
  if (support === 'original_passage') return metric.confidence === 'verified' ? 3 : 2;
  if (support === 'page_quote' || support === 'computed' || support === 'page_confirmed') return 2;
  return support === 'search_attributed' ? 1 : 0;
}

function purposeOf(url: string, text: string, tier: PublisherTier, ctx: AssessContext): PurposeKind {
  const host = registryHost(url) ?? '';
  if (SPONSORED_PATH.test(url) || SPONSORED_TEXT.test(text)) return 'sponsored_or_contributor';
  if (host && (ctx.rivalHosts ?? []).some((rival) => belongsTo(host, rival))) return 'competitor';
  if (tier === 1) return 'regulatory_filing';
  const official = registryHost(ctx.companyWebsite);
  if (official && belongsTo(host, official)) return 'company_reported';
  if (isWireHost(host) || WIRE_DATELINE.test(text)) return 'press_release';
  if (ADVOCACY_HOSTS.some((d) => belongsTo(host, d))) return 'advocacy';
  if (tier === 5 && host) return /reddit|twitter|x\.com|facebook|instagram|tiktok|quora|stocktwits|github|wikipedia/.test(host) ? 'community' : 'unknown';
  if (tier === 4) return 'industry_data';
  if (tier === 3) return 'neutral_reporting';
  return 'unknown';
}

const SELF_INTERESTED: readonly MetricType[] = ['users', 'market_share', 'valuation', 'distribution'];

function purposePenalty(kind: PurposeKind, metricType: MetricType): number {
  if (kind === 'company_reported' || kind === 'press_release') return SELF_INTERESTED.includes(metricType) ? 15 : 5;
  if (kind === 'sponsored_or_contributor') return 30;
  if (kind === 'competitor') return 20;
  if (kind === 'advocacy') return 30;
  if (kind === 'unknown') return 10;
  return 0;
}

const reportedBy = (kind: PurposeKind): FigureAssessment['purpose']['reportedBy'] =>
  kind === 'regulatory_filing' ? 'regulator'
    : kind === 'company_reported' || kind === 'press_release' || kind === 'sponsored_or_contributor' ? 'company'
      : kind === 'neutral_reporting' || kind === 'industry_data' ? 'independent' : 'unknown';

const dateText = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const within2pct = (a: number | null, b: number | null): boolean =>
  a != null && b != null && Math.abs(a - b) <= 0.02 * Math.max(Math.abs(a), Math.abs(b));

/**
 * The assessment of one stored figure, or null when there is nothing to assess
 * (no value / unknown). A human's figure reads `human_checked` (callers attach it to
 * nothing: a human row is never altered).
 */
export function assessFigure(metric: CompanyMetric, ctx: AssessContext): FigureAssessment | null {
  if (metric.value == null || metric.confidence === 'unknown') return null;
  const assessedAt = ctx.now.toISOString();
  const label = METRIC_TYPE_LABELS[metric.metricType].toLowerCase();
  const sources = sourcesOf(metric);
  const primary = sources[0] ?? null;
  const primaryUrl = primary ? effectiveUrl(primary.url, primary.title) : '';
  const own = figureAsOf(metric);
  const urlBound = notAfterFromUrl(primaryUrl);
  const pageBound = ctx.pageDate ?? null;
  const notAfter = [pageBound, urlBound].filter((d): d is string => !!d).sort()[0] ?? null;
  const notAfterSource = notAfter == null ? null : notAfter === pageBound ? 'page' : 'url';
  const currency = readCurrency({ metricType: metric.metricType, asOf: own.asOf, asOfSource: own.source, notAfter, notAfterSource, now: ctx.now });

  const text = supportTextOf(metric);
  const secFormat = metric.passageSupport?.format != null;
  const tier: PublisherTier | null = !primary ? null : secFormat ? 1 : publisherTier(primaryUrl, ctx.companyWebsite);
  const support = supportKindOf(metric);
  const level = tier == null ? null : support === 'computed' && metric.metricType === 'market_cap' ? 'strong' : publisherFit(tier, metric.metricType);
  const publisher = metric.citations?.[0]?.title?.trim() && !isRedirectCitation(metric.citations[0]!.url) ? metric.citations[0]!.title.trim()
    : registryHost(primaryUrl) ?? null;

  const issues = [...currency.issues];
  const period = periodKind(metric);
  if ((metric.metricType === 'revenue' || metric.metricType === 'arr') && period === 'unstated') issues.push('period_unstated');
  let definition: string | null = metric.passageSupport?.definition ?? metric.reportedSupport?.definition ?? null;
  if (!definition && metric.quotedSupport) {
    if (DEFINITION_WORDING[metric.metricType]?.test(metric.quotedSupport.quote)) definition = metric.metricType;
    else issues.push('definition_unstated');
  }
  if (!definition && !metric.quotedSupport && support !== 'none') definition = metric.metricType;
  const acquirer = ctx.ownership?.acquirer?.trim();
  if (ctx.ownership && ctx.ownership.status !== 'independent' && acquirer && acquirer.length > 2 &&
    text.toLowerCase().includes(acquirer.toLowerCase())) issues.push('entity_may_be_parent');
  if (metric.confidence === 'estimated' && /\b(?:division|segment|business unit)\b/i.test(text)) issues.push('entity_may_be_division');

  const kind = metric.confidence === 'user_verified' ? 'unknown' as PurposeKind : purposeOf(primaryUrl, `${text} ${primary?.text ?? ''}`, tier ?? 5, ctx);
  const keys = new Set(sources.map((s) => independenceKey(effectiveUrl(s.url, s.title), s.text || null, ctx.companyWebsite)));
  const contested = (metric.conflicts ?? []).some((c) => c.metricType === metric.metricType &&
    c.observations.some((o, i) => c.observations.slice(i + 1).some((p) => o.value != null && p.value != null && !within2pct(o.value, p.value))));
  const independentSources = keys.size;
  const corroboration: FigureAssessment['accuracy']['corroboration'] = contested ? 'contested'
    : !sources.length ? 'none' : independentSources >= 2 ? 'corroborated' : 'single';
  const plausibility = ctx.plausibilityFlagged == null ? 'unchecked' : ctx.plausibilityFlagged.has(metric.metricType) ? 'flagged' : 'ok';
  const newer = metric.newerObservation ?? null;

  const human = metric.confidence === 'user_verified';
  let score: number | null = null;
  if (!human) {
    score = 100;
    score -= currency.state === 'aging' ? 10 : currency.state === 'undated' ? 25 : currency.state === 'stale' ? 35 : 0;
    score -= level === 'acceptable' ? 10 : level === 'weak' || level == null ? 30 : 0;
    score -= { human: 0, original_passage: 0, page_quote: 5, computed: 5, page_confirmed: 10, search_attributed: 20, none: 40 }[support];
    score += corroboration === 'corroborated' ? 5 : corroboration === 'contested' ? -20 : 0;
    score -= plausibility === 'flagged' ? 25 : 0;
    score -= purposePenalty(kind, metric.metricType);
    score -= 10 * issues.length;
    score = Math.max(0, Math.min(100, score));
  }

  let effect: FigureAssessment['effect'] = 'none';
  if (!human) {
    if (isAgedOutRow(metric)) effect = 'shown_aged_out';
    else if (metric.confidence === 'verified' && currency.state === 'stale') effect = 'demoted_stale';
    else if (metric.confidence === 'verified' && ((DEMOTE_SPONSORED_VERIFIED && kind === 'sponsored_or_contributor') ||
      (DEMOTE_WEAK_AGGREGATOR_VERIFIED && tier === 4 && level === 'weak'))) effect = 'demoted_authority';
    else if (metric.confidence === 'estimated' && currency.state === 'stale') effect = 'labelled_stale';
  }
  const verdict: FigureAssessment['verdict'] = human ? 'human_checked' : score! >= 75 ? 'strong' : score! >= 50 ? 'fair' : 'weak';

  const when = currency.asOf
    ? `Dated ${dateText(currency.asOf)}${currency.state === 'stale' ? `, out of date for ${label}` : currency.state === 'aging' ? ', ageing' : ', current'}`
    : currency.state === 'stale' ? `At least ${Math.round((currency.ageDays ?? 0) / 30.4375)} months old, no stated date` : 'No stated date';
  const how = support === 'original_passage' || support === 'page_quote' ? 'sentence found on the saved page'
    : support === 'search_attributed' ? 'found through search, page not read' : support === 'human' ? 'checked by a person' : null;
  const summary = [when, publisher ? `from ${publisher}` : null, how, newer ? 'a newer, weaker figure exists' : null]
    .filter(Boolean).join('; ').slice(0, 240);

  return {
    version: 1, assessedAt,
    currency: {
      asOf: currency.asOf, asOfSource: currency.asOfSource, notAfter: currency.notAfter, notAfterSource: currency.notAfterSource,
      ageDays: currency.ageDays, state: currency.state, freshDays: currency.freshDays, staleDays: currency.staleDays,
    },
    relevance: { definition, period, issues: issues.slice(0, 8) },
    authority: { tier, publisher, level },
    accuracy: { support, independentSources, corroboration, plausibility,
      newerObservation: newer ? { value: newer.value, asOf: newer.asOf, publisher: newer.publisher } : null },
    purpose: { kind, reportedBy: reportedBy(kind) },
    score, verdict, effect, summary,
  };
}

/** "As of 31 Dec 2025 - older than the 18-month window for employees." */
export function staleNote(assessment: FigureAssessment, metricType: MetricType): string {
  const when = assessment.currency.asOf ? `As of ${dateText(assessment.currency.asOf)}` : 'Undated';
  return `${when} - older than the ${horizonMonths(assessment.currency.staleDays)}-month window for ${METRIC_TYPE_LABELS[metricType].toLowerCase()}.`;
}