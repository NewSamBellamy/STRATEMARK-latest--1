/**
 * What a shared snapshot is allowed to be once it reaches a visitor.
 *
 * A share is data from a stranger: the Worker stores it without reading it, and anyone can make one (the origin check
 * is a courtesy, not authentication). The viewer therefore never shows a snapshot as it came. It is held to the same
 * rules the app holds its own research to:
 *   - a figure is only as verified as its sources make it (a "verified" figure with no usable source is an estimate,
 *     and a figure no one here could have checked cannot claim a human checked it: "user verified" is not honoured);
 *   - who owns a company and when it was founded are shown only with a source behind them (a status nothing states is
 *     dropped, as in a private link);
 *   - an allegation with no clickable source is dropped (Rule 9), and every source link must be a plain http(s) page;
 *   - a number must be a real, non-negative number;
 *   - the live-site embed is never offered (a share could point it at any page, and a visitor would see it inside
 *     Stratemark's own frame);
 *   - and its size is bounded, so a small file cannot make a visitor's browser build millions of objects.
 *
 * Red-team findings 1, 2 and 4 against the hosted share viewer.
 */
import {
  DASHBOARD_TABS, companyFoundedSchema, enforceMetricProvenance, enforceOwnershipProvenance, ownershipSchema, usableCitations,
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

function receiveMetric(metric: CompanyMetric, company: Company | undefined): CompanyMetric | null {
  if (!isRecord(metric)) return null;
  if (metric.value !== null && metric.value !== undefined && !(typeof metric.value === 'number' && Number.isFinite(metric.value) && metric.value >= 0)) return null;
  // No person here checked anything: a human check cannot arrive in a share. The figure keeps whatever its sources earn it.
  const claimed = metric.confidence === 'user_verified' ? { ...metric, confidence: 'verified' as const } : metric;
  return enforceMetricProvenance({ ...claimed, value: claimed.value ?? null }, company?.websiteUrl, company?.ownership);
}

/**
 * The ownership a share may show: a record that parses (a field of the wrong type drops it, as in a private link),
 * held to the rules the app holds its own research to. A status with no usable source is not shown, and a human's
 * say-so cannot arrive in a share, so "user verified" is read as what the sources earn.
 */
function receiveOwnership(value: unknown): Ownership | null {
  if (value === null || value === undefined) return null;
  const parsed = ownershipSchema.safeParse(value);
  return parsed.success ? enforceOwnershipProvenance(parsed.data, true) : null;
}

/** A founding year is shown only with a source behind it (the contract requires one); anything else is not shown. */
function receiveFounded(value: unknown): CompanyFounded | null {
  if (value === null || value === undefined) return null;
  const parsed = companyFoundedSchema.safeParse(value);
  if (!parsed.success) return null;
  const citations = usableCitations(parsed.data.citations);
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
  return { ...card, citations: usableCitations(card.citations) };
}

function receiveClaim(claim: ViceClaim): ViceClaim | null {
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

type StoredTab = NonNullable<ShareSnapshot['dashboards'][string][DashboardTab]>;

/** One stored tab as a visitor may see it, or null when it is not a tab a screen can read. */
function receiveTab(tab: DashboardTab, entry: Record<string, unknown>, budget: TextBudget): StoredTab | null {
  const content = entry.content;
  // Every tab reads its content as a record (the team list may also arrive as a bare list); anything else is not a tab.
  if (!isRecord(content) && !(tab === 'team_org' && Array.isArray(content))) return null;
  let kept: unknown = content;
  if (isRecord(content)) {
    const next: Record<string, unknown> = { ...content };
    for (const field of MARKDOWN_FIELDS[tab] ?? []) if (field in next) next[field] = receiveMarkdown(next[field], budget);
    // A live site is never embedded.
    if (tab === 'live_landing') next.embeddable = false;
    kept = next;
  }
  return { ...(entry as { lastRefreshedAt: string }), content: kept };
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
  const companies = snapshot.companies.map(receiveCompany);
  // A figure is judged against the company as it will be shown: a forged "acquired" status must not withhold its valuation.
  const byId = new Map(companies.map((company) => [company.id, company] as const));
  return {
    ...snapshot,
    companies,
    metrics: snapshot.metrics.flatMap((metric) => {
      const kept = receiveMetric(metric, byId.get(metric?.companyId));
      return kept ? [kept] : [];
    }),
    cards: snapshot.cards.map(receiveCard),
    viceClaims: snapshot.viceClaims.flatMap((claim) => {
      const kept = receiveClaim(claim);
      return kept ? [kept] : [];
    }),
    dashboards: receiveDashboards(snapshot.dashboards),
  };
}
