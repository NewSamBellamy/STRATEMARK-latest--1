/**
 * The market report as data: what "Deck report (PDF)" prints.
 *
 * The first version printed a cover, a contents page and, for each company, one line and a table of seven figures
 * (four or five of them "Unknown"): eight pages for a ten-company deck, with nothing from the research behind the
 * cards. This one is built from everything the deck has already stored, at no research cost:
 *   - a "market at a glance" table (the same four figures each card face shows);
 *   - the market signals: barriers to entry, insights, documented risks and culture notes;
 *   - one profile per company: what it is, key figures, products, leadership, history, recent news, and its own
 *     risk and culture findings, with its sources as footnotes.
 *
 * Integrity (AGENTS.md Rule 9): nothing here is written by this file. Every sentence is a stored one (an overview
 * paragraph, a product line, a timeline event, a headline, a claim), every figure comes through the same card-face
 * and export gates as everywhere else, a section with nothing stored is left out rather than padded, and a risk
 * claim keeps the source that reports it.
 */
import {
  historyContentSchema,
  liveIntelContentSchema,
  ownershipLabel,
  overviewContentSchema,
  productsRoadmapContentSchema,
  publisherOf,
  teamOrgContentSchema,
  usableCitations,
  type CardWithCompany,
  type Citation,
  type DashboardTab,
} from '@mi/contracts';
import { buildCardView, fitFaceLine } from '@/features/card/card-view';
import { buildReportModel, companiesFromCards, type ReportCompany, type ReportModel } from './exportModel';
import { isDirectSource, sourceHref } from '@/lib/sourceHref';

type StoredTabs = Record<string, Partial<Record<DashboardTab, { content: unknown; lastRefreshedAt?: string }>> | undefined>;

export interface ReportSource { title: string; url: string; direct: boolean }

export interface SignalBlock {
  title: string;
  summary: string | null;
  points: string[];
  sources: ReportSource[];
}

export interface FullReportCompany extends ReportCompany {
  /** "Acquired by ..." and the like, only when a source says so. */
  ownership: string | null;
  founded: string | null;
  /** Up to three paragraphs of the stored overview. */
  overview: string[];
  /** The four strongest sourced figures, as the card face shows them ("Not found yet" slots left out). */
  keyFigures: Array<{ label: string; display: string }>;
  products: Array<{ name: string; description: string | null }>;
  leaders: Array<{ name: string; role: string }>;
  timeline: Array<{ date: string; title: string }>;
  news: Array<{ title: string; publisher: string | null; date: string | null; url: string }>;
  risks: Array<{ text: string; source: ReportSource | null }>;
  culture: { note: string; sources: ReportSource[] } | null;
  /** The kind of card the company sits under (Company, Infrastructure, Distribution). */
  role: string;
}

export interface FullReportModel extends Omit<ReportModel, 'companies'> {
  companies: FullReportCompany[];
  barriers: SignalBlock[];
  insights: SignalBlock[];
  /** How many of each signal kind the deck holds, for the cover and the contents. */
  signalCount: number;
  /** True when no company has anything beyond its figures: the report is then the short form. */
  thin: boolean;
}

const source = (c: Pick<Citation, 'url' | 'title'>): ReportSource => ({ title: publisherOf(c.url, c.title), url: sourceHref(c.url, c.title), direct: isDirectSource(c.url) });

const once = (seen: Set<string>, text: string | null | undefined): string | null => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  const key = t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!t || seen.has(key)) return null;
  seen.add(key);
  return t;
};

