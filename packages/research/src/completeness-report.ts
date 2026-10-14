/**
 * Deck completeness scoreboard — makes "how complete are our decks?" a number,
 * so the pipeline's PROCESSES get fixed instead of individual decks.
 *
 * A pure function over a repository snapshot (the RepoSnapshot the web app and
 * desktop app persist). For every entity company in every deck it reports each
 * slot the product shows as one of:
 *
 *   filled                   the user sees a value
 *   unknown_attempted        empty, and the snapshot shows research tried it
 *   unknown_never_attempted  empty, and nothing in the snapshot ever tried it
 *
 * plus the receipts behind each attempt (original-source reads by status,
 * retained research-evidence records, a cached dashboard tab, stored ledger
 * rows), so "never tried" is told apart from "tried, nothing found".
 *
 * What counts as "filled" is not re-derived here:
 *  - metric slots and their applicability come from PROFILE_CORE_SLOTS and
 *    classifyMarketProfile (the same table the card face renders and the
 *    readiness pass hunts), evaluated by computeCompanyCompleteness over the
 *    DISPLAYED facts (displayedCompanyFacts — the getCompanyFacts read path);
 *  - signal cards (culture, vice, insight, barrier) never own metrics and are
 *    not scored (Rule 9);
 *  - the description is the company as getCompany serves it (savedCompanySummary)
 *    and a pending placeholder is not a description (isPendingCompanySummary).
 *
 * Nothing here proposes, estimates or defaults a value. It only names gaps and
 * integrity smells.
 */
import {
  METRIC_TYPE_LABELS,
  PROFILE_CORE_SLOTS,
  classifyMarketProfile,
  currentMetricRevision,
  hasVerificationGradeCitation,
  isEntityCardType,
  type Card,
  type CardType,
  type Company,
  type CompanyMetric,
  type DashboardTab,
  type Deck,
  type Market,
  type MarketProfile,
  type MetricType,
} from '@mi/contracts';
import { computeCompanyCompleteness } from './completeness';
import { isPendingCompanySummary } from './company-summary';
import { displayedCompanyFacts } from './displayed-facts';
import type { OriginalSourceAttempt } from './original-source';
import type { ResearchEvidence } from './research-evidence';
import { savedCompanySummary } from './saved-profile';
import type { SourceChecks } from './source-binding';

// ---------------------------------------------------------------------------
// Input: a tolerant structural subset of RepoSnapshot (exports can be old).
// ---------------------------------------------------------------------------

