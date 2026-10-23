/**
 * What the living company report reads: every piece of research the app already holds about one company, turned
 * into a flat list of bounded, attributed passages ("evidence items").
 *
 * Reading is free and never researches: the caller passes what it peeked (stored dashboard tabs, the figures the
 * cards use, the research evidence vault). Nothing here is written from memory and nothing is computed: a figure is
 * quoted as the app shows it, a note is quoted as the user wrote it.
 *
 * The data hash is taken over every gathered passage, so a new note, a corrected figure, a refreshed tab or a fresh
 * story changes it, and the report knows it is behind (the stale indicator). Truncation for the model is by
 * priority: the user's own research first, then figures, then the overview and products, down to news and history.
 */
import {
  METRIC_TYPE_LABELS,
  MONEY_METRIC_TYPES,
  historyContentSchema,
  liveIntelContentSchema,
  metricDefinitionLabel,
  missionGovernanceContentSchema,
  overviewContentSchema,
  productsRoadmapContentSchema,
  publisherOf,
  teamOrgContentSchema,
  usableCitations,
  type Company,
  type CompanyMetric,
  type CompanyReportFigure,
  type CompanyReportSectionId,
  type CompanyReportSourceKind,
  type DashboardTab,
} from '@mi/contracts';
import type { ResearchEvidence } from './research-evidence';
import { parseDigestNote } from './research-document';

/** The tabs a report reads (the figures come from the metrics, not from the Metrics tab). */
export const REPORT_TABS = ['overview', 'products_roadmap', 'team_org', 'history', 'live_intel', 'mission_governance'] as const satisfies readonly DashboardTab[];

const TAB_LABELS: Record<string, string> = {
  overview: 'Overview research',
  products_roadmap: 'Products & Roadmap research',
  team_org: 'Team & Org research',
  history: 'History research',
  live_intel: 'Live intel',
  mission_governance: 'Mission & Governance research',
};

const MAX_ITEM_CHARS = 640;

export interface EvidenceItem {
  /** Stable across runs for the same passage ("overview:2", "note:ev_x"). */
  key: string;
  kind: CompanyReportSourceKind;
  /** The section this passage most naturally belongs to; a hint for the stored-data report and the prompt. */
  section: CompanyReportSectionId;
  /** The tab it came from, or "notes" / "figures" / "chat". */
  origin: string;
  /** Publisher or the research it came from. */
  title: string;
  url: string | null;
  text: string;
  asOf: string | null;
  priority: number;
  /** For a passage worth quoting as it stands (a person's quote, a finding's own words). */
  quote?: { text: string; attribution: string | null };
  /** The user's own: a note, a document digest. */
  userSupplied: boolean;
}

export interface ReportFigureInput extends Omit<CompanyReportFigure, 'citations'> {
  /** The evidence item that carries this figure, so its source can be cited. */
  itemKey: string | null;
}

export interface ReportInputs {
  company: { id: string; name: string; oneLiner: string | null; website: string | null; hq: string | null; founded: number | null };
  items: EvidenceItem[];
  /** Known figures, in order of trust. */
  figures: ReportFigureInput[];
  /** Labels of figure slots that are still unknown. */
  missingFigures: Array<{ metricType: string; label: string }>;
  tabNames: string[];
  noteCount: number;
  dataHash: string;
}

export interface GatherDeps {
  company: Pick<Company, 'id' | 'name' | 'oneLiner' | 'websiteUrl' | 'hqLocation' | 'founded'>;
  tabs: Partial<Record<DashboardTab, { content: unknown; lastRefreshedAt?: string | null } | null>>;
  metrics: readonly CompanyMetric[];
  evidence: readonly ResearchEvidence[];
}

// ---- small helpers ---------------------------------------------------------

