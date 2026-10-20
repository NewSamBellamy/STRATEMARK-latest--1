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
 * and export gates as everywhere else, a section with nothing stored is left out rather than padded, a barrier or
 * insight with no usable source is left out, and a risk
 * claim is printed only with the usable source that reports it (an unsourced one is dropped, like an unsourced
 * culture note).
 *
 * Free prose is not a source-checked figure. A money amount, headcount, user or customer count or market share
 * stated in an overview paragraph, a product line, a timeline event or a one-liner never reaches the page: such a
 * sentence is left out (see proseFigures.ts), so the PDF cannot state "$5B valuation" beside a valuation row that
 * says Unknown. The sentences around it are kept as stored.
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
import { buildReportModel, companiesFromCards, metricAsOf, type ReportCompany, type ReportModel } from './exportModel';
import { isDirectSource, sourceHref } from '@/lib/sourceHref';
import { hasProseFigure, withoutProseFigures } from './proseFigures';

// The recogniser is shared with every other export (CSV, PDF, PowerPoint): see proseFigures.ts.
export { hasProseFigure, withoutProseFigures };

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
  /** `sourced` is false when the stored item carries no source of its own (a product line, a history event). */
  products: Array<{ name: string; description: string | null; sourced: boolean }>;
  leaders: Array<{ name: string; role: string; sourced: boolean }>;
  timeline: Array<{ date: string; title: string; sourced: boolean }>;
  news: Array<{ title: string; publisher: string | null; date: string | null; url: string }>;
  risks: Array<{ text: string; source: ReportSource }>;
  /** How many risk (vice) cards the printed risks come from: cards, not claims. */
  riskCards: number;
  culture: { note: string; sources: ReportSource[] } | null;
  /** The kind of card the company sits under (Company, Infrastructure, Distribution). */
  role: string;
  /** The card the app's face is built from, for the print card face. Same object, never a rebuilt copy. */
  card: CardWithCompany;
  /** Deck-wide note number for each of this company's own footnotes (index n-1 of `footnotes`). */
  deckNotes: number[];
}

export interface FullReportModel extends Omit<ReportModel, 'companies'> {
  companies: FullReportCompany[];
  barriers: SignalBlock[];
  insights: SignalBlock[];
  /** How many signal cards the whole report prints, counting the risks and culture notes that sit inside company profiles. The "Market signals" section itself prints only barriers and insights: see marketSignalCount. */
  signalCount: number;
  /** What the "Market signals" section prints: the barriers and insights with a usable source. */
  marketSignalCount: number;
  /** True when no company has anything beyond its figures: the report is then the short form. */
  thin: boolean;
  /** Every signal card (risk, culture, barrier, insight), printable or held back. A held-back entry carries no card and no text. */
  signals: SignalEntry[];
  signalTally: { printable: number; heldBack: number; heldBackByKind: Record<SignalKind, number> };
  /** One series per face metric for the market overview page. */
  overview: OverviewSeries[];
  methods: MethodsCounts;
  /** Deck-wide notes, deduplicated by address and numbered in a fixed walk (see buildSourceRegistry). */
  sources: DeckSource[];
}

export type SignalKind = 'risk' | 'culture' | 'barrier' | 'insight';

/** A stored brief for a signal card, as the card-memory branch will hand it over (kept structural so the merge is trivial). */
export interface SignalBriefInput {
  lead: string;
  points: Array<{ text: string; sources: Array<{ title: string; url: string }> }>;
  sources: Array<{ title: string; url: string }>;
}
export type SignalBriefsInput = Record<string, SignalBriefInput>;

export interface DeckSource extends ReportSource {
  /** Deck-wide note number, starting at 1. */
  n: number;
  /** The publisher's name (the title shown is always the publisher). */
  publisher: string;
}

export interface SignalPoint { text: string; sources: ReportSource[]; notes: number[] }

export interface SignalEntry {
  cardId: string;
  kind: SignalKind;
  printable: boolean;
  /** Null when held back: the card's text must not travel with it. Otherwise the card with the company's metrics removed. */
  card: CardWithCompany | null;
  companyId: string | null;
  /** Only sourced points; the lead only when the brief has a usable source of its own. */
  brief: { lead: string | null; points: SignalPoint[]; sources: ReportSource[]; notes: number[] } | null;
  /** The stored summary, points and sources, for a printable signal with no brief (usable citations on the card). */
  stored: (SignalBlock & { notes: number[] }) | null;
}

export type OverviewKey = 'company_value' | 'revenue' | 'reach' | 'employees';

