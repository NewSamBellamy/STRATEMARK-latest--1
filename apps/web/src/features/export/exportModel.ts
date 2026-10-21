/**
 * Pure export model: turns deck/company data into what every export format
 * renders (PDF report, CSV, transcript). One place decides what counts as a
 * stated figure, so a PDF can never show a number the CSV calls Unknown.
 *
 * Figures are read exactly the way the card face reads them (`buildMetricViews`
 * and its display), so an export can never state a figure, a confidence or a
 * rounding the card does not.
 *
 * Data-integrity rules (AGENTS.md Rule 9) enforced here:
 *  - an `unknown` figure carries no value,
 *  - verified/estimated figures with no usable citation are shown as Unknown,
 *  - only a human-set `user_verified` figure may stand without an external source,
 *  - only the company's own rows are read (a rival's row never lands here),
 *  - nothing is imputed, zero-filled or rounded up.
 */
import {
  TIER_LABELS,
  isSignalCardType,
  figureAsOf,
  publisherOf,
  UNRECORDED_PUBLISHER,
  usableCitations,
  type CardWithCompany,
  type Citation,
  type CompanyMetric,
  type MaturityTier,
  type MetricType,
  type Ownership,
  type ThreadMessage,
} from '@mi/contracts';
import {
  ESTIMATE_UNCONFIRMED_NOTE, FIGURE_GATE_NOTES, SLOT_LEVEL_LABELS, buildMetricViews, defaultFaceLabel, estimateHolds, faceLabel,
  type MetricView,
} from '@/features/card/card-view';
import { withoutProseFigures } from './proseFigures';
import { isDirectSource, sourceHref } from '@/lib/sourceHref';
import { splitFollowUps } from '@/features/deepdive/followUps';

export interface ExportCompany {
  id: string;
  name: string;
  oneLiner: string | null;
  hq: string | null;
  website: string | null;
  logoUrl: string | null;
  tier: number | null;
  /** Stored ownership record (named apart from the PDF model's printed ownership label). The card withholds an acquired company's deal-time valuation, so every export does too. */
  ownershipRecord?: Ownership | null;
  metrics: readonly CompanyMetric[];
}

/** What {@link figureRows} needs: enough of a company to read its figures the way the card face does. */
export type FigureSource = Pick<ExportCompany, 'id' | 'name' | 'website' | 'ownershipRecord' | 'metrics'>;

export interface MetricRow {
  type: MetricType;
  label: string;
  /** Display value, or "Unknown". */
  valueText: string;
  /** Raw stored number - null whenever the figure is Unknown. */
  value: number | null;
  confidence: string;
  unknown: boolean;
  asOf: string | null;
  capturedAt: string | null;
  sources: Citation[];
  note: string | null;
}

/** Shown for every company; the rest appear only when a sourced figure exists. */
const CORE: readonly MetricType[] = ['market_cap', 'valuation', 'arr', 'revenue', 'employees', 'users', 'market_share'];
const OPTIONAL: readonly MetricType[] = ['aum', 'funding_total', 'last_round', 'distribution'];

/** YYYY-MM-DD in the user's own time zone (toISOString is UTC: "tomorrow" in the evening). */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function metricAsOf(m: CompanyMetric): string | null {
  return figureAsOf(m).asOf;
}

/**
 * What an export row is called: what the card face calls this figure ("Paying customers", "GitHub stars",
 * "Stockists"), and never less exactly. A face SLOT that can hold several kinds of figure ("Revenue / ARR") names
 * none of them, so a row that is exactly one kind says so with its type's own name.
 */
function rowLabel(type: MetricType, metric?: CompanyMetric): string {
  const named = metric ? faceLabel(metric) : null;
  return named && !SLOT_LEVEL_LABELS.includes(named) ? named : defaultFaceLabel(type);
}

function unknownRow(type: MetricType, label: string, capturedAt: string | null, note: string | null): MetricRow {
  return {
    type, label, valueText: 'Unknown', value: null, confidence: 'unknown', unknown: true,
    asOf: null, capturedAt, sources: [], note,
  };
}

/** Said of a figure that was recorded but the card's own gates would not show. */
const WITHHELD_NOTE = 'A figure was recorded but did not pass the same source checks as the card, so it is not shown.';

/**
 * One export row from the card face's own reading of a figure. `view` is what
 * {@link buildMetricViews} made of the stored rows (revision choice, source and
 * ownership gates, invalid values, the card's display string); an estimate
 * additionally has to hold on its own evidence, exactly as it does on the face.
 * A figure the face would show as Unknown is Unknown here: no value, a plain
 * status, never a confidence it did not earn.
 */
