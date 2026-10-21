/**
 * CRAAP source and figure assessment (currency, relevance, authority,
 * accuracy, purpose): a deterministic, pure read of how fresh, how
 * authoritative and how independent the sources behind one figure are.
 *
 * No model calls, no network, no clock of its own (`now` is always passed in).
 * It never produces a figure, only a judgement about the evidence for one
 * (AGENTS.md Rule 9): a source with no usable date is `undated` and never
 * counts as current, and `capturedAt` (when WE found it) never proves a fact is
 * current. Source classification reuses `classifySource` / `isJunkSource` from
 * @mi/contracts; the table below only adds the tiers that function cannot say
 * (aggregator, reference, press wire, filing hosts, weak content hosts).
 *
 * Not wired into any stored snapshot yet (see `sourceAssessmentSchema`).
 */
import {
  classifySource,
  isJunkSource,
  isRedirectCitation,
  type AssessmentGrade,
  type Confidence,
  type CurrencyStatus,
  type SourceAssessment,
  type SourceAuthorityTier,
  type SourcePurpose,
} from '@mi/contracts';
import { hostOf, registrableDomain, sameRegistrableDomain } from './registries/shared';

// Currency -------------------------------------------------------------------

/** Months a figure of this kind stays trustworthy; beyond it the figure is stale. */
export const CURRENCY_HORIZON_MONTHS: Readonly<Record<string, number>> = {
  headcount: 18, employees: 18,
  valuation: 12,
  revenue: 15, arr: 15,
  funding: 24, funding_total: 24, last_round: 24,
  leadership: 18,
  products: 12,
  news: 3,
};
export const DEFAULT_HORIZON_MONTHS = 12;
/** A source is "aging" once it reaches this share of the horizon. */
export const AGING_FROM_SHARE = 0.7;

export function horizonMonthsFor(metricType: string): number {
  return Object.prototype.hasOwnProperty.call(CURRENCY_HORIZON_MONTHS, metricType)
    ? CURRENCY_HORIZON_MONTHS[metricType]!
    : DEFAULT_HORIZON_MONTHS;
}

export type CurrencyAssessment = SourceAssessment['currency'];
export type ClockInput = Date | string | number;

export interface CurrencyInput {
  metricType: string;
  /** When the source was published. */
  publishedDate?: string | null;
  /** The period the figure describes ("2025-12", "Q1 2026", "FY2025"). Wins over publishedDate. */
  asOf?: string | null;
  /** When WE found it. Accepted so callers can pass a whole record, but it never proves currency. */
  capturedAt?: string | null;
  now: ClockInput;
}

interface ParsedDate { date: Date; iso: string }

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAY_MS = 86_400_000;
const MONTH_DAYS = 30.4375;

function monthNumber(word: string): number | null {
  const w = word.toLowerCase();
  if (w.length < 3) return null;
  const idx = MONTHS.findIndex((m) => m.startsWith(w));
  return idx === -1 ? null : idx + 1;
}

function makeDate(year: number, month: number, day: number | null): ParsedDate | null {
  if (year < 1900 || year > 2200 || month < 1 || month > 12) return null;
  const d = day ?? 1;
  const date = new Date(Date.UTC(year, month - 1, d));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== d) return null;
  return { date, iso: day != null ? `${year}-${pad(month)}-${pad(day)}` : `${year}-${pad(month)}` };
}
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Read a stated date. Only unambiguous shapes are accepted (never Date.parse's
 * lenient guesses). A date stated to the year or month is taken at the START of
 * that period, so currency is never overstated.
 */
