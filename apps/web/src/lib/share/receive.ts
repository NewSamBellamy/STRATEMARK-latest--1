/**
 * What a shared snapshot is allowed to be once it reaches a visitor.
 *
 * A share is data from a stranger: the Worker stores it without reading it, and anyone can make one (the origin check
 * is a courtesy, not authentication). The viewer therefore never shows a snapshot as it came. It is held to the same
 * rules the app holds its own research to:
 *   - a figure is only as verified as its sources make it (a "verified" figure with no usable source is an estimate,
 *     and a figure no one here could have checked cannot claim a human checked it: "user verified" is not honoured);
 *   - an allegation with no clickable source is dropped (Rule 9), and every source link must be a plain http(s) page;
 *   - a number must be a real, non-negative number;
 *   - the live-site embed is never offered (a share could point it at any page, and a visitor would see it inside
 *     Stratemark's own frame);
 *   - and its size is bounded, so a small file cannot make a visitor's browser build millions of objects.
 *
 * Red-team findings 1, 2 and 4 against the hosted share viewer.
 */
import { enforceMetricProvenance, usableCitations, type Card, type Company, type CompanyMetric, type ShareSnapshot, type ViceClaim } from '@mi/contracts';

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

/** The signal-card and company text a stranger can reach through a link must be a link only if it is a web page. */
function receiveCompany(company: Company): Company {
  const logo = webUrl(company.logoUrl);
  const site = webUrl(company.websiteUrl);
  return { ...company, logoUrl: logo, websiteUrl: site };
}

function receiveCard(card: Card): Card {
  return { ...card, citations: usableCitations(card.citations) };
}

function receiveClaim(claim: ViceClaim): ViceClaim | null {
  const url = webUrl(claim.sourceUrl);
  return url ? { ...claim, sourceUrl: url } : null;
}

/** Each stored dashboard tab is shown as sent, except a live site is never embedded. */
function receiveDashboards(dashboards: ShareSnapshot['dashboards']): ShareSnapshot['dashboards'] {
  const out: ShareSnapshot['dashboards'] = {};
  for (const [companyId, tabs] of Object.entries(dashboards)) {
    if (!isRecord(tabs)) continue;
    const kept: ShareSnapshot['dashboards'][string] = {};
    for (const [tab, entry] of Object.entries(tabs)) {
      if (!isRecord(entry)) continue;
      const content = (entry as { content?: unknown }).content;
      kept[tab as keyof typeof kept] = tab === 'live_landing' && isRecord(content)
        ? { ...(entry as { lastRefreshedAt: string }), content: { ...content, embeddable: false } }
        : (entry as { content: unknown; lastRefreshedAt: string });
    }
    out[companyId] = kept;
  }
  return out;
}

/** The snapshot as a visitor may see it. The input has already passed `isShareSnapshot` (shape and size). */
export function receiveSnapshot(snapshot: ShareSnapshot): ShareSnapshot {
  const byId = new Map(snapshot.companies.map((company) => [company.id, company] as const));
  return {
    ...snapshot,
    companies: snapshot.companies.map(receiveCompany),
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