/** Plain paragraphs of a stored overview: no headings, tables, bullets or figure lines, links reduced to their words. */
export function overviewParagraphs(markdown: string | null | undefined, max = 3): string[] {
  const out: string[] = [];
  for (const block of (markdown ?? '').split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text || /^(#|\||>|[-*+]\s|\d+[.)]\s|!\[)/.test(text) || /\n\s*[-*+|]/.test(text)) continue;
    const plain = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim();
    // The stored placeholders and "not found" lines are not an overview.
    if (plain.length < 60 || /needs an evidence-backed refresh|No source-backed company snapshot|no paid refresh was started/i.test(plain)) continue;
    out.push(fitFaceLine(plain, 650) ?? plain);
    if (out.length >= max) break;
  }
  return out;
}

/** Stored dates are free text ("Q1 2021", "2022 Q2 (June)", "2024"): order them by year, then quarter. */
export const dateKey = (date: string) => `${/\b(\d{4})\b/.exec(date)?.[1] ?? '9999'}-${/\bQ([1-4])\b/i.exec(date)?.[1] ?? '0'}`;

function tabContent<T>(tabs: StoredTabs, companyId: string, tab: DashboardTab, parse: (content: unknown) => T | null): T | null {
  const content = tabs[companyId]?.[tab]?.content;
  return content === undefined ? null : parse(content);
}

function profileOf(card: CardWithCompany, tabs: StoredTabs, base: ReportCompany, signalCards: readonly CardWithCompany[]): FullReportCompany {
  const company = card.company!;
  const view = buildCardView(card);
  const overview = tabContent(tabs, company.id, 'overview', (c) => { const r = overviewContentSchema.safeParse(c); return r.success ? r.data : null; });
  const products = tabContent(tabs, company.id, 'products_roadmap', (c) => { const r = productsRoadmapContentSchema.safeParse(c); return r.success ? r.data : null; });
  const team = tabContent(tabs, company.id, 'team_org', (c) => { const r = teamOrgContentSchema.safeParse(c); return r.success ? r.data : null; });
  const history = tabContent(tabs, company.id, 'history', (c) => { const r = historyContentSchema.safeParse(c); return r.success ? r.data : null; });
  const intel = tabContent(tabs, company.id, 'live_intel', (c) => { const r = liveIntelContentSchema.safeParse(c); return r.success ? r.data : null; });

  const mine = signalCards.filter((c) => c.company?.id === company.id);
  const seenRisk = new Set<string>();
  const risks = mine.filter((c) => c.card.cardType === 'vice').flatMap((c) => c.viceClaims).flatMap((claim) => {
    const text = once(seenRisk, claim.claimText);
    return text ? [{ text, source: claim.sourceUrl ? source({ url: claim.sourceUrl, title: claim.sourceTitle ?? '' }) : null }] : [];
  }).slice(0, 4);
  // A culture note with no usable source is left out, the same as an unsourced risk claim.
  const cultureCard = mine.find((c) => c.card.cardType === 'culture' && c.card.summary?.trim() && usableCitations(c.card.citations ?? []).length > 0);

  const leaders = (team?.nodes ?? [])
    .filter((n) => n.name.trim() && n.role.trim())
    .sort((a, b) => Number(b.group === 'exec') - Number(a.group === 'exec'))
    .slice(0, 8).map((n) => ({ name: n.name.trim(), role: n.role.trim() }));

  const events = [...(history?.timeline ?? [])].filter((e) => e.date && e.title).sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)));
  const timeline = (events.length > 8 ? [...events.slice(0, 2), ...events.slice(-6)] : events).map((e) => ({ date: e.date, title: e.title.trim() }));

  const news = (intel?.items ?? []).filter((i) => !i.stale && i.title.trim())
    .sort((a, b) => (b.publishedDate ?? '').localeCompare(a.publishedDate ?? '')).slice(0, 5)
    .map((i) => ({ title: i.title.trim(), publisher: i.publisher ?? null, date: i.publishedDate ?? null, url: i.url }));

  return {
    ...base,
    ownership: ownershipLabel(company.ownership),
    founded: company.founded?.year ? String(company.founded.year) : null,
    overview: overviewParagraphs(overview?.markdown),
    keyFigures: view.faceMetrics.filter((m) => m.metric?.value != null || m.metric?.reportedBand != null).map((m) => ({ label: m.label, display: m.display })),
    products: (products?.products ?? []).filter((p) => p.name.trim()).slice(0, 8)
      .map((p) => ({ name: p.name.trim(), description: fitFaceLine(p.description, 200) })),
    leaders,
    timeline,
    news,
    risks,
    culture: cultureCard ? { note: cultureCard.card.summary!.trim(), sources: usableCitations(cultureCard.card.citations ?? []).slice(0, 3).map(source) } : null,
    role: view.type,
  };
}

function signalBlock(card: CardWithCompany): SignalBlock {
  const seen = new Set<string>();
  const summary = once(seen, card.card.summary);
  return {
    title: card.card.title?.trim() || 'Finding',
    summary,
    points: card.card.keyPoints.flatMap((p) => { const t = once(seen, p); return t ? [t] : []; }).slice(0, 6),
    sources: usableCitations(card.card.citations ?? []).slice(0, 4).map(source),
  };
}

/**
 * The report for a deck. `tabs` is the deck's stored dashboard tabs (the share snapshot carries them); a company
 * without a stored tab simply has no such section.
 */
export function buildFullReport(args: {
  title: string;
  cards: readonly CardWithCompany[];
  tabs: StoredTabs;
  now?: Date;
}): FullReportModel {
  const companies = companiesFromCards(args.cards);
  const base = buildReportModel({ title: args.title, kind: 'deck', companies, ...(args.now ? { now: args.now } : {}) });
  const byCompany = new Map<string, CardWithCompany>();
  for (const card of args.cards) {
    if (card.company && !['culture', 'vice', 'insight', 'barrier'].includes(card.card.cardType) && !byCompany.has(card.company.id)) byCompany.set(card.company.id, card);
  }
  const profiles = base.companies.flatMap((c) => {
    const card = byCompany.get(c.id);
    return card ? [profileOf(card, args.tabs, c, args.cards)] : [];
  });
  const signals = (type: 'barrier' | 'insight') => args.cards.filter((c) => c.card.cardType === type).map(signalBlock);
  const barriers = signals('barrier');
  const insights = signals('insight');
  const riskCount = profiles.reduce((n, c) => n + c.risks.length, 0);
  const cultureCount = profiles.filter((c) => c.culture).length;
  return {
    ...base,
    companies: profiles,
    barriers,
    insights,
    signalCount: barriers.length + insights.length + riskCount + cultureCount,
    thin: profiles.every((c) => c.overview.length === 0 && c.products.length === 0 && c.leaders.length === 0 && c.timeline.length === 0 && c.news.length === 0),
  };
}