export function parseStatedDate(raw: string | null | undefined): ParsedDate | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let m = /^(?:FY\s?)?(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/i.exec(s);
  if (m) {
    const year = Number(m[1]);
    if (m[2] == null) {
      const y = makeDate(year, 1, null);
      return y && { date: y.date, iso: String(year) };
    }
    return makeDate(year, Number(m[2]), m[3] != null ? Number(m[3]) : null);
  }
  m = /^Q([1-4])\s*(?:FY\s?)?(\d{4})$/i.exec(s) ?? /^(\d{4})\s*Q([1-4])$/i.exec(s);
  if (m) {
    const [q, y] = /^Q/i.test(s) ? [m[1]!, m[2]!] : [m[2]!, m[1]!];
    return makeDate(Number(y), (Number(q) - 1) * 3 + 1, null);
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(s);
  if (m) { const mo = monthNumber(m[1]!); return mo ? makeDate(Number(m[2]), mo, null) : null; }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);
  if (m) { const mo = monthNumber(m[1]!); return mo ? makeDate(Number(m[3]), mo, Number(m[2])) : null; }
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s);
  if (m) { const mo = monthNumber(m[2]!); return mo ? makeDate(Number(m[3]), mo, Number(m[1])) : null; }
  return null;
}

function toDate(now: ClockInput): Date {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) throw new RangeError('source-assessment: `now` is not a valid time');
  return d;
}

function addMonthsUTC(from: Date, months: number): Date {
  const first = Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1);
  const target = new Date(first);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(from.getUTCDate(), lastDay)));
}

/** Calendar months from `from` to `to`, with a day fraction. Null when `from` is implausibly in the future. */
function monthsBetween(from: Date, to: Date): number | null {
  if (from.getTime() > to.getTime()) return (from.getTime() - to.getTime()) / DAY_MS > 31 ? null : 0;
  let whole = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  let anchor = addMonthsUTC(from, whole);
  if (anchor.getTime() > to.getTime()) { whole -= 1; anchor = addMonthsUTC(from, whole); }
  const fraction = Math.min((to.getTime() - anchor.getTime()) / DAY_MS / MONTH_DAYS, 0.999);
  return whole + fraction;
}

/** How current is this figure or source? An undated one is never `current`. */
export function assessCurrency(input: CurrencyInput): CurrencyAssessment {
  // Stated dates carry no time of day, so compare whole days: "12 months ago today" is not past a 12-month horizon.
  const clock = toDate(input.now);
  const now = new Date(Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate()));
  const horizonMonths = horizonMonthsFor(input.metricType);
  const candidates: Array<['asOf' | 'publishedDate', string | null | undefined]> = [
    ['asOf', input.asOf], ['publishedDate', input.publishedDate],
  ];
  for (const [basis, raw] of candidates) {
    const parsed = parseStatedDate(raw);
    const age = parsed ? monthsBetween(parsed.date, now) : null;
    if (!parsed || age == null) continue;
    const status: CurrencyStatus = age > horizonMonths ? 'stale' : age >= horizonMonths * AGING_FROM_SHARE ? 'aging' : 'current';
    return { status, ageMonths: Math.round(age * 10) / 10, horizonMonths, basis, date: parsed.iso };
  }
  // capturedAt is deliberately not consulted: it says when we looked, not when the fact was true.
  return { status: 'undated', ageMonths: null, horizonMonths, basis: 'none', date: null };
}

// Authority ------------------------------------------------------------------

export type AuthorityAssessment = SourceAssessment['authority'] & { domain: string | null };

interface AuthorityEntry {
  tier: SourceAuthorityTier;
  label: string;
  domains: string[];
  /** Pages here are regulatory filings or court records. */
  filing?: boolean;
  /** A press-release wire: the text is issued by the company, not written by the outlet. */
  wire?: boolean;
  /** A campaigning organisation. */
  advocacy?: boolean;
}