/** FNV-1a, 32 bit, as hex: a fingerprint for change detection, not a security boundary. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const bound = (s: string, max = MAX_ITEM_CHARS) => {
  const t = squash(s);
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};
const stripMarkdown = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`#>]/g, '').replace(/^[-•]\s+/, '');
const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u.trim());
const good = (s: string | null | undefined): s is string => typeof s === 'string' && squash(s).length > 0;

const SUFFIXES: Array<[number, string]> = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
function compact(n: number): string {
  for (const [size, s] of SUFFIXES) if (Math.abs(n) >= size) return `${Number((n / size).toFixed(2))}${s}`;
  return String(Number(n.toFixed(2)));
}
/** A figure as the app writes it: money with a `$`, a share with `%`, a count compact. */
export function displayFigure(type: CompanyMetric['metricType'], value: number): string {
  if ((MONEY_METRIC_TYPES as readonly string[]).includes(type)) return `$${compact(value)}`;
  if (type === 'market_share') return `${Number(value.toFixed(2))}%`;
  return compact(value);
}

const asOfOf = (m: CompanyMetric): string | null =>
  m.passageSupport?.asOf || m.reportedSupport?.asOf || m.quotedSupport?.asOf || null;

function figureLabel(m: CompanyMetric): string {
  return metricDefinitionLabel(m) ?? METRIC_TYPE_LABELS[m.metricType] ?? m.metricType;
}

/** A figure the report may state: a value with a usable source, or a value a person confirmed. */
function statable(m: CompanyMetric): m is CompanyMetric & { value: number } {
  if (m.confidence === 'unknown' || m.value == null || !Number.isFinite(m.value)) return false;
  return m.confidence === 'user_verified' || usableCitations(m.citations ?? []).length > 0;
}

// ---- per-tab readers -------------------------------------------------------

type Push = (item: Omit<EvidenceItem, 'userSupplied'> & { userSupplied?: boolean }) => void;

/** One overview paragraph: its prose, and the links of the attribution line that closes it. */
function splitParagraph(block: string): { text: string; urls: Array<{ title: string; url: string }> } {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  const urls: Array<{ title: string; url: string }> = [];
  while (lines.length) {
    const last = lines[lines.length - 1]!;
    const tokens = [...last.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((m) => ({ title: m[1]!, url: m[2]! }));
    if (!tokens.length || last.replace(/\[[^\]]+\]\([^)]+\)/g, '').replace(/·/g, '').trim()) break;
    urls.unshift(...tokens);
    lines.pop();
  }
  return { text: stripMarkdown(lines.join(' ')), urls };
}

function overviewSection(title: string): CompanyReportSectionId {
  const t = title.toLowerCase();
  if (t.includes('product') || t.includes('service')) return 'what_they_do';
  if (t.includes('market') || t.includes('customer') || t.includes('distribution')) return 'market_position';
  return 'executive_summary';
}