export interface CompletenessSnapshot {
  markets?: Market[];
  decks?: Deck[];
  companies?: Company[];
  metrics?: CompanyMetric[];
  cards?: Card[];
  dashboards?: Record<string, Partial<Record<DashboardTab, { content?: unknown; lastRefreshedAt?: string } | undefined>>>;
  companyMarket?: Record<string, string>;
  researchEvidence?: ResearchEvidence[];
  originalSourceAttempts?: OriginalSourceAttempt[];
  sourceChecks?: SourceChecks;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type SlotStatus = 'filled' | 'unknown_attempted' | 'unknown_never_attempted';
export type SlotGroup = 'identity' | 'description' | 'metric' | 'team' | 'history' | 'products' | 'news';

export interface SlotAttempts {
  /** At least one attempt aimed at THIS slot (not just a broad profile pass). */
  targeted: boolean;
  /** originalSourceAttempts records (each holds up to two page reads). */
  originalAttempts: number;
  /** Page reads inside those attempts, by outcome. */
  receipts: { retrieved: number; blocked: number; unavailable: number };
  /** Retained grounded research-evidence records on a relevant topic. */
  evidenceRecords: number;
  /** A researched dashboard tab for this slot is cached (even if empty). */
  cachedTab: boolean;
  /** Stored metric-ledger rows for this slot's types (any confidence). */
  storedRows: number;
  /** Distinct topics the attempts came from, e.g. "employees", "company_profile". */
  topics: string[];
}

export interface SlotReport {
  key: string;
  group: SlotGroup;
  label: string;
  status: SlotStatus;
  /** Short human rendering of what fills it ("employees 1,200 (verified)"). */
  value: string | null;
  /** Why an empty slot is empty, when the data says ("stored figure withheld: …"). */
  note: string | null;
  /** Empty on screen although the ledger stores a value: research found it, the read path refused it. */
  withheld: boolean;
  attempts: SlotAttempts;
}

export interface CompanyCompletenessReport {
  companyId: string;
  name: string;
  cardTypes: CardType[];
  profile: MarketProfile;
  slots: SlotReport[];
  filled: number;
  total: number;
}

export interface SlotAggregate {
  key: string;
  label: string;
  group: SlotGroup;
  applicable: number;
  filled: number;
  unknownAttempted: number;
  unknownNeverAttempted: number;
  /** Unfilled companies that never had an attempt aimed at this slot. */
  neverTargeted: number;
  /** Unfilled companies whose ledger holds a value the read path withholds. */
  withheld: number;
  /** filled / applicable, 0..100, one decimal. */
  fillPct: number;
}

export interface Totals {
  slots: number;
  filled: number;
  unknownAttempted: number;
  unknownNeverAttempted: number;
  fillPct: number;
}

export interface DeckCompletenessReport {
  deckId: string;
  marketId: string;
  marketName: string;
  companies: CompanyCompletenessReport[];
  totals: Totals;
  bySlot: SlotAggregate[];
}

export interface CompletenessGap extends SlotAggregate {
  /** Companies left without this slot (attempted + never attempted). */
  companiesAffected: number;
}

export type IntegritySmellKind =
  | 'stored_figure_without_citation'
  | 'verified_without_verification_grade_citation'
  | 'unknown_with_value'
  | 'estimated_without_date'
  | 'identical_value_across_companies'
  | 'description_sales_verb'
  | 'description_spacing'
  | 'hq_format_inconsistent';

export interface IntegritySmell {
  kind: IntegritySmellKind;
  deckId: string;
  companyIds: string[];
  companyNames: string[];
  metricType?: MetricType;
  /** True when the smelly figure/text reaches the user (else only the ledger holds it). */
  displayed: boolean;
  detail: string;
}

export interface CompletenessReport {
  /** Unique entity companies scored across all decks. */
  companies: number;
  decks: DeckCompletenessReport[];
  /** Per slot across decks, each company counted once. */
  bySlot: SlotAggregate[];
  totals: Totals;
  /** Unfilled slots ranked by how many companies they affect. */
  topGaps: CompletenessGap[];
  smells: IntegritySmell[];
  smellCounts: Partial<Record<IntegritySmellKind, number>>;
  /** Caveats about what this snapshot can and cannot show. */
  caveats: string[];
}

// ---------------------------------------------------------------------------
// Slot definitions
// ---------------------------------------------------------------------------

/** Broad passes that ask for every profile metric at once (hydration, hunts). */
const BROAD_METRIC_TOPICS = new Set(['company_profile', 'metrics_hunt', 'verify:batch']);

interface SlotDef {
  key: string;
  group: SlotGroup;
  label: string;
  /** Topic → 'targeted' | 'broad' | null for this slot. */
  relevance: (topic: string) => 'targeted' | 'broad' | null;
  /** Dashboard tab whose cache counts as an attempt. */
  tab?: DashboardTab;
  /** Metric types whose ledger rows count as an attempt. */
  metricTypes?: readonly MetricType[];
}

const topicIs = (targeted: readonly string[], broad: readonly string[] = []) => (topic: string) =>
  targeted.includes(topic) ? 'targeted' as const : broad.includes(topic) ? 'broad' as const : null;

const IDENTITY_SLOTS: SlotDef[] = [
  { key: 'identity.website', group: 'identity', label: 'Website', relevance: topicIs(['company_profile'], ['overview']) },
  { key: 'identity.hq', group: 'identity', label: 'HQ', relevance: topicIs(['company_profile'], ['overview']) },
  { key: 'identity.founded', group: 'identity', label: 'Founded', relevance: topicIs(['history'], ['company_profile', 'overview']), tab: 'history' },
  { key: 'description', group: 'description', label: 'Description', relevance: topicIs(['company_profile'], ['overview']), tab: 'overview' },
];

const TAIL_SLOTS: SlotDef[] = [
  { key: 'team', group: 'team', label: 'Team', relevance: topicIs(['team_org']), tab: 'team_org' },
  { key: 'history', group: 'history', label: 'History', relevance: topicIs(['history']), tab: 'history' },
  { key: 'products', group: 'products', label: 'Products', relevance: topicIs(['products_roadmap']), tab: 'products_roadmap' },
  { key: 'news', group: 'news', label: 'News', relevance: topicIs(['live_intel', 'news']), tab: 'live_intel' },
];

function metricSlotDef(slot: readonly MetricType[]): SlotDef {
  return {
    key: `metric.${slot.join('|')}`,
    group: 'metric',
    label: slot.map((type) => METRIC_TYPE_LABELS[type]).join(' / '),
    metricTypes: slot,
    relevance: (topic) => slot.some((type) => topic === type || topic === `verify:${type}`) ? 'targeted'
      : BROAD_METRIC_TOPICS.has(topic) ? 'broad' : null,
  };
}

/** Every slot a company of this profile is scored on, in display order. */
export function completenessSlotsFor(profile: MarketProfile): Array<{ key: string; group: SlotGroup; label: string }> {
  return [...IDENTITY_SLOTS, ...PROFILE_CORE_SLOTS[profile].map(metricSlotDef), ...TAIL_SLOTS]
    .map(({ key, group, label }) => ({ key, group, label }));
}

// ---------------------------------------------------------------------------
// Cached tab readers (tolerant: content shapes are model output)
// ---------------------------------------------------------------------------

const arrayAt = (content: unknown, field: string): unknown[] => {
  if (Array.isArray(content) && field === 'nodes') return content; // bare team list (teamOrgContentSchema preprocess)
  const value = content && typeof content === 'object' ? (content as Record<string, unknown>)[field] : undefined;
  return Array.isArray(value) ? value.filter((row) => row && typeof row === 'object') : [];
};

/** Mirrors apps/web dashboard/snapshot.ts foundedYear: the earliest dated
 * timeline event whose own words describe a founding. */
const FOUNDING = /\b(?:founded|co-?founded|incorporated|established|launched (?:as|the company)|was (?:started|formed|created)|started operations)\b/i;
function foundedYearOf(timeline: unknown[]): number | null {
  const years = timeline.flatMap((row) => {
    const event = row as { title?: unknown; detail?: unknown; date?: unknown };
    if (!FOUNDING.test(`${String(event.title ?? '')} ${String(event.detail ?? '')}`)) return [];
    const year = /\b(1[6-9]\d{2}|20\d{2})\b/.exec(String(event.date ?? ''));
    return year ? [Number(year[1])] : [];
  });
  return years.length ? Math.min(...years) : null;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const pct = (part: number, whole: number) => whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;

function formatFigure(metric: CompanyMetric): string {
  const value = metric.value != null
    ? metric.value.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : metric.reportedBand ? `${metric.reportedBand.low}-${metric.reportedBand.high}` : 'null';
  return `${METRIC_TYPE_LABELS[metric.metricType]} ${value} (${metric.confidence})`;
}

function asOfOf(metric: CompanyMetric): string | null {
  return metric.passageSupport?.asOf || metric.reportedSupport?.asOf || metric.quotedSupport?.asOf ||
    metric.reportedBand?.asOf || null;
}

const SALES_VERB = /^\s*(?:discover|shop|buy|explore|get|find|experience|unlock|try|join|book|order|save|start|learn|meet|browse|sign up|welcome to|elevate|transform|empower)\b/i;
const BAD_SPACING = /\s[.,;:!?](?:\s|$)/;

/** A coarse HQ shape: part count plus whether the last part is a short code ("CA", "UK"). */
function hqFormat(hq: string): string {
  const parts = hq.split(',').map((part) => part.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  return `${parts.length}-part${parts.length > 1 && /^[A-Z]{2,3}$/.test(last) ? ' (code)' : parts.length > 1 ? ' (name)' : ''}`;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

interface CompanyContext {
  attempts: OriginalSourceAttempt[];
  evidence: ResearchEvidence[];
  rows: CompanyMetric[];
  tabs: Partial<Record<DashboardTab, { content?: unknown } | undefined>>;
}

function slotAttempts(def: SlotDef, ctx: CompanyContext): SlotAttempts {
  const out: SlotAttempts = { targeted: false, originalAttempts: 0, receipts: { retrieved: 0, blocked: 0, unavailable: 0 },
    evidenceRecords: 0, cachedTab: false, storedRows: 0, topics: [] };
  const topics = new Set<string>();
  for (const attempt of ctx.attempts) {
    const relevance = def.relevance(attempt.metricType);
    if (!relevance) continue;
    out.originalAttempts += 1;
    if (relevance === 'targeted') out.targeted = true;
    topics.add(attempt.metricType);
    for (const receipt of attempt.receipts ?? []) {
      if (receipt?.status === 'retrieved' || receipt?.status === 'blocked' || receipt?.status === 'unavailable') out.receipts[receipt.status] += 1;
    }
  }
  for (const record of ctx.evidence) {
    const relevance = def.relevance(record.topic);
    if (!relevance) continue;
    out.evidenceRecords += 1;
    if (relevance === 'targeted') out.targeted = true;
    topics.add(record.topic);
  }
  if (def.tab && ctx.tabs[def.tab]) {
    out.cachedTab = true;
    // The founded slot reads the history tab, but a history pass is aimed at it.
    out.targeted = true;
    topics.add(`tab:${def.tab}`);
  }
  if (def.metricTypes) {
    out.storedRows = ctx.rows.filter((row) => def.metricTypes!.includes(row.metricType)).length;
    if (out.storedRows > 0) { out.targeted = true; topics.add('ledger'); }
  }
  out.topics = [...topics].sort();
  return out;
}

const attempted = (a: SlotAttempts) => a.originalAttempts > 0 || a.evidenceRecords > 0 || a.cachedTab || a.storedRows > 0;

function scoreCompany(company: Company, cardTypes: CardType[], snap: Required<Pick<CompletenessSnapshot,
  'metrics' | 'researchEvidence' | 'originalSourceAttempts' | 'dashboards' | 'companyMarket' | 'companies'>> & Pick<CompletenessSnapshot, 'sourceChecks'>,
): { report: CompanyCompletenessReport; facts: CompanyMetric[]; shown: Company } {
  const ctx: CompanyContext = {
    attempts: snap.originalSourceAttempts.filter((row) => row?.companyId === company.id),
    evidence: snap.researchEvidence.filter((row) => row?.companyId === company.id),
    rows: snap.metrics.filter((row) => row?.companyId === company.id),
    tabs: snap.dashboards[company.id] ?? {},
  };
  const marketId = snap.companyMarket[company.id];
  const otherCompanies = marketId === undefined ? undefined : snap.companies
    .filter((row) => row.id !== company.id && snap.companyMarket[row.id] === marketId).map((row) => row.name);
  const facts = displayedCompanyFacts({ company, metrics: ctx.rows, attempts: ctx.attempts, evidence: snap.researchEvidence,
    otherCompanies, sourceChecks: snap.sourceChecks });
  // The company as getCompany serves it: a saved profile may replace a placeholder one-liner.
  const shown = savedCompanySummary(company, snap.researchEvidence);
  const profile = classifyMarketProfile(shown);
  const readiness = computeCompanyCompleteness({ companyId: company.id, name: company.name, metrics: facts, profile });

  const content = (tab: DashboardTab) => ctx.tabs[tab]?.content;
  const timeline = arrayAt(content('history'), 'timeline');
  const founded = foundedYearOf(timeline);
  const teamCount = arrayAt(content('team_org'), 'nodes').length;
  const productCount = arrayAt(content('products_roadmap'), 'products').length;
  const newsCount = arrayAt(content('live_intel'), 'items').length;

  const defs = [...IDENTITY_SLOTS, ...PROFILE_CORE_SLOTS[profile].map(metricSlotDef), ...TAIL_SLOTS];
  const slots = defs.map((def): SlotReport => {
    let value: string | null = null;
    let note: string | null = null;
    let withheldValue = false;
    switch (def.key) {
      case 'identity.website': value = company.websiteUrl?.trim() || null; break;
      case 'identity.hq': value = company.hqLocation?.trim() || null; break;
      case 'identity.founded':
        value = founded != null ? `${founded} (history tab)` : null;
        if (value == null) note = 'Snapshot holds no founding event; the live header may still show a Wikidata year.';
        break;
      case 'description': value = isPendingCompanySummary(shown.oneLiner) ? null : shown.oneLiner.trim(); break;
      case 'team': value = teamCount > 0 ? `${teamCount} people` : null; break;
      case 'history': value = timeline.length > 0 ? `${timeline.length} events` : null; break;
      case 'products': value = productCount > 0 ? `${productCount} products` : null; break;
      case 'news': value = newsCount > 0 ? `${newsCount} items` : null; break;
      default: {
        const types = def.metricTypes!;
        const gap = readiness.gaps.find((g) => types.includes(g.metricType));
        if (!gap) {
          const fill = facts.find((m) => types.includes(m.metricType) && (m.value != null || m.reportedBand != null) && m.confidence !== 'unknown');
          value = fill ? formatFigure(fill) : 'filled';
        } else {
          // A stored figure that the read path withholds is the most actionable gap:
          // research FOUND something, the gate refused it.
          const withheld = types.map((type) => currentMetricRevision(ctx.rows, company.id, type)?.metric)
            .find((m) => m != null && m.value != null && m.confidence !== 'unknown');
          const shownRow = withheld && facts.find((m) => m.metricType === withheld.metricType && m.methodNote);
          withheldValue = withheld != null;
          note = withheld ? `Stored ${formatFigure(withheld)} withheld: ${shownRow?.methodNote ?? 'not accepted by the facts projection.'}`
            : gap.state === 'unknown' ? 'Ledger row is Unknown.' : null;
        }
      }
    }
    const attempts = slotAttempts(def, ctx);
    const status: SlotStatus = value != null ? 'filled' : attempted(attempts) ? 'unknown_attempted' : 'unknown_never_attempted';
    return { key: def.key, group: def.group, label: def.label, status, value, note: status === 'filled' ? null : note,
      withheld: status !== 'filled' && withheldValue, attempts };
  });
  const filled = slots.filter((slot) => slot.status === 'filled').length;
  return { report: { companyId: company.id, name: company.name, cardTypes, profile, slots, filled, total: slots.length }, facts, shown };
}

function aggregate(companies: CompanyCompletenessReport[]): { bySlot: SlotAggregate[]; totals: Totals } {
  const order: string[] = [];
  const map = new Map<string, SlotAggregate>();
  for (const company of companies) {
    for (const slot of company.slots) {
      let row = map.get(slot.key);
      if (!row) {
        row = { key: slot.key, label: slot.label, group: slot.group, applicable: 0, filled: 0, unknownAttempted: 0,
          unknownNeverAttempted: 0, neverTargeted: 0, withheld: 0, fillPct: 0 };
        map.set(slot.key, row);
        order.push(slot.key);
      }
      row.applicable += 1;
      if (slot.status === 'filled') row.filled += 1;
      else {
        if (slot.status === 'unknown_attempted') row.unknownAttempted += 1;
        else row.unknownNeverAttempted += 1;
        if (!slot.attempts.targeted) row.neverTargeted += 1;
        if (slot.withheld) row.withheld += 1;
      }
    }
  }
  const bySlot = order.map((key) => {
    const row = map.get(key)!;
    return { ...row, fillPct: pct(row.filled, row.applicable) };
  });
  const sum = (field: 'applicable' | 'filled' | 'unknownAttempted' | 'unknownNeverAttempted') =>
    bySlot.reduce((total, row) => total + row[field], 0);
  const slots = sum('applicable');
  return { bySlot, totals: { slots, filled: sum('filled'), unknownAttempted: sum('unknownAttempted'),
    unknownNeverAttempted: sum('unknownNeverAttempted'), fillPct: pct(sum('filled'), slots) } };
}

function deckSmells(deckId: string, scored: Array<{ report: CompanyCompletenessReport; facts: CompanyMetric[]; shown: Company; rows: CompanyMetric[] }>): IntegritySmell[] {
  const smells: IntegritySmell[] = [];
  const one = (kind: IntegritySmellKind, entry: { report: CompanyCompletenessReport }, displayed: boolean, detail: string, metricType?: MetricType) =>
    smells.push({ kind, deckId, companyIds: [entry.report.companyId], companyNames: [entry.report.name], displayed, detail,
      ...(metricType ? { metricType } : {}) });

  for (const entry of scored) {
    const shownTypes = new Set(entry.facts.filter((m) => m.value != null && m.confidence !== 'unknown').map((m) => m.metricType));
    for (const type of new Set(entry.rows.map((row) => row.metricType))) {
      const current = currentMetricRevision(entry.rows, entry.report.companyId, type)?.metric;
      if (!current) continue;
      const displayed = shownTypes.has(type);
      const human = current.confidence === 'user_verified';
      if (current.value != null && current.confidence !== 'unknown' && !human && current.citations.length === 0) {
        one('stored_figure_without_citation', entry, displayed, `${formatFigure(current)} has no citations.`, type);
      } else if (current.value != null && current.confidence === 'verified' && !hasVerificationGradeCitation(current.citations, entry.shown.websiteUrl)) {
        one('verified_without_verification_grade_citation', entry, displayed, `${formatFigure(current)} cites no verification-grade source.`, type);
      }
      if (current.confidence === 'unknown' && current.value != null) {
        one('unknown_with_value', entry, displayed, `${METRIC_TYPE_LABELS[type]} is Unknown but stores ${current.value}.`, type);
      }
    }
    for (const fact of entry.facts) {
      if (fact.confidence === 'estimated' && (fact.value != null || fact.reportedBand) && !asOfOf(fact)) {
        one('estimated_without_date', entry, true, `${formatFigure(fact)} carries no as-of date.`, fact.metricType);
      }
    }
    const description = isPendingCompanySummary(entry.shown.oneLiner) ? '' : entry.shown.oneLiner;
    if (SALES_VERB.test(description)) one('description_sales_verb', entry, true, `Description reads like marketing copy: "${description.slice(0, 80)}"`);
    if (BAD_SPACING.test(description)) one('description_spacing', entry, true, `Description has a space before punctuation: "${description.slice(0, 80)}"`);
  }

  // Identical values across companies: the same figure on two different
  // businesses is far more often a mis-attribution than a coincidence.
  const byFigure = new Map<string, Array<{ report: CompanyCompletenessReport; displayed: boolean; metric: CompanyMetric }>>();
  for (const entry of scored) {
    const shownTypes = new Set(entry.facts.filter((m) => m.value != null && m.confidence !== 'unknown').map((m) => m.metricType));
    for (const type of new Set(entry.rows.map((row) => row.metricType))) {
      const current = currentMetricRevision(entry.rows, entry.report.companyId, type)?.metric;
      if (!current || current.value == null || current.confidence === 'unknown') continue;
      const key = `${type}|${current.value}`;
      byFigure.set(key, [...(byFigure.get(key) ?? []), { report: entry.report, displayed: shownTypes.has(type), metric: current }]);
    }
  }
  for (const group of byFigure.values()) {
    const companies = [...new Map(group.map((g) => [g.report.companyId, g])).values()];
    if (companies.length < 2) continue;
    const metric = companies[0]!.metric;
    smells.push({ kind: 'identical_value_across_companies', deckId, metricType: metric.metricType,
      companyIds: companies.map((g) => g.report.companyId), companyNames: companies.map((g) => g.report.name),
      displayed: companies.some((g) => g.displayed),
      detail: `${companies.length} companies share ${formatFigure(metric).replace(/ \(.*\)$/, '')}.` });
  }

  // HQ formats within one deck should read alike ("City, ST" vs "City, State, Country").
  const formats = new Map<string, Array<{ report: CompanyCompletenessReport; hq: string }>>();
  for (const entry of scored) {
    const hq = entry.shown.hqLocation?.trim();
    if (!hq) continue;
    const format = hqFormat(hq);
    formats.set(format, [...(formats.get(format) ?? []), { report: entry.report, hq }]);
  }
  if (formats.size > 1) {
    const all = [...formats.values()].flat();
    smells.push({ kind: 'hq_format_inconsistent', deckId, displayed: true,
      companyIds: all.map((row) => row.report.companyId), companyNames: all.map((row) => row.report.name),
      detail: [...formats.entries()].map(([format, rows]) => `${format}: ${rows.map((row) => `"${row.hq}"`).slice(0, 3).join(', ')}${rows.length > 3 ? ` +${rows.length - 3}` : ''}`).join(' | ') });
  }
  return smells;
}

/**
 * Build the completeness report for every deck in a snapshot (or only the
 * given deck ids). Pure and synchronous; safe to call from the web app.
 */
export function buildCompletenessReport(snapshot: CompletenessSnapshot, options: { deckIds?: readonly string[] } = {}): CompletenessReport {
  const snap = {
    metrics: (snapshot.metrics ?? []).filter(Boolean),
    researchEvidence: (snapshot.researchEvidence ?? []).filter(Boolean),
    originalSourceAttempts: (snapshot.originalSourceAttempts ?? []).filter(Boolean),
    dashboards: snapshot.dashboards ?? {},
    companyMarket: snapshot.companyMarket ?? {},
    companies: (snapshot.companies ?? []).filter(Boolean),
    sourceChecks: snapshot.sourceChecks,
  };
  const companiesById = new Map(snap.companies.map((company) => [company.id, company]));
  const marketsById = new Map((snapshot.markets ?? []).map((market) => [market.id, market]));
  const decks = (snapshot.decks ?? []).filter((deck) => !options.deckIds || options.deckIds.includes(deck.id));
  const scoredOnce = new Map<string, CompanyCompletenessReport>();
  const deckReports: DeckCompletenessReport[] = [];
  const smells: IntegritySmell[] = [];

  for (const deck of decks) {
    const cardTypes = new Map<string, CardType[]>();
    for (const card of snapshot.cards ?? []) {
      if (card?.deckId !== deck.id || !card.companyId || !isEntityCardType(card.cardType)) continue;
      if (!companiesById.has(card.companyId)) continue;
      cardTypes.set(card.companyId, [...(cardTypes.get(card.companyId) ?? []), card.cardType]);
    }
    const scored = [...cardTypes.entries()].map(([companyId, types]) => {
      const company = companiesById.get(companyId)!;
      const result = scoreCompany(company, [...new Set(types)], snap);
      if (!scoredOnce.has(companyId)) scoredOnce.set(companyId, result.report);
      return { ...result, rows: snap.metrics.filter((row) => row.companyId === companyId) };
    });
    const companies = scored.map((entry) => entry.report);
    const { bySlot, totals } = aggregate(companies);
    deckReports.push({ deckId: deck.id, marketId: deck.marketId, marketName: marketsById.get(deck.marketId)?.name ?? deck.marketId,
      companies, totals, bySlot });
    smells.push(...deckSmells(deck.id, scored));
  }

  const { bySlot, totals } = aggregate([...scoredOnce.values()]);
  const topGaps = bySlot
    .map((row) => ({ ...row, companiesAffected: row.unknownAttempted + row.unknownNeverAttempted }))
    .filter((row) => row.companiesAffected > 0)
    .sort((a, b) => b.companiesAffected - a.companiesAffected || b.unknownNeverAttempted - a.unknownNeverAttempted || a.key.localeCompare(b.key));
  const smellCounts: Partial<Record<IntegritySmellKind, number>> = {};
  for (const smell of smells) smellCounts[smell.kind] = (smellCounts[smell.kind] ?? 0) + 1;

  const caveats: string[] = [];
  if (snap.originalSourceAttempts.length === 0) {
    caveats.push('Snapshot holds no originalSourceAttempts. On desktop, retained original reads live outside the export (userData/original-sources); pass them with --originals so attempts are counted.');
  }
  caveats.push('Team/history/products/news count cached dashboard rows; the tab renderer may gate some rows further.');
  return { companies: scoredOnce.size, decks: deckReports, bySlot, totals, topGaps, smells, smellCounts, caveats };
}

// ---------------------------------------------------------------------------
// Compact text rendering (CLI)
// ---------------------------------------------------------------------------

const MARK: Record<SlotStatus, string> = { filled: '#', unknown_attempted: 'o', unknown_never_attempted: '.' };

function pad(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}~` : text + ' '.repeat(width - text.length);
}

function slotTable(rows: SlotAggregate[]): string[] {
  const lines = [`  ${pad('slot', SLOT_WIDTH)} ${pad('fill%', 6)} ${pad('filled', 6)} ${pad('tried', 6)} ${pad('never', 6)} ${pad('untgt', 6)} withheld`];
  for (const row of rows) {
    lines.push(`  ${pad(slotName(row), SLOT_WIDTH)} ${pad(row.fillPct.toFixed(1), 6)} ${pad(String(row.filled), 6)} ${pad(String(row.unknownAttempted), 6)} ${pad(String(row.unknownNeverAttempted), 6)} ${pad(String(row.neverTargeted), 6)} ${row.withheld}`);
  }
  return lines;
}

const SLOT_WIDTH = 40;
/** Table name: metric slots say which profile they belong to only by their members. */
function slotName(row: { group: SlotGroup; label: string }): string {
  return row.group === 'metric' ? `metric: ${row.label}` : row.label;
}

/** Short column header for the company × slot grid. */
function slotCode(key: string): string {
  const codes: Record<string, string> = { 'identity.website': 'web', 'identity.hq': 'hq', 'identity.founded': 'fnd', description: 'dsc',
    team: 'tm', history: 'hst', products: 'prd', news: 'nws' };
  if (codes[key]) return codes[key]!;
  const first = key.replace(/^metric\./, '').split('|')[0]!;
  return ({ employees: 'emp', arr: 'rev', users: 'usr', valuation: 'val', aum: 'aum', market_cap: 'cap' } as Record<string, string>)[first] ?? first.slice(0, 3);
}

export function renderCompletenessTable(report: CompletenessReport): string {
  const lines: string[] = [];
  lines.push(`COMPLETENESS  ${report.decks.length} deck(s), ${report.companies} companies, ${report.totals.slots} slots: ${report.totals.fillPct.toFixed(1)}% filled, ${report.totals.unknownAttempted} tried-empty, ${report.totals.unknownNeverAttempted} never tried`);
  lines.push(`Legend: # filled   o unknown, attempted   . unknown, never attempted   (untgt = only broad passes or nothing aimed at the slot)`);
  for (const deck of report.decks) {
    lines.push('');
    lines.push(`DECK ${deck.marketName} [${deck.deckId}]  ${deck.companies.length} companies  ${deck.totals.fillPct.toFixed(1)}% filled`);
    // One grid per market profile: their metric slots differ.
    for (const profile of [...new Set(deck.companies.map((company) => company.profile))]) {
      const members = deck.companies.filter((company) => company.profile === profile);
      const keys = members[0]!.slots.map((slot) => slot.key);
      lines.push(`  ${pad(profile === 'financial_firm' ? 'company (financial firm)' : 'company', 28)} ${keys.map((key) => pad(slotCode(key), 4)).join('')} fill`);
      for (const company of members) {
        const cells = keys.map((key) => {
          const slot = company.slots.find((s) => s.key === key);
          return pad(slot ? MARK[slot.status] : ' ', 4);
        }).join('');
        lines.push(`  ${pad(company.name, 28)} ${cells} ${company.filled}/${company.total}`);
      }
    }
    lines.push(...slotTable(deck.bySlot));
  }
  if (report.decks.length > 1) {
    lines.push('');
    lines.push('ALL DECKS BY SLOT (each company once)');
    lines.push(...slotTable(report.bySlot));
  }
  lines.push('');
  lines.push('TOP GAPS (companies affected = tried-empty + never tried; untgt = no attempt aimed at the slot; withheld = stored but refused)');
  report.topGaps.slice(0, 10).forEach((gap, index) => {
    lines.push(`  ${pad(`${index + 1}.`, 3)} ${pad(slotName(gap), SLOT_WIDTH)} ${pad(String(gap.companiesAffected), 4)} tried ${gap.unknownAttempted}, never ${gap.unknownNeverAttempted}, untgt ${gap.neverTargeted}, withheld ${gap.withheld}`);
  });
  lines.push('');
  const kinds = Object.entries(report.smellCounts);
  lines.push(`INTEGRITY SMELLS ${kinds.length ? kinds.map(([kind, count]) => `${kind}=${count}`).join(' ') : 'none'}`);
  for (const smell of report.smells.slice(0, 20)) {
    lines.push(`  [${smell.kind}]${smell.displayed ? '' : ' (ledger only)'} ${smell.companyNames.slice(0, 4).join(', ')}${smell.companyNames.length > 4 ? ` +${smell.companyNames.length - 4}` : ''}: ${smell.detail}`);
  }
  if (report.smells.length > 20) lines.push(`  ... ${report.smells.length - 20} more in the JSON output`);
  if (report.caveats.length) {
    lines.push('');
    for (const caveat of report.caveats) lines.push(`Note: ${caveat}`);
  }
  return lines.join('\n');
}