/** All host classification data lives here. Matched by domain suffix; the longest match wins. */
const AUTHORITY_TABLE: readonly AuthorityEntry[] = [
  { tier: 'primary', label: 'SEC filing', filing: true, domains: ['sec.gov'] },
  { tier: 'primary', label: 'Court record', filing: true, domains: ['uscourts.gov', 'courtlistener.com', 'supremecourt.gov', 'pacer.gov'] },
  { tier: 'primary', label: 'Company registry filing', filing: true, domains: ['companieshouse.gov.uk', 'find-and-update.company-information.service.gov.uk', 'sedarplus.ca', 'hkexnews.hk'] },
  { tier: 'primary', label: 'Regulator record', filing: true, domains: ['irs.gov', 'europa.eu', 'fca.org.uk', 'ferc.gov', 'nerc.gov'] },
  { tier: 'strong', label: 'Press-release wire', wire: true, domains: ['prnewswire.com', 'businesswire.com', 'globenewswire.com', 'newswire.ca', 'accesswire.com'] },
  { tier: 'reference', label: 'Encyclopaedia or user-edited reference', domains: ['wikipedia.org', 'wikidata.org', 'wikimedia.org', 'britannica.com', 'fandom.com'] },
  {
    tier: 'aggregator', label: 'Data aggregator or directory',
    domains: [
      'crunchbase.com', 'pitchbook.com', 'cbinsights.com', 'tracxn.com', 'similarweb.com', 'sensortower.com', 'sacra.com',
      'stockanalysis.com', 'macrotrends.net', 'companiesmarketcap.com', 'investing.com', 'wisesheets.io', 'simplywall.st',
      'marketscreener.com', 'tradingview.com', 'finance.yahoo.com', 'statista.com', 'zoominfo.com', 'owler.com',
      'growjo.com', 'craft.co', 'rocketreach.co', 'dnb.com', 'glassdoor.com', 'linkedin.com', 'g2.com', 'capterra.com',
      'trustpilot.com', 'builtwith.com',
    ],
  },
  {
    tier: 'weak', label: 'Blog, social or user-content host',
    domains: [
      'reddit.com', 'x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'quora.com', 'stocktwits.com',
      'github.com', 'youtube.com', 'medium.com', 'substack.com', 'blogspot.com', 'wordpress.com', 'tumblr.com',
      'pinterest.com', 'einpresswire.com', 'openpr.com', 'prlog.org',
    ],
  },
  { tier: 'weak', label: 'Campaigning organisation', advocacy: true, domains: ['greenpeace.org', 'change.org', 'amnesty.org', '350.org'] },
];

const GOVERNMENT_HOST = /(^|\.)gov(\.[a-z]{2})?$/;

export const AUTHORITY_RANK: Readonly<Record<SourceAuthorityTier, number>> = { primary: 0, strong: 1, reference: 2, aggregator: 3, weak: 4 };
const TIER_LABEL: Record<SourceAuthorityTier, string> = {
  primary: 'primary source', strong: 'established publisher', reference: 'reference site', aggregator: 'data aggregator', weak: 'weak source',
};

interface HostClass {
  tier: SourceAuthorityTier;
  reason: string;
  domain: string | null;
  filing: boolean;
  wire: boolean;
  advocacy: boolean;
  company: boolean;
}

/** The host a citation is really from; a grounding redirect is only as good as the publisher recorded with it. */
function effectiveHost(url: string, publisher?: string | null): string | null {
  if (isRedirectCitation(url)) return hostOf(publisher);
  return hostOf(url);
}