function readOverview(content: unknown, push: Push): void {
  const parsed = overviewContentSchema.safeParse(content);
  if (!parsed.success) return;
  let section = 'source-reported background';
  let n = 0;
  for (const block of parsed.data.markdown.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const kept: string[] = [];
    for (const line of lines) {
      const heading = line.match(/^##\s+(.+)$/);
      if (heading) { section = heading[1]!.trim(); continue; }
      // "- Label: value — attribution" figure bullets are the figures' job, not prose.
      if (/^-\s+.+:\s.+\s—\s/.test(line)) continue;
      kept.push(line);
    }
    const { text, urls } = splitParagraph(kept.join('\n'));
    if (text.length < 30) continue;
    const first = urls.find((u) => isHttp(u.url));
    push({
      key: `overview:${n}`, kind: first ? 'web' : 'stored', section: overviewSection(section), origin: 'overview',
      title: first ? publisherOf(first.url, first.title) : TAB_LABELS.overview!, url: first?.url ?? null,
      text: bound(text), asOf: null, priority: 80 - Math.min(n, 12) * 0.5,
    });
    n += 1;
    if (n >= 14) break;
  }
}

function readProducts(content: unknown, push: Push): void {
  const parsed = productsRoadmapContentSchema.safeParse(content);
  if (!parsed.success) return;
  parsed.data.products.slice(0, 12).forEach((p, i) => {
    if (!good(p.name)) return;
    const bits = [`Product: ${p.name}${p.status ? ` (${p.status})` : ''}.`, good(p.description) ? p.description : '', good(p.revenueNote) ? `Revenue note: ${p.revenueNote}` : ''];
    push({
      key: `product:${i}`, kind: isHttp(p.url) ? 'web' : 'stored', section: 'what_they_do', origin: 'products_roadmap',
      title: isHttp(p.url) ? publisherOf(p.url) : TAB_LABELS.products_roadmap!, url: isHttp(p.url) ? p.url : null,
      text: bound(bits.filter(Boolean).join(' ')), asOf: null, priority: 70 - i * 0.3,
    });
  });
  parsed.data.roadmap.slice(0, 8).forEach((r, i) => {
    if (!good(r.title)) return;
    push({
      key: `roadmap:${i}`, kind: 'stored', section: 'momentum', origin: 'products_roadmap', title: TAB_LABELS.products_roadmap!, url: null,
      text: bound(`Roadmap (${r.horizon}): ${r.title}${good(r.detail) ? ` — ${r.detail}` : ''}${good(r.date) ? ` (${r.date})` : ''}`),
      asOf: good(r.date) ? r.date : null, priority: 45 - i * 0.2,
    });
  });
  (parsed.data.relationships ?? []).slice(0, 8).forEach((r, i) => {
    if (!good(r.quote)) return;
    push({
      key: `relationship:${i}`, kind: isHttp(r.sourceUrl) ? 'web' : 'stored', section: 'market_position', origin: 'products_roadmap',
      title: isHttp(r.sourceUrl) ? publisherOf(r.sourceUrl, r.sourceTitle) : TAB_LABELS.products_roadmap!, url: isHttp(r.sourceUrl) ? r.sourceUrl : null,
      text: bound(`${r.kind[0]!.toUpperCase()}${r.kind.slice(1)} relationship with ${r.name}: ${r.quote}`), asOf: null, priority: 60 - i * 0.2,
      quote: { text: r.quote, attribution: null },
    });
  });
}

function readTeam(content: unknown, push: Push): void {
  const parsed = teamOrgContentSchema.safeParse(content);
  if (!parsed.success) return;
  (parsed.data as { nodes: Array<Record<string, unknown>> }).nodes.slice(0, 12).forEach((raw, i) => {
    const n = raw as { name: string; role: string; bio: string; tenure?: string | null; priorCompany?: string | null; notableProject?: string | null; sourceUrl?: string | null; isFounder?: boolean };
    if (!good(n.name)) return;
    const bits = [`${n.name}${good(n.role) ? `, ${n.role}` : ''}${n.isFounder ? ' (founder)' : ''}.`, good(n.bio) ? n.bio : '',
      good(n.tenure) ? `Tenure: ${n.tenure}.` : '', good(n.priorCompany) ? `Previously: ${n.priorCompany}.` : '', good(n.notableProject) ? `Known for: ${n.notableProject}.` : ''];
    push({
      key: `team:${i}`, kind: isHttp(n.sourceUrl) ? 'web' : 'stored', section: 'leadership_culture', origin: 'team_org',
      title: isHttp(n.sourceUrl) ? publisherOf(n.sourceUrl) : TAB_LABELS.team_org!, url: isHttp(n.sourceUrl) ? n.sourceUrl : null,
      text: bound(bits.filter(Boolean).join(' ')), asOf: null, priority: 65 - i * 0.3,
    });
  });
}

function readHistory(content: unknown, push: Push): void {
  const parsed = historyContentSchema.safeParse(content);
  if (!parsed.success) return;
  if (good(parsed.data.founderStory)) {
    push({ key: 'history:story', kind: 'stored', section: 'leadership_culture', origin: 'history', title: TAB_LABELS.history!, url: null, text: bound(parsed.data.founderStory, 700), asOf: null, priority: 42 });
  }
  const timeline = [...parsed.data.timeline].filter((e) => good(e.title)).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 10);
  timeline.forEach((e, i) => {
    push({
      key: `timeline:${i}`, kind: isHttp(e.sourceUrl) ? 'web' : 'stored', section: 'momentum', origin: 'history',
      title: isHttp(e.sourceUrl) ? publisherOf(e.sourceUrl) : TAB_LABELS.history!, url: isHttp(e.sourceUrl) ? e.sourceUrl : null,
      text: bound(`${e.date ? `${e.date}: ` : ''}${e.title}${good(e.detail) ? ` — ${e.detail}` : ''}`), asOf: good(e.date) ? String(e.date) : null, priority: 55 - i * 0.3,
    });
  });
  parsed.data.quotes.slice(0, 4).forEach((q, i) => {
    if (!good(q.text)) return;
    push({
      key: `quote:${i}`, kind: isHttp(q.sourceUrl) ? 'web' : 'stored', section: 'leadership_culture', origin: 'history',
      title: isHttp(q.sourceUrl) ? publisherOf(q.sourceUrl, q.sourceTitle) : TAB_LABELS.history!, url: isHttp(q.sourceUrl) ? q.sourceUrl : null,
      text: bound(`“${q.text}”${good(q.attribution) ? ` — ${q.attribution}` : ''}`), asOf: good(q.date) ? q.date : null, priority: 46 - i * 0.2,
      quote: { text: q.text, attribution: good(q.attribution) ? q.attribution : null },
    });
  });
}