export interface OverviewEntry {
  companyId: string;
  name: string;
  /** 'sourced' has a stored number; 'range' is a stated band (shown, never charted); 'unknown' is null and listed as unknown. */
  status: 'sourced' | 'range' | 'unknown';
  /** What the card face prints. Null when unknown. */
  display: string | null;
  /** The face's label for this figure. Null when unknown. */
  label: string | null;
  value: number | null;
  asOf: string | null;
  /** Deck-wide note number of the figure's first source. */
  note: number | null;
}

export interface OverviewSeries {
  key: OverviewKey;
  label: string;
  entries: OverviewEntry[];
  /** Names of the companies with no sourced figure here. */
  unknown: string[];
  /** True only when at least two values are sourced numbers. */
  chartable: boolean;
}

export interface MethodsCounts {
  /** Human-checked figures count as verified. */
  verified: number;
  estimated: number;
  unknown: number;
  signalsPrinted: number;
  signalsHeldBack: number;
  /** Stored profile items printed with no source attached: overview paragraphs, products, leaders, history events. */
  unsourcedProfileItems: number;
}

const source = (c: Pick<Citation, 'url' | 'title'>): ReportSource => ({ title: publisherOf(c.url, c.title), url: sourceHref(c.url, c.title), direct: isDirectSource(c.url) });

const once = (seen: Set<string>, text: string | null | undefined): string | null => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  const key = t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!t || seen.has(key)) return null;
  seen.add(key);
  return t;
};