function classifyHost(url: string, publisher: string | null | undefined, companyDomain: string | null | undefined): HostClass {
  const host = effectiveHost(url, publisher);
  const domain = registrableDomain(host);
  const base = { domain, filing: false, wire: false, advocacy: false, company: false };
  if (isJunkSource(url, publisher)) return { ...base, tier: 'weak', reason: 'Content-farm or SEO site' };
  if (host && companyDomain && sameRegistrableDomain(host, companyDomain)) {
    return { ...base, tier: 'primary', reason: "The company's own website", company: true };
  }
  if (host) {
    let best: { entry: AuthorityEntry; len: number } | null = null;
    for (const entry of AUTHORITY_TABLE) {
      for (const d of entry.domains) {
        if ((host === d || host.endsWith(`.${d}`)) && (!best || d.length > best.len)) best = { entry, len: d.length };
      }
    }
    if (best) {
      const { entry } = best;
      return { ...base, tier: entry.tier, reason: entry.label, filing: !!entry.filing, wire: !!entry.wire, advocacy: !!entry.advocacy };
    }
    if (GOVERNMENT_HOST.test(host)) return { ...base, tier: 'primary', reason: 'Government source' };
  }
  // Everything else: the shared classifier (named publishers behind grounding redirects included).
  const credibility = classifySource(url, publisher);
  switch (credibility) {
    case 'primary': return { ...base, tier: 'primary', reason: 'Regulator or exchange source' };
    case 'reputable_secondary': return { ...base, tier: 'strong', reason: 'Established newspaper or news wire' };
    case 'industry': return { ...base, tier: 'strong', reason: 'Trade press or research firm' };
    case 'user_generated': return { ...base, tier: 'weak', reason: 'User-generated content' };
    default:
      return { ...base, tier: 'weak', reason: isRedirectCitation(url) && !host ? 'Publisher not recorded' : 'Not a recognised publisher' };
  }
}

export interface AuthorityInput { url: string; publisher?: string | null; companyDomain?: string | null }

/** How authoritative is the publisher behind this URL? Table-driven, by domain. */
export function assessAuthority(input: AuthorityInput): AuthorityAssessment {
  const c = classifyHost(input.url, input.publisher, input.companyDomain);
  return { tier: c.tier, reason: c.reason, domain: c.domain };
}

// Purpose --------------------------------------------------------------------

export interface PurposeInput {
  url: string;
  title?: string | null;
  text?: string | null;
  publisher?: string | null;
  /** Needed to recognise the company's own site; without it a company page reads as an ordinary host. */
  companyDomain?: string | null;
}

const SPONSORED_PATTERN = /\b(sponsored|advertorial|paid[\s-](?:post|content|partnership)|partner[\s-]content|promoted[\s-]content)\b|brand-?voice/i;
const PRESS_PATH = /(^|\/)(press|press-releases?|pressroom|press-room|newsroom|media-center)(\/|$)/i;
const PRESS_TEXT = /\bpress[\s-]?releases?\b|for immediate release|\(business wire\)|\bpr newswire\b|\bglobe newswire\b/i;
const ANNOUNCES = /\bannounces?\b|\bannounced today\b/i;
const ADVOCACY_TEXT = /\b(advocacy|petition|lobbying|lobby group|call to action)\b/i;

export const INDEPENDENT_PURPOSES: readonly SourcePurpose[] = ['regulatory_filing', 'independent_reporting'];
export const COMPANY_ISSUED_PURPOSES: readonly SourcePurpose[] = ['company_press_release', 'company_site', 'sponsored'];
/** Only filings and independent reporting count as independent. */
export const isIndependentPurpose = (purpose: SourcePurpose): boolean => INDEPENDENT_PURPOSES.includes(purpose);

function pathOf(url: string): string {
  try { return new URL(url).pathname; } catch { return ''; }
}

/** What was this page for? From URL, title and the opening of the text. */
export function assessPurpose(input: PurposeInput): SourcePurpose {
  const c = classifyHost(input.url, input.publisher, input.companyDomain);
  const title = input.title ?? '';
  const head = (input.text ?? '').slice(0, 400);
  const path = pathOf(input.url);
  if (c.filing) return 'regulatory_filing';
  if (SPONSORED_PATTERN.test(`${path} ${title} ${head}`)) return 'sponsored';
  if (c.wire) return 'company_press_release';
  if (c.advocacy) return 'advocacy';
  // An established outlet's headline ("X announces layoffs", "advocates sue X") is reporting, not the company talking.
  const newsOutlet = c.tier === 'strong' && !c.company;
  if (!newsOutlet && (c.company || c.tier === 'weak')) {
    if (PRESS_PATH.test(path) || PRESS_TEXT.test(`${title} ${head}`) || ANNOUNCES.test(title)) return 'company_press_release';
    if (ADVOCACY_TEXT.test(`${path} ${title}`)) return 'advocacy';
  }
  if (c.company) return 'company_site';
  if (newsOutlet) return 'independent_reporting';
  return 'unknown';
}