function rowFromView(view: MetricView, co: FigureSource, recorded: boolean): MetricRow {
  const m = view.metric;
  const type = m.metricType;
  const capturedAt = m.capturedAt ?? null;
  const label = rowLabel(type, m);
  const withheld = (note: string | null) => unknownRow(type, label, capturedAt, recorded ? note : null);
  if (m.value == null || !Number.isFinite(m.value) || m.confidence === 'unknown') {
    return withheld(view.note && FIGURE_GATE_NOTES.includes(view.note) ? view.note : WITHHELD_NOTE);
  }
  const humanSet = m.confidence === 'user_verified';
  // A human-checked figure stands on its own; every other figure needs a source.
  if (view.citations.length === 0 && !humanSet) return withheld(WITHHELD_NOTE);
  if (m.confidence === 'estimated' && !estimateHolds({ name: co.name, websiteUrl: co.website }, m)) {
    return withheld(ESTIMATE_UNCONFIRMED_NOTE);
  }
  return {
    type,
    label,
    valueText: view.display,
    value: m.value,
    confidence: m.confidence,
    unknown: false,
    asOf: metricAsOf(m),
    capturedAt,
    sources: view.citations,
    note:
      m.confidence === 'estimated' && view.note
        ? view.note
        : humanSet && view.citations.length === 0
          ? 'Confirmed by the analyst; no external source attached.'
          : null,
  };
}

/**
 * Every figure a company has, read the way its card face reads it: only this
 * company's own rows, through the same revision choice, provenance and
 * ownership gates and the same display. One row per metric type with stored rows.
 */
export function figureRows(co: FigureSource): Map<MetricType, MetricRow> {
  const own = co.metrics.filter((m) => m.companyId === co.id);
  const recorded = new Set(own.filter((m) => m.value != null).map((m) => m.metricType));
  const out = new Map<MetricType, MetricRow>();
  for (const view of buildMetricViews(own, co.website, co.ownershipRecord)) {
    out.set(view.metric.metricType, rowFromView(view, co, recorded.has(view.metric.metricType)));
  }
  return out;
}

/** Rows for one company, in a stable order. Same figures, gates and display as its card face. */
export function metricRowsFor(company: FigureSource): MetricRow[] {
  const byType = figureRows(company);
  const rows: MetricRow[] = [];
  for (const t of CORE) rows.push(byType.get(t) ?? unknownRow(t, defaultFaceLabel(t), null, null));
  for (const t of OPTIONAL) {
    const row = byType.get(t);
    if (row && !row.unknown) rows.push(row);
  }
  return rows;
}

/** A card's company as an export subject, or null for a card with no company. */
export function exportCompanyOf(c: CardWithCompany): ExportCompany | null {
  const co = c.company;
  if (!co) return null;
  return {
    id: co.id,
    name: co.name,
    oneLiner: co.oneLiner ?? null,
    hq: co.hqLocation ?? null,
    website: co.websiteUrl ?? null,
    logoUrl: co.logoUrl ?? null,
    tier: c.card.tier ?? null,
    ownershipRecord: co.ownership ?? null,
    metrics: c.metrics,
  };
}

export function companiesFromCards(cards: readonly CardWithCompany[]): ExportCompany[] {
  const seen = new Set<string>();
  const out: ExportCompany[] = [];
  const entities = cards
    // A signal card (culture, risk, insight, barrier) annotates a company; it is never one, and adds none.
    .filter((c) => c.company && !isSignalCardType(c.card.cardType))
    .sort((a, b) => a.company!.name.localeCompare(b.company!.name));
  for (const c of entities) {
    const co = c.company!;
    if (seen.has(co.id)) continue;
    seen.add(co.id);
    out.push(exportCompanyOf(c)!);
  }
  return out;
}

export function tierLabel(tier: number | null): string | null {
  return tier ? `T${tier} ${TIER_LABELS[tier as MaturityTier] ?? ''}`.trim() : null;
}

// -- Footnotes ---------------------------------------------------------------

export interface ReportCompany extends ExportCompany {
  rows: Array<MetricRow & { footnotes: number[] }>;
  footnotes: Array<{ n: number; title: string; url: string; direct: boolean }>;
  unknownCount: number;
}

export interface ReportModel {
  title: string;
  kind: 'deck' | 'company';
  dateText: string;
  companies: ReportCompany[];
  figureCount: number;
  unknownCount: number;
}

