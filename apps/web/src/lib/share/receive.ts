/**
 * What a shared snapshot is allowed to be once it reaches a visitor.
 *
 * A share is data from a stranger: the Worker stores it without reading it, and anyone can make one (the origin check
 * is a courtesy, not authentication). The viewer therefore never shows a snapshot as it came. It is held to the same
 * rules the app holds its own research to:
 *   - a figure is only as verified as its sources make it (a "verified" figure with no usable source is an estimate,
 *     and a figure no one here could have checked cannot claim a human checked it: "user verified" is not honoured,
 *     and a confidence outside the four the app knows makes the figure unknown, with no number);
 *   - who owns a company and when it was founded are shown only with a source behind them (a status nothing states is
 *     dropped, as in a private link);
 *   - an allegation with no clickable source is dropped (Rule 9), and every source link must be a plain http(s) page;
 *   - a number must be a real, non-negative number;
 *   - the live-site embed is never offered (a share could point it at any page, and a visitor would see it inside
 *     Stratemark's own frame);
 *   - and its size is bounded, so a small file cannot make a visitor's browser build millions of objects: the lists
 *     of the snapshot (SNAPSHOT_LIMITS), the lists inside each row and tab (ROW_LIMITS), and the prose (MARKDOWN_LIMITS).
 *
 * Red-team findings 1, 2 and 4 against the hosted share viewer, and the second review's.
 */
import {
  CONFIDENCE_LEVELS, DASHBOARD_TABS, companyFoundedSchema, enforceMetricProvenance, enforceOwnershipProvenance, ownershipSchema, usableCitations,
  type Card, type Company, type CompanyFounded, type CompanyMetric, type DashboardTab, type Ownership, type ShareSnapshot, type ViceClaim,
} from '@mi/contracts';

/** Far above any real deck (an 18-company deck has about 18 companies, 20 cards and 300 figures), far below hostile. */
export const SNAPSHOT_LIMITS = {
  markets: 5, decks: 5, companies: 300, cards: 400, metrics: 8_000, viceClaims: 800, dashboardCompanies: 300,
} as const;

/** True when the snapshot's lists are within what a visitor's browser will build. */
export function snapshotWithinLimits(value: Pick<ShareSnapshot, 'markets' | 'decks' | 'companies' | 'cards' | 'metrics' | 'viceClaims' | 'dashboards'>): boolean {
  return value.markets.length <= SNAPSHOT_LIMITS.markets
    && value.decks.length <= SNAPSHOT_LIMITS.decks
    && value.companies.length <= SNAPSHOT_LIMITS.companies
    && value.cards.length <= SNAPSHOT_LIMITS.cards
    && value.metrics.length <= SNAPSHOT_LIMITS.metrics
    && value.viceClaims.length <= SNAPSHOT_LIMITS.viceClaims
    && Object.keys(value.dashboards).length <= SNAPSHOT_LIMITS.dashboardCompanies;
}

/** A plain http(s) address with no credentials, or null. */
function webUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    return url.hostname && !url.username && !url.password ? text : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The most rows a share keeps in any one list inside a row or a tab. Each is well above what research produces (a team
 * is capped at 80 people, a news feed at 24 items, products at 16, a timeline runs to about 20 milestones, and a
 * figure has a handful of sources) and far below what a screen can draw: 5,000 news items were 90,000 page elements,
 * 2,000 people 130,000, and 20,000 people froze the tab for over a minute. A list past its limit loses its tail;
 * nothing is reordered.
 */
export const ROW_LIMITS = {
  citations: 100, keyPoints: 100, conflicts: 20, observations: 20, sources: 50,
  newsItems: 100, videos: 50, people: 200, seriesPoints: 200, capTable: 100,
  board: 50, notes: 50, fundingRounds: 100, leadInvestors: 30, investors: 100,
  timeline: 200, quotes: 100, products: 100, roadmap: 50, relationships: 50,
} as const;