// Accuracy hints: independent sources --------------------------------------------

export interface AssessableCitation {
  url: string;
  title?: string | null;
  /** The publisher's name when known (needed to read a grounding redirect). */
  publisher?: string | null;
  publishedDate?: string | null;
  asOf?: string | null;
  capturedAt?: string | null;
}

interface AssessedCitation {
  domainKey: string;
  titleKey: string | null;
  currency: CurrencyAssessment;
  authority: AuthorityAssessment;
  purpose: SourcePurpose;
}

function usableUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) return false;
  try {
    const u = new URL(url.trim());
    return !!u.hostname && !u.username && !u.password;
  } catch { return false; }
}

function normaliseTitle(title: string | null | undefined): string | null {
  const t = (title ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // A short or generic title ("Home", "Press") is no evidence two pages are the same story.
  return t.length >= 12 ? t : null;
}

function assessCitation(c: AssessableCitation, metricType: string, now: Date, companyDomain: string | null | undefined): AssessedCitation {
  const url = c.url.trim();
  const publisher = c.publisher ?? c.title ?? null;
  const authority = assessAuthority({ url, publisher, companyDomain });
  const redirect = isRedirectCitation(url);
  const name = redirect ? (publisher ?? '').trim().toLowerCase() : '';
  return {
    domainKey: authority.domain ?? (name ? `name:${name}` : `url:${url}`),
    titleKey: redirect && !c.title ? null : normaliseTitle(c.title),
    currency: assessCurrency({ metricType, publishedDate: c.publishedDate, asOf: c.asOf, capturedAt: c.capturedAt, now }),
    authority,
    purpose: assessPurpose({ url, title: c.title, publisher, companyDomain }),
  };
}

function assessAll(citations: readonly AssessableCitation[] | undefined, metricType: string, now: Date, companyDomain: string | null | undefined): AssessedCitation[] {
  const seen = new Set<string>();
  const out: AssessedCitation[] = [];
  for (const c of Array.isArray(citations) ? citations : []) {
    if (!c || !usableUrl(c.url)) continue;
    const key = c.url.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(assessCitation(c, metricType, now, companyDomain));
  }
  return out;
}

/** Distinct sources among already-assessed citations; copies sharing a domain or an identical title count once. */
function distinctSources(items: readonly AssessedCitation[]): number {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const firstByKey = new Map<string, number>();
  items.forEach((item, i) => {
    for (const key of [`d:${item.domainKey}`, item.titleKey ? `t:${item.titleKey}` : null]) {
      if (!key) continue;
      const seenAt = firstByKey.get(key);
      if (seenAt === undefined) firstByKey.set(key, i);
      else parent[find(i)] = find(seenAt);
    }
  });
  return new Set(items.map((_, i) => find(i))).size;
}

/**
 * How many independent sources back this? Only filings and independent
 * reporting count (a press release, the company's own site, sponsored or
 * advocacy material does not), and a syndicated copy (same registrable domain,
 * or an identical normalised title) is counted once.
 */
export function countIndependentSources(citations: readonly AssessableCitation[] | undefined, companyDomain?: string | null): number {
  return distinctSources(assessAll(citations, 'default', new Date(0), companyDomain).filter((c) => isIndependentPurpose(c.purpose)));
}

// Figure assessment ------------------------------------------------------------------

export type FigureAssessment = SourceAssessment;

export interface FigureInput {
  metricType: string;
  citations: readonly AssessableCitation[] | undefined;
  now: ClockInput;
  companyDomain?: string | null;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(iso: string): string {
  const [y, m] = iso.split('-');
  return m ? `${MONTH_ABBR[Number(m) - 1]} ${y}` : `${y}`;
}

function currencyLine(currency: CurrencyAssessment): string {
  if (currency.status === 'undated' || !currency.date) return 'No publication date: age unknown';
  const prefix = currency.basis === 'asOf' ? 'As of' : 'Published';
  const tag = currency.status === 'stale'
    ? `stale: ${Math.floor(currency.ageMonths ?? 0)} months old`
    : currency.status;
  return `${prefix} ${formatDate(currency.date)} (${tag})`;
}

/** The freshest dated source, preferring ones that are not weak (a fresh junk page must not make a figure look current). */
function freshest(items: readonly AssessedCitation[], metricType: string): CurrencyAssessment {
  const dated = (list: readonly AssessedCitation[]) => list.filter((c) => c.currency.ageMonths != null);
  const solid = dated(items.filter((c) => c.authority.tier !== 'weak'));
  const pool = solid.length ? solid : dated(items);
  if (!pool.length) return { status: 'undated', ageMonths: null, horizonMonths: horizonMonthsFor(metricType), basis: 'none', date: null };
  return pool.reduce((a, b) => (b.currency.ageMonths! < a.currency.ageMonths! ? b : a)).currency;
}

/** Combine currency, authority, purpose and independence into one plain-English grade for a figure. */
export function assessFigure(input: FigureInput): FigureAssessment {
  const now = toDate(input.now);
  const items = assessAll(input.citations, input.metricType, now, input.companyDomain);
  const currency = freshest(items, input.metricType);
  const independent = items.filter((c) => isIndependentPurpose(c.purpose));
  const independentSources = distinctSources(independent);
  const companyReportedOnly = items.length > 0 && items.every((c) => COMPANY_ISSUED_PURPOSES.includes(c.purpose));

  const best = items.length
    ? items.reduce((a, b) => (AUTHORITY_RANK[b.authority.tier] < AUTHORITY_RANK[a.authority.tier] ? b : a))
    : null;
  const authority = best ? { tier: best.authority.tier, reason: best.authority.reason } : { tier: 'weak' as const, reason: 'No source cited' };
  const hasFiling = items.some((c) => c.purpose === 'regulatory_filing');
  const purpose: SourcePurpose = hasFiling ? 'regulatory_filing'
    : items.some((c) => c.purpose === 'independent_reporting') ? 'independent_reporting'
      : best?.purpose ?? 'unknown';

  let grade: AssessmentGrade;
  if (currency.status === 'stale' || currency.status === 'undated' || authority.tier === 'weak' || authority.tier === 'reference') grade = 'weak';
  else if (currency.status === 'current' && AUTHORITY_RANK[authority.tier] <= AUTHORITY_RANK.strong && independentSources >= 1 && (hasFiling || independentSources >= 2)) grade = 'strong';
  else grade = 'adequate';

  const plainEnglish = [currencyLine(currency)];
  plainEnglish.push(items.length ? `${authority.reason} (${TIER_LABEL[authority.tier]})` : 'No source cited');
  if (independentSources > 0) plainEnglish.push(`${independentSources} independent source${independentSources === 1 ? '' : 's'}`);
  else if (companyReportedOnly) plainEnglish.push('Company-reported only');
  else if (items.length) plainEnglish.push('No independent corroboration');
  if (items.some((c) => c.purpose === 'sponsored')) plainEnglish.push('Includes sponsored content');
  if (items.some((c) => c.purpose === 'advocacy')) plainEnglish.push('Includes advocacy material');

  return { currency, authority, purpose, independentSources, companyReportedOnly, grade, plainEnglish };
}

// Confidence cap ---------------------------------------------------------------------

/** Why a `verified` figure may not keep that label. Empty when nothing in the evidence objects. */
export function confidenceCapReasons(assessment: FigureAssessment): string[] {
  const reasons: string[] = [];
  const { currency, authority } = assessment;
  if (currency.status === 'stale') reasons.push('The newest source is stale.');
  if (currency.status === 'undated') reasons.push('No source has a publication date, so its age is unknown.');
  if (authority.tier === 'weak' || authority.tier === 'reference') reasons.push('Only weak or user-edited sources back this.');
  if (assessment.companyReportedOnly && assessment.independentSources === 0) reasons.push('Only the company says so; nothing independent corroborates it.');
  return reasons;
}

/**
 * The confidence a figure may keep. Never raises, never invents: it only ever
 * returns `requested` or, for `verified`, the lower `estimated`. A human's
 * `user_verified` is not this module's to change.
 */
export function capConfidence(requested: Confidence, assessment: FigureAssessment): Confidence {
  if (requested !== 'verified') return requested;
  return confidenceCapReasons(assessment).length ? 'estimated' : 'verified';
}

// Latest wins ------------------------------------------------------------------------

export interface AssessedCandidate {
  /** The figure each candidate states; used only to notice a disagreement. Null/absent = no value to compare. */
  value?: number | string | null;
  assessment: FigureAssessment;
}

export interface BetterChoice<T extends AssessedCandidate> {
  winner: T;
  loser: T;
  reason: string;
  /** Set when both are current and state different values. */
  conflict: string | null;
}

const isFresh = (a: FigureAssessment) => a.currency.status === 'current' || a.currency.status === 'aging';
const rankOf = (a: FigureAssessment) => AUTHORITY_RANK[a.authority.tier];
const ageOf = (a: FigureAssessment) => a.currency.ageMonths ?? Number.POSITIVE_INFINITY;

function sameValue(a: AssessedCandidate['value'], b: AssessedCandidate['value']): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * Pick between two assessed candidates for the same figure. Newer wins only
 * when at least as authoritative; otherwise the more authoritative one wins. A
 * current candidate beats a stale or undated one unless the current one is weak
 * and the other is not. Ties keep `a`.
 */
export function chooseBetter<T extends AssessedCandidate>(a: T, b: T): BetterChoice<T> {
  const fa = isFresh(a.assessment);
  const fb = isFresh(b.assessment);
  let winner: T;
  let reason: string;
  const byAuthority = (): [T, string] => rankOf(b.assessment) < rankOf(a.assessment)
    ? [b, 'more authoritative source']
    : [a, rankOf(a.assessment) < rankOf(b.assessment) ? 'more authoritative source' : 'equally good evidence; kept the first'];

  if (fa !== fb) {
    const [fresh, other] = fa ? [a, b] : [b, a];
    if (fresh.assessment.authority.tier === 'weak' && other.assessment.authority.tier !== 'weak') {
      [winner, reason] = [other, 'more authoritative source; the current one is only weakly sourced'];
    } else {
      [winner, reason] = [fresh, 'the only current source'];
    }
  } else if (ageOf(a.assessment) !== ageOf(b.assessment)) {
    const [newer, older] = ageOf(a.assessment) < ageOf(b.assessment) ? [a, b] : [b, a];
    if (rankOf(newer.assessment) <= rankOf(older.assessment)) [winner, reason] = [newer, 'newer and at least as authoritative'];
    else [winner, reason] = [older, 'more authoritative source; the newer one is less authoritative'];
  } else {
    [winner, reason] = byAuthority();
  }

  const loser = winner === a ? b : a;
  let conflict: string | null = null;
  if (fa && fb && a.value != null && b.value != null && !sameValue(a.value, b.value)) {
    conflict = `Two current sources disagree (${String(a.value)} vs ${String(b.value)}); kept the one chosen for being ${reason}.`;
  }
  return { winner, loser, reason, conflict };
}

/** Exposed for display code that wants the label for a tier. */
export const authorityTierLabel = (tier: SourceAuthorityTier): string => TIER_LABEL[tier];