/** Plain paragraphs of a stored overview: no headings, tables, bullets, figure lines or sentences stating an unchecked figure, links reduced to their words. */
export function overviewParagraphs(markdown: string | null | undefined, max = 3): string[] {
  const out: string[] = [];
  for (const block of (markdown ?? '').split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text || /^(#|\||>|[-*+]\s|\d+[.)]\s|!\[)/.test(text) || /\n\s*[-*+|]/.test(text)) continue;
    const plain = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim();
    // A sentence that states an unchecked money or headcount figure is left out; the rest of the paragraph stays.
    const prose = withoutProseFigures(plain);
    // The stored placeholders and "not found" lines are not an overview.
    if (!prose || prose.length < 60 || /needs an evidence-backed refresh|No source-backed company snapshot|no paid refresh was started/i.test(plain)) continue;
    out.push(fitFaceLine(prose, 650) ?? prose);
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
  // A risk with no usable http(s) source is dropped, the same as an unsourced culture note below: a vice claim is
  // shown only with the source that reports it. The source is checked before the repeat test, so an unsourced claim
  // can never hide a sourced one that says the same thing.
  const printedRisks = mine.filter((c) => c.card.cardType === 'vice').flatMap((c) => c.viceClaims.flatMap((claim) => {
    const cited = usableCitations(claim.sourceUrl ? [{ url: claim.sourceUrl, title: claim.sourceTitle ?? '' }] : [])[0];
    const text = cited ? once(seenRisk, claim.claimText) : null;
    return cited && text ? [{ cardId: c.card.id, text, source: source(cited) }] : [];
  })).slice(0, 4);
  const risks = printedRisks.map((r) => ({ text: r.text, source: r.source }));
  // A culture note with no usable source is left out, the same as an unsourced risk claim.
  const cultureCard = mine.find((c) => c.card.cardType === 'culture' && c.card.summary?.trim() && usableCitations(c.card.citations ?? []).length > 0);

  const leaders = (team?.nodes ?? [])
    .filter((n) => n.name.trim() && n.role.trim())
    .sort((a, b) => Number(b.group === 'exec') - Number(a.group === 'exec'))
    .slice(0, 8).map((n) => ({ name: n.name.trim(), role: n.role.trim(), sourced: usableCitations(n.sourceUrl ? [{ url: n.sourceUrl, title: '' }] : []).length > 0 }));

  // History events carry no source of their own, so one that states a money or headcount figure is left out.
  const events = [...(history?.timeline ?? [])].filter((e) => e.date && e.title && !hasProseFigure(e.title)).sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)));
  const timeline = (events.length > 8 ? [...events.slice(0, 2), ...events.slice(-6)] : events).map((e) => ({ date: e.date, title: e.title.trim(), sourced: false }));

  const news = (intel?.items ?? []).filter((i) => !i.stale && i.title.trim())
    .sort((a, b) => (b.publishedDate ?? '').localeCompare(a.publishedDate ?? '')).slice(0, 5)
    .map((i) => ({ title: i.title.trim(), publisher: i.publisher ?? null, date: i.publishedDate ?? null, url: i.url }));

  return {
    ...base,
    oneLiner: withoutProseFigures(base.oneLiner),
    ownership: ownershipLabel(company.ownership),
    founded: company.founded?.year ? String(company.founded.year) : null,
    overview: overviewParagraphs(overview?.markdown),
    keyFigures: view.faceMetrics.filter((m) => m.metric?.value != null || m.metric?.reportedBand != null).map((m) => ({ label: m.label, display: m.display })),
    products: (products?.products ?? []).filter((p) => p.name.trim()).slice(0, 8)
      .map((p) => ({ name: p.name.trim(), description: fitFaceLine(withoutProseFigures(p.description), 200), sourced: false })),
    leaders,
    timeline,
    news,
    risks,
    riskCards: new Set(printedRisks.map((r) => r.cardId)).size,
    culture: cultureCard ? { note: cultureCard.card.summary!.trim(), sources: usableCitations(cultureCard.card.citations ?? []).slice(0, 3).map(source) } : null,
    role: view.type,
    card,
    deckNotes: [],
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

const FACE_SERIES: ReadonlyArray<{ key: OverviewKey; label: string }> = [
  { key: 'company_value', label: 'Valuation / market cap' },
  { key: 'revenue', label: 'Revenue / ARR' },
  { key: 'reach', label: 'Users / customers' },
  { key: 'employees', label: 'Employees' },
];

const normUrl = (url: string) => url.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/#.*$/, '').replace(/\/+$/, '');

/**
 * Deck-wide notes. One number per distinct address; numbering follows the order sources are first registered, which is
 * a fixed walk (companies in name order: figure sources, risks, culture, news; then signals), so it is stable for the same deck.
 */
function buildSourceRegistry() {
  const list: DeckSource[] = [];
  const byKey = new Map<string, number>();
  const note = (s: ReportSource): number => {
    const key = normUrl(s.url);
    let n = byKey.get(key);
    if (!n) { n = list.length + 1; byKey.set(key, n); list.push({ n, title: s.title, publisher: s.title, url: s.url, direct: s.direct }); }
    return n;
  };
  return { list, note, find: (url: string) => byKey.get(normUrl(url)) ?? null };
}

const KIND_OF: Record<string, SignalKind | undefined> = { vice: 'risk', culture: 'culture', barrier: 'barrier', insight: 'insight' };

function viceStored(card: CardWithCompany): SignalBlock {
  const seen = new Set<string>();
  const points: string[] = [];
  const sources: ReportSource[] = [];
  for (const claim of card.viceClaims) {
    const cited = usableCitations(claim.sourceUrl ? [{ url: claim.sourceUrl, title: claim.sourceTitle ?? '' }] : [])[0];
    const text = cited ? once(seen, claim.claimText) : null;
    if (cited && text) { points.push(text); sources.push(source(cited)); }
  }
  return { title: card.card.title?.trim() || 'Risks', summary: null, points, sources };
}

function briefOf(input: SignalBriefInput | undefined, note: (s: ReportSource) => number) {
  if (!input) return null;
  const points: SignalPoint[] = [];
  const seen = new Set<string>();
  for (const p of input.points ?? []) {
    const cites = usableCitations(p.sources ?? []);
    const text = cites.length ? once(seen, p.text) : null;
    if (!text) continue;
    const sources = cites.slice(0, 4).map(source);
    points.push({ text, sources, notes: sources.map(note) });
  }
  if (points.length === 0) return null;
  const own = usableCitations(input.sources ?? []).slice(0, 4).map(source);
  const lead = own.length ? once(new Set<string>(), input.lead) : null;
  return { lead, points, sources: own, notes: own.map(note) };
}

/**
 * The report for a deck. `tabs` is the deck's stored dashboard tabs (the share snapshot carries them); a company
 * without a stored tab simply has no such section. `signalBriefs` (card id to stored brief) is optional.
 */
export function buildFullReport(args: {
  title: string;
  cards: readonly CardWithCompany[];
  tabs: StoredTabs;
  signalBriefs?: SignalBriefsInput | null;
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
  // A barrier or insight with no usable source is dropped, like an unsourced risk or culture note: the PDF never
  // prints a finding it cannot attribute, and the cover never counts one.
  const signals = (type: 'barrier' | 'insight') => args.cards
    .filter((c) => c.card.cardType === type && usableCitations(c.card.citations ?? []).length > 0).map(signalBlock);
  const barriers = signals('barrier');
  const insights = signals('insight');
  // Cards, not claims: a risk card with three printed claims is one signal.
  const riskCount = profiles.reduce((n, c) => n + c.riskCards, 0);
  const cultureCount = profiles.filter((c) => c.culture).length;

  // -- Deck-wide notes, registered in a fixed walk ----------------------------------------------------------------
  const registry = buildSourceRegistry();
  const faceNotes = new Map<string, number[]>();
  for (const c of profiles) {
    faceNotes.set(c.id, c.footnotes.map((f) => registry.note({ title: f.title, url: f.url, direct: f.direct })));
    for (const r of c.risks) registry.note(r.source);
    for (const s of c.culture?.sources ?? []) registry.note(s);
    for (const n of c.news) registry.note({ title: n.publisher ?? publisherOf(n.url, n.title), url: sourceHref(n.url, n.title), direct: isDirectSource(n.url) });
  }

  // -- Signals ------------------------------------------------------------------------------------------------------
  const entries: SignalEntry[] = [];
  for (const c of args.cards) {
    const kind = KIND_OF[c.card.cardType];
    if (!kind) continue;
    const brief = briefOf(args.signalBriefs?.[c.card.id], registry.note);
    const block = kind === 'risk' ? viceStored(c) : signalBlock(c);
    const cited = kind === 'risk' ? block.sources.length > 0 : usableCitations(c.card.citations ?? []).length > 0;
    const storedOk = cited && (kind === 'risk' || !!c.card.summary?.trim() || block.points.length > 0);
    if (brief === null && !storedOk) {
      entries.push({ cardId: c.card.id, kind, printable: false, card: null, companyId: c.company?.id ?? null, brief: null, stored: null });
      continue;
    }
    entries.push({
      cardId: c.card.id, kind, printable: true,
      // A signal is never a company's card: its figures are not carried along.
      card: { ...c, metrics: [] },
      companyId: c.company?.id ?? null,
      brief,
      stored: brief || !storedOk ? null : { ...block, notes: block.sources.map(registry.note) },
    });
  }
  const heldBackByKind: Record<SignalKind, number> = { risk: 0, culture: 0, barrier: 0, insight: 0 };
  for (const e of entries) if (!e.printable) heldBackByKind[e.kind] += 1;
  const heldBack = entries.filter((e) => !e.printable).length;

  // -- Overview series: only what each card face prints ---------------------------------------------------------------
  const overview: OverviewSeries[] = FACE_SERIES.map(({ key, label }) => {
    const series: OverviewEntry[] = profiles.map((c): OverviewEntry => {
      const face = buildCardView(c.card).faceMetrics.find((m) => m.key === key && (m.metric?.value != null || m.metric?.reportedBand != null)
        && (m.citations.length > 0 || m.metric?.confidence === 'user_verified'));
      if (!face || !face.metric) {
        return { companyId: c.id, name: c.name, status: 'unknown', display: null, label: null, value: null, asOf: null, note: null };
      }
      const first = face.citations[0];
      const value = face.metric.value != null && Number.isFinite(face.metric.value) ? face.metric.value : null;
      return {
        companyId: c.id, name: c.name, status: value != null ? 'sourced' : 'range', display: face.display, label: face.label, value,
        asOf: metricAsOf(face.metric), note: first ? registry.find(source(first).url) : null,
      };
    });
    return {
      key, label, entries: series,
      unknown: series.filter((e) => e.status === 'unknown').map((e) => e.name),
      chartable: series.filter((e) => e.status === 'sourced').length >= 2,
    };
  });

  // -- Methods ------------------------------------------------------------------------------------------------------
  const rows = profiles.flatMap((c) => c.rows);
  const methods: MethodsCounts = {
    verified: rows.filter((r) => !r.unknown && (r.confidence === 'verified' || r.confidence === 'user_verified')).length,
    estimated: rows.filter((r) => !r.unknown && r.confidence === 'estimated').length,
    unknown: rows.filter((r) => r.unknown).length,
    signalsPrinted: entries.length - heldBack,
    signalsHeldBack: heldBack,
    unsourcedProfileItems: profiles.reduce((n, c) => n + c.overview.length + c.products.filter((p) => !p.sourced).length
      + c.leaders.filter((l) => !l.sourced).length + c.timeline.filter((t) => !t.sourced).length, 0),
  };

  return {
    ...base,
    companies: profiles.map((c) => ({ ...c, deckNotes: faceNotes.get(c.id) ?? [] })),
    barriers,
    insights,
    marketSignalCount: barriers.length + insights.length,
    signalCount: barriers.length + insights.length + riskCount + cultureCount,
    thin: profiles.every((c) => c.overview.length === 0 && c.products.length === 0 && c.leaders.length === 0 && c.timeline.length === 0 && c.news.length === 0),
    signals: entries,
    signalTally: { printable: entries.length - heldBack, heldBack, heldBackByKind },
    overview,
    methods,
    sources: registry.list,
  };
}