function readLiveIntel(content: unknown, push: Push): void {
  const parsed = liveIntelContentSchema.safeParse(content);
  if (!parsed.success) return;
  const items = [...parsed.data.items].filter((i) => good(i.title))
    .sort((a, b) => String(b.publishedDate ?? b.publishedAt).localeCompare(String(a.publishedDate ?? a.publishedAt))).slice(0, 10);
  items.forEach((s, i) => {
    const when = s.publishedDate ?? null;
    push({
      key: `news:${s.id || i}`, kind: isHttp(s.url) ? 'web' : 'stored', section: 'momentum', origin: 'live_intel',
      title: publisherOf(s.url, s.publisher), url: isHttp(s.url) ? s.url : null,
      text: bound(`${s.title}${good(s.summary) ? ` — ${s.summary}` : ''}${when ? ` (${when})` : ''}`), asOf: when, priority: 50 - i * 0.3,
    });
  });
}

function readGovernance(content: unknown, push: Push): void {
  const parsed = missionGovernanceContentSchema.safeParse(content);
  if (!parsed.success) return;
  const g = parsed.data;
  const label = TAB_LABELS.mission_governance!;
  if (good(g.mission)) push({ key: 'gov:mission', kind: 'stored', section: 'leadership_culture', origin: 'mission_governance', title: label, url: null, text: bound(`Mission: ${g.mission}`), asOf: null, priority: 48 });
  if (good(g.ethos)) push({ key: 'gov:ethos', kind: 'stored', section: 'leadership_culture', origin: 'mission_governance', title: label, url: null, text: bound(`Ethos: ${g.ethos}`), asOf: null, priority: 44 });
  if (good(g.governanceStructure)) push({ key: 'gov:structure', kind: 'stored', section: 'leadership_culture', origin: 'mission_governance', title: label, url: null, text: bound(`Governance: ${g.governanceStructure}`), asOf: null, priority: 44 });
  g.positives.slice(0, 4).forEach((t, i) => good(t) && push({ key: `gov:pos:${i}`, kind: 'stored', section: 'leadership_culture', origin: 'mission_governance', title: label, url: null, text: bound(`Reported strength: ${t}`), asOf: null, priority: 43 - i * 0.2 }));
  g.negatives.slice(0, 5).forEach((t, i) => good(t) && push({ key: `gov:neg:${i}`, kind: 'stored', section: 'risks', origin: 'mission_governance', title: label, url: null, text: bound(`Reported concern: ${t}`), asOf: null, priority: 56 - i * 0.2 }));
  g.fundingRounds.slice(0, 5).forEach((r, i) => {
    if (!good(r.round)) return;
    const amount = r.amountUsd != null && Number.isFinite(r.amountUsd) ? ` of ${displayFigure('valuation', r.amountUsd)}` : '';
    const leads = r.leadInvestors.filter(good).slice(0, 3).join(', ');
    push({
      key: `funding:${i}`, kind: isHttp(r.sourceUrl) ? 'web' : 'stored', section: 'business_model', origin: 'mission_governance',
      title: isHttp(r.sourceUrl) ? publisherOf(r.sourceUrl) : label, url: isHttp(r.sourceUrl) ? r.sourceUrl : null,
      text: bound(`Funding round: ${r.round}${amount}${good(r.date) ? ` (${r.date})` : ''}${leads ? `, led by ${leads}` : ''}.`), asOf: good(r.date) ? r.date : null, priority: 60 - i * 0.2,
    });
  });
}