/** The publisher's name for display; the data stays "unrecorded", only the wording is gentler than an error. */
export function sourceLabel(url: string, title?: string | null): string {
  const name = publisherOf(url, title);
  return name === UNRECORDED_PUBLISHER ? 'Source not named' : name;
}

/**
 * How a source appears in an export: the publisher by name and a link that
 * still works. Grounding citations are vertexaisearch.cloud.google.com
 * redirects that expire; those become a search for the story (`direct`
 * false), and print layouts show the link text only for real publisher URLs.
 */
export function exportSource(c: { url: string; title?: string | null }): { title: string; url: string; direct: boolean } {
  return { title: sourceLabel(c.url, c.title), url: sourceHref(c.url, c.title), direct: isDirectSource(c.url) };
}

/** Footnotes restart per company so each section is self-contained on its page. */
export function buildReportModel(args: {
  title: string;
  kind: 'deck' | 'company';
  companies: readonly ExportCompany[];
  now?: Date;
}): ReportModel {
  let figureCount = 0;
  let unknownCount = 0;
  const companies = args.companies.map((co): ReportCompany => {
    const footnotes: ReportCompany['footnotes'] = [];
    const byUrl = new Map<string, number>();
    const rows = metricRowsFor(co).map((r) => {
      const fns = r.sources.slice(0, 3).map((s) => {
        let n = byUrl.get(s.url);
        if (!n) {
          n = footnotes.length + 1;
          byUrl.set(s.url, n);
          footnotes.push({ n, ...exportSource(s) });
        }
        return n;
      });
      if (r.unknown) unknownCount += 1;
      else figureCount += 1;
      return { ...r, footnotes: fns };
    });
    // The one-liner is stored prose with no figure gate: a sentence stating a figure is not printed beside rows that
    // may say Unknown (see proseFigures.ts).
    return { ...co, oneLiner: withoutProseFigures(co.oneLiner), rows, footnotes, unknownCount: rows.filter((r) => r.unknown).length };
  });
  return {
    title: args.title,
    kind: args.kind,
    dateText: (args.now ?? new Date()).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    companies,
    figureCount,
    unknownCount,
  };
}

// -- CSV ---------------------------------------------------------------------

/** RFC 4180 quoting plus a guard against spreadsheet formula injection. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = [
  'market', 'company', 'metric', 'value', 'value_display', 'confidence', 'as_of', 'captured_at',
  'source_title', 'source_url', 'other_source_urls', 'method_note', 'source_link',
] as const;

/**
 * One row per company x metric. Unknown figures are written as blank value + "Unknown".
 * `source_link` says what `source_url` is: "page" when it is the publisher's own address, "search" when the research kept only the
 * publisher's name (an expiring redirect) and the link is a search for it, blank when there is no source. It is the last column, so
 * a reader of the columns before it is unaffected.
 */
export function metricsToCsv(market: string | null, companies: readonly ExportCompany[]): string {
  const lines: string[] = [CSV_HEADER.join(',')];
  for (const co of companies) {
    for (const r of metricRowsFor(co)) {
      const [first, ...rest] = r.sources.map(exportSource);
      lines.push(
        [
          market, co.name, r.label, r.value, r.valueText, r.confidence,
          r.asOf, r.capturedAt ? r.capturedAt.slice(0, 10) : '', first?.title ?? '', first?.url ?? '',
          rest.map((s) => s.url).join(' | '), r.note, first ? (first.direct ? 'page' : 'search') : '',
        ].map(csvCell).join(','),
      );
    }
  }
  // BOM so Excel reads UTF-8 correctly.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

// -- Chat transcript ---------------------------------------------------------

export function transcriptToMarkdown(args: {
  title: string;
  scopeLabel?: string | null;
  messages: readonly ThreadMessage[];
  now?: Date;
}): string {
  const out: string[] = [`# ${args.title}`, ''];
  out.push(
    `*Stratemark research conversation${args.scopeLabel ? ` · ${args.scopeLabel}` : ''} · exported ${localDate(args.now ?? new Date())}*`,
    '',
  );
  for (const m of args.messages) {
    if (m.role === 'user') {
      out.push(`**You:** ${m.text.trim()}`, '');
    } else {
      out.push('**Stratemark:**', '', splitFollowUps(m.text).body, '');
      const cites = usableCitations(m.citations ?? []);
      if (cites.length) {
        out.push('Sources:', ...cites.map(exportSource).map((s, i) => `${i + 1}. [${s.title}](${s.url})`), '');
      }
    }
  }
  out.push('---', '*Generated by Stratemark · sources cited. Figures not in the research are marked Unknown, never guessed.*', '');
  return out.join('\n');
}

export function fileSlug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'export';
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