/** The first `max` rows of a list that are records; a list that is not one is empty. */
function rowsOf(value: unknown, max: number): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord).slice(0, max) : [];
}

/** The first `max` entries of a list that are text; a list that is not one is empty. */
function textsOf(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, max) : [];
}

/** At most `max` raw source rows, looked at before any is judged (so what is shown is what confidence was judged on). */
function sourcesOf<T>(value: T[] | undefined, max: number = ROW_LIMITS.citations): T[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

/** A figure's proof of support lists the sources it was read from; a share keeps the first few. */
function boundedSupport<T>(proof: T): T {
  if (!isRecord(proof) || !isRecord(proof.support)) return proof;
  return { ...proof, support: { ...proof.support, sources: rowsOf(proof.support.sources, ROW_LIMITS.sources) } } as T;
}

/** A moment written as an ISO date or timestamp, or null. */
function isoMoment(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

function receiveMetric(metric: CompanyMetric, company: Company | undefined): CompanyMetric | null {
  if (!isRecord(metric)) return null;
  if (metric.value !== null && metric.value !== undefined && !(typeof metric.value === 'number' && Number.isFinite(metric.value) && metric.value >= 0)) return null;
  // A confidence this page does not know is not one (the capitals of "USER_VERIFIED" and a number are not a person's
  // check): the figure is unknown and carries no number (Rule 9), and the rest of the share opens as usual.
  const known = (CONFIDENCE_LEVELS as readonly unknown[]).includes(metric.confidence);
  // No person here checked anything: a human check cannot arrive in a share. The figure keeps whatever its sources earn it.
  const claimed = !known ? { ...metric, confidence: 'unknown' as const, value: null }
    : metric.confidence === 'user_verified' ? { ...metric, confidence: 'verified' as const } : metric;
  const bounded: CompanyMetric = {
    ...claimed,
    value: claimed.value ?? null,
    // A moment that is not a date is no moment (a blank reads as unknown on the card, never as fresh).
    capturedAt: isoMoment(claimed.capturedAt) ?? '',
    ...('lastVerifiedAt' in claimed ? { lastVerifiedAt: isoMoment(claimed.lastVerifiedAt) } : {}),
    ...('lastVerificationAttemptAt' in claimed ? { lastVerificationAttemptAt: isoMoment(claimed.lastVerificationAttemptAt) } : {}),
    citations: sourcesOf(claimed.citations),
    ...(claimed.reportedSupport ? { reportedSupport: boundedSupport(claimed.reportedSupport) } : {}),
    ...(claimed.reportedBand ? { reportedBand: boundedSupport(claimed.reportedBand) } : {}),
    ...(claimed.conflicts ? { conflicts: rowsOf(claimed.conflicts, ROW_LIMITS.conflicts).map((conflict) => ({ ...conflict, observations: rowsOf(conflict.observations, ROW_LIMITS.observations) })) as CompanyMetric['conflicts'] } : {}),
  };
  // A Source check is computed here from the evidence, never read from a share: a forged one is dropped.
  delete bounded.assessment;
  return enforceMetricProvenance(bounded, company?.websiteUrl, company?.ownership);
}

/**
 * The ownership a share may show: a record that parses (a field of the wrong type drops it, as in a private link),
 * held to the rules the app holds its own research to. A status with no usable source is not shown, and a human's
 * say-so cannot arrive in a share, so "user verified" is read as what the sources earn.
 */
function receiveOwnership(value: unknown): Ownership | null {
  if (value === null || value === undefined) return null;
  const parsed = ownershipSchema.safeParse(value);
  return parsed.success ? enforceOwnershipProvenance({ ...parsed.data, citations: sourcesOf(parsed.data.citations) }, true) : null;
}

/** A founding year is shown only with a source behind it (the contract requires one); anything else is not shown. */
function receiveFounded(value: unknown): CompanyFounded | null {
  if (value === null || value === undefined) return null;
  const parsed = companyFoundedSchema.safeParse(value);
  if (!parsed.success) return null;
  const citations = usableCitations(sourcesOf(parsed.data.citations));
  return citations.length > 0 ? { ...parsed.data, citations } : null;
}

/** The signal-card and company text a stranger can reach through a link must be a link only if it is a web page. */
function receiveCompany(company: Company): Company {
  const { ownership, founded, ...rest } = company;
  const kept = receiveOwnership(ownership);
  const year = receiveFounded(founded);
  return { ...rest, logoUrl: webUrl(company.logoUrl), websiteUrl: webUrl(company.websiteUrl), ...(kept ? { ownership: kept } : {}), ...(year ? { founded: year } : {}) };
}

function receiveCard(card: Card): Card {
  return {
    ...card,
    citations: usableCitations(sourcesOf(card.citations)),
    ...('keyPoints' in card ? { keyPoints: textsOf(card.keyPoints, ROW_LIMITS.keyPoints) } : {}),
  };
}

function receiveClaim(claim: ViceClaim): ViceClaim | null {
  if (!isRecord(claim)) return null;
  const url = webUrl(claim.sourceUrl);
  return url ? { ...claim, sourceUrl: url } : null;
}

/**
 * The most markdown a share may carry, per field and across the whole snapshot. Honest research prose is a few
 * thousand characters (the longest overview in the real sample deck is 3,400), so a deck of eighteen companies is
 * about a hundred thousand in all. Text past these is cut off (never reordered), which is also what keeps a small
 * file from handing the markdown parser a hundred thousand characters of a pattern it is slow on; the page's own
 * markdown renderer holds the same line again (lib/boundedMarkdown).
 */
export const MARKDOWN_LIMITS = { field: 20_000, total: 300_000 } as const;

/** The fields of each tab the page shows as markdown. */
const MARKDOWN_FIELDS: Partial<Record<DashboardTab, readonly string[]>> = {
  overview: ['markdown'],
  research: ['markdown'],
  history: ['founderStory'],
  mission_governance: ['mission', 'ethos', 'governanceStructure'],
};

/** What is left of the snapshot's markdown allowance. */
interface TextBudget { left: number }

/** A markdown field as a visitor may have it: text only, within its own limit, and only while the snapshot's allowance lasts. */
function receiveMarkdown(value: unknown, budget: TextBudget): string {
  if (typeof value !== 'string') return '';
  const room = Math.max(0, Math.min(MARKDOWN_LIMITS.field, budget.left));
  let kept = value.length > room ? value.slice(0, room) : value;
  if (kept.length < value.length && /[\ud800-\udbff]$/.test(kept)) kept = kept.slice(0, -1); // never half a character
  budget.left -= kept.length;
  return kept;
}

function isTab(name: string): name is DashboardTab {
  return (DASHBOARD_TABS as readonly string[]).includes(name);
}

/** The lists of rows in each tab, and how many rows of each a share keeps. */
const TAB_ROWS: Partial<Record<DashboardTab, Record<string, number>>> = {
  live_intel: { items: ROW_LIMITS.newsItems, videos: ROW_LIMITS.videos },
  team_org: { nodes: ROW_LIMITS.people },
  metrics: {
    revenue: ROW_LIMITS.seriesPoints, revenueQuarterly: ROW_LIMITS.seriesPoints, users: ROW_LIMITS.seriesPoints,
    churn: ROW_LIMITS.seriesPoints, nps: ROW_LIMITS.seriesPoints, capTable: ROW_LIMITS.capTable,
  },
  mission_governance: { board: ROW_LIMITS.board, fundingRounds: ROW_LIMITS.fundingRounds, investors: ROW_LIMITS.investors },
  history: { timeline: ROW_LIMITS.timeline, quotes: ROW_LIMITS.quotes },
  products_roadmap: { products: ROW_LIMITS.products, roadmap: ROW_LIMITS.roadmap, relationships: ROW_LIMITS.relationships },
};

/** The lists of plain text in each tab, and how many entries of each a share keeps. */
const TAB_TEXTS: Partial<Record<DashboardTab, Record<string, number>>> = {
  mission_governance: { positives: ROW_LIMITS.notes, negatives: ROW_LIMITS.notes },
};

type StoredTab = NonNullable<ShareSnapshot['dashboards'][string][DashboardTab]>;

/** One stored tab as a visitor may see it, or null when it is not a tab a screen can read. */
function receiveTab(tab: DashboardTab, entry: Record<string, unknown>, budget: TextBudget): StoredTab | null {
  const content = entry.content;
  const stored = entry as { lastRefreshedAt: string };
  // The team list may arrive as a bare list of people.
  if (tab === 'team_org' && Array.isArray(content)) return { ...stored, content: rowsOf(content, ROW_LIMITS.people) };
  // Every other tab reads its content as a record; anything else is not a tab.
  if (!isRecord(content)) return null;
  const next: Record<string, unknown> = { ...content };
  for (const field of MARKDOWN_FIELDS[tab] ?? []) if (field in next) next[field] = receiveMarkdown(next[field], budget);
  // A list that is not a list is empty, a row that is not a row is dropped, and a list past its limit loses its tail.
  for (const [field, max] of Object.entries(TAB_ROWS[tab] ?? {})) if (field in next) next[field] = rowsOf(next[field], max);
  for (const [field, max] of Object.entries(TAB_TEXTS[tab] ?? {})) if (field in next) next[field] = textsOf(next[field], max);
  if (tab === 'mission_governance' && Array.isArray(next.fundingRounds)) {
    next.fundingRounds = (next.fundingRounds as Array<Record<string, unknown>>)
      .map((round) => ('leadInvestors' in round ? { ...round, leadInvestors: textsOf(round.leadInvestors, ROW_LIMITS.leadInvestors) } : round));
  }
  // A live site is never embedded.
  if (tab === 'live_landing') next.embeddable = false;
  return { ...stored, content: next };
}

/** Each stored dashboard tab as a visitor may see it: a real tab, with its prose bounded and no live site embedded. */
function receiveDashboards(dashboards: ShareSnapshot['dashboards']): ShareSnapshot['dashboards'] {
  const out: ShareSnapshot['dashboards'] = {};
  const budget: TextBudget = { left: MARKDOWN_LIMITS.total };
  for (const [companyId, tabs] of Object.entries(dashboards)) {
    if (!isRecord(tabs)) continue;
    const kept: ShareSnapshot['dashboards'][string] = {};
    for (const [name, entry] of Object.entries(tabs)) {
      if (!isTab(name) || !isRecord(entry)) continue;
      const tab = receiveTab(name, entry, budget);
      if (tab) kept[name] = tab;
    }
    out[companyId] = kept;
  }
  return out;
}

/** The snapshot as a visitor may see it. The input has already passed `isShareSnapshot` (shape and size). */
export function receiveSnapshot(snapshot: ShareSnapshot): ShareSnapshot {
  const companies = snapshot.companies.filter(isRecord).map(receiveCompany);
  // A figure is judged against the company as it will be shown: a forged "acquired" status must not withhold its valuation.
  const byId = new Map(companies.map((company) => [company.id, company] as const));
  return {
    ...snapshot,
    companies,
    metrics: snapshot.metrics.flatMap((metric) => {
      const kept = receiveMetric(metric, byId.get(metric?.companyId));
      return kept ? [kept] : [];
    }),
    cards: snapshot.cards.filter(isRecord).map(receiveCard),
    viceClaims: snapshot.viceClaims.flatMap((claim) => {
      const kept = receiveClaim(claim);
      return kept ? [kept] : [];
    }),
    dashboards: receiveDashboards(snapshot.dashboards),
  };
}