function readMetrics(metrics: readonly CompanyMetric[], push: Push): { figures: ReportFigureInput[]; missing: Array<{ metricType: string; label: string }> } {
  const rank: Record<string, number> = { user_verified: 3, verified: 2, estimated: 1 };
  const figures: ReportFigureInput[] = [];
  const missing: Array<{ metricType: string; label: string }> = [];
  const seen = new Set<string>();
  const ordered = [...metrics].sort((a, b) => (rank[b.confidence] ?? 0) - (rank[a.confidence] ?? 0));
  for (const m of ordered) {
    const label = figureLabel(m);
    if (statable(m)) {
      const cites = usableCitations(m.citations ?? []);
      const key = `figure:${m.metricType}:${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const display = displayFigure(m.metricType, m.value);
      const asOf = asOfOf(m);
      const trust = m.confidence === 'user_verified' ? 'user_verified' : m.confidence === 'verified' ? 'verified' : 'estimated';
      figures.push({ metricType: m.metricType, label, display, trust, asOf, itemKey: figures.length < 14 ? key : null });
      if (figures.length <= 14) {
        const first = cites[0];
        push({
          key, kind: 'figure', section: 'business_model', origin: 'figures', title: first ? publisherOf(first.url, first.title) : 'Confirmed by a person',
          url: first?.url ?? null, text: `${label}: ${display} (${trust === 'user_verified' ? 'confirmed by you' : trust}${asOf ? `, as of ${asOf}` : ''})`, asOf, priority: 90,
        });
      }
    } else if (!missing.some((x) => x.label === label) && missing.length < 6) missing.push({ metricType: m.metricType, label });
  }
  // A slot a known figure already answers is not a gap.
  const known = new Set(figures.map((f) => f.label));
  return { figures, missing: missing.filter((x) => !known.has(x.label)) };
}

// ---- the user's own research and chat evidence ------------------------------

const DOC_HEAD = /^\[Provided by you: (.+?)(?:, part \d+ of \d+)?\]\n/;

function readEvidence(evidence: readonly ResearchEvidence[], push: Push): number {
  let notes = 0;
  const userNotes = evidence.filter((e) => e.topic === 'user_note' && good(e.text));
  const digested = new Set<string>();
  for (const e of userNotes) { const d = parseDigestNote(e.text); if (d) digested.add(d.title.toLowerCase()); }
  userNotes.forEach((e) => {
    const digest = parseDigestNote(e.text);
    const sourceUrl = usableCitations(e.citations ?? [])[0]?.url ?? null;
    const when = e.capturedAt?.slice(0, 10) ?? null;
    const base = { kind: 'note' as const, section: 'your_research' as const, origin: 'notes', url: sourceUrl, asOf: when, userSupplied: true };
    if (digest) {
      const title = `Your document: ${digest.title}`;
      if (digest.summary) { push({ ...base, key: `note:${e.id}:summary`, title, text: bound(`Summary of your document "${digest.title}": ${digest.summary}`), priority: 100 }); notes += 1; }
      digest.findings.slice(0, 8).forEach((f, i) => {
        push({ ...base, key: `note:${e.id}:f${i}`, title, text: bound(`${f.claim} (your document quotes: “${f.quote}”)`), priority: 98 - i * 0.2, quote: { text: f.quote, attribution: `Your document: ${digest.title}` } });
        notes += 1;
      });
      digest.figures.slice(0, 6).forEach((f, i) => { push({ ...base, key: `note:${e.id}:g${i}`, title, text: bound(`Figure stated in your document: ${f.line}`), priority: 97 - i * 0.2 }); notes += 1; });
      return;
    }
    const doc = DOC_HEAD.exec(e.text);
    if (doc) {
      // A pasted document is represented by its digest; only one with no digest is read from its opening, and only its first piece.
      const part = /^\[Provided by you: .+?, part (\d+) of \d+\]/.exec(e.text);
      if (digested.has(doc[1]!.toLowerCase()) || (part && part[1] !== '1')) return;
      push({ ...base, key: `note:${e.id}`, title: `Your document: ${doc[1]}`, text: bound(`From your document "${doc[1]}": ${e.text.slice(doc[0].length)}`, 520), priority: 72 });
      notes += 1;
      return;
    }
    push({ ...base, key: `note:${e.id}`, title: 'Your note', text: bound(e.text, 520), priority: 100 });
    notes += 1;
  });

  [...evidence].filter((e) => (e.topic.startsWith('chat:') || e.topic.startsWith('report:')) && good(e.text))
    .sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt))).slice(0, 8).forEach((e, i) => {
      const cite = usableCitations(e.citations ?? [])[0];
      push({
        key: `chat:${e.id}`, kind: cite ? 'web' : 'stored', section: 'momentum', origin: 'chat', title: cite ? publisherOf(cite.url, cite.title) : 'Earlier research chat',
        url: cite?.url ?? null, text: bound(stripMarkdown(e.text), 500), asOf: e.capturedAt?.slice(0, 10) ?? null, priority: 40 - i * 0.2,
      });
    });
  return notes;
}

// ---- the public entry points ------------------------------------------------

export function gatherReportInputs(deps: GatherDeps): ReportInputs {
  const items: EvidenceItem[] = [];
  const push: Push = (item) => { if (good(item.text)) items.push({ userSupplied: false, ...item }); };

  const tabNames: string[] = [];
  const readers: Record<(typeof REPORT_TABS)[number], (content: unknown, push: Push) => void> = {
    overview: readOverview, products_roadmap: readProducts, team_org: readTeam, history: readHistory, live_intel: readLiveIntel, mission_governance: readGovernance,
  };
  for (const tab of REPORT_TABS) {
    const stored = deps.tabs[tab];
    if (!stored) continue;
    const before = items.length;
    readers[tab](stored.content, push);
    if (items.length > before) tabNames.push(tab);
  }
  const description = deps.company.oneLiner?.trim();
  const usableDescription = description && !/^No source-backed company snapshot/i.test(description) ? description : null;
  if (usableDescription) push({ key: 'company:summary', kind: 'stored', section: 'executive_summary', origin: 'overview', title: 'Company profile', url: null, text: bound(usableDescription), asOf: null, priority: 85 });
  const { figures, missing } = readMetrics(deps.metrics, push);
  const noteCount = readEvidence(deps.evidence, push);

  const hash = fingerprint(items.map((i) => `${i.key}\u0001${i.text}\u0001${i.url ?? ''}`).join('\u0002') + `\u0003${usableDescription ?? ''}`);
  return {
    company: {
      id: deps.company.id, name: deps.company.name, oneLiner: usableDescription, website: deps.company.websiteUrl ?? null,
      hq: deps.company.hqLocation ?? null, founded: deps.company.founded?.year ?? null,
    },
    items, figures, missingFigures: missing, tabNames, noteCount, dataHash: hash,
  };
}

export interface NumberedItem extends EvidenceItem { id: string }

/**
 * The passages the report will read, in a stable order with ids ("s1"…). When there are more than the bound, the
 * highest priority wins (the user's own research first); the order of the rest is the order they were gathered in.
 */
export function selectEvidence(items: readonly EvidenceItem[], bounds: { maxItems?: number; maxChars?: number } = {}): NumberedItem[] {
  const maxItems = bounds.maxItems ?? Number.POSITIVE_INFINITY;
  const maxChars = bounds.maxChars ?? Number.POSITIVE_INFINITY;
  const byPriority = items.map((item, index) => ({ item, index })).sort((a, b) => b.item.priority - a.item.priority || a.index - b.index);
  const kept: Array<{ item: EvidenceItem; index: number }> = [];
  let chars = 0;
  for (const row of byPriority) {
    if (kept.length >= maxItems) break;
    if (chars + row.item.text.length > maxChars) continue;
    kept.push(row);
    chars += row.item.text.length;
  }
  kept.sort((a, b) => a.index - b.index);
  return kept.map((row, i) => ({ ...row.item, id: `s${i + 1}` }));
}
