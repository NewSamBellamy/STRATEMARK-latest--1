/**
 * Pure export model: turns deck/company data into what every export format
 * renders (PDF report, CSV, transcript). One place decides what counts as a
 * stated figure, so a PDF can never show a number the CSV calls Unknown.
 *
 * Data-integrity rules (AGENTS.md Rule 9) enforced here:
 *  - an `unknown` figure carries no value,
 *  - verified/estimated figures with no usable citation are shown as Unknown,
 *  - only a human-set `user_verified` figure may stand without an external source,
 *  - nothing is imputed, zero-filled or rounded up.
 */
import {
  METRIC_TYPE_LABELS,
  TIER_LABELS,
  usableCitations,
  type CardWithCompany,
  type Citation,
  type CompanyMetric,
  type MaturityTier,
  type MetricType,
  type ThreadMessage,
} from '@mi/contracts';
import { formatMetricValue } from '@/lib/format';
import { splitFollowUps } from '@/features/deepdive/followUps';

export interface ExportCompany {
  id: string;
  name: string;
  oneLiner: string | null;
  hq: string | null;
  website: string | null;
  logoUrl: string | null;
  tier: number | null;
  metrics: readonly CompanyMetric[];
}

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

export function metricAsOf(m: CompanyMetric): string | null {
  return m.passageSupport?.asOf || m.reportedSupport?.asOf || null;
}

export function toMetricRow(type: MetricType, m: CompanyMetric | undefined): MetricRow {
  const label = METRIC_TYPE_LABELS[type] ?? type;
  const unknownRow: MetricRow = {
    type, label, valueText: 'Unknown', value: null, confidence: 'unknown', unknown: true,
    asOf: null, capturedAt: m?.capturedAt ?? null, sources: [], note: null,
  };
  if (!m || m.value == null || m.confidence === 'unknown') return unknownRow;
  const sources = usableCitations(m.citations ?? []);
  const humanSet = m.confidence === 'user_verified';
  if (sources.length === 0 && !humanSet) {
    return { ...unknownRow, note: 'A figure was recorded without a usable source, so it is not shown.' };
  }
  return {
    type,
    label,
    valueText: formatMetricValue(type, m.value),
    value: m.value,
    confidence: m.confidence,
    unknown: false,
    asOf: metricAsOf(m),
    capturedAt: m.capturedAt ?? null,
    sources,
    note:
      m.confidence === 'estimated' && m.methodNote
        ? m.methodNote
        : humanSet && sources.length === 0
          ? 'Confirmed by the analyst; no external source attached.'
          : null,
  };
}

/** Rows for one company, in a stable order. Highest revision wins per type. */
export function metricRowsFor(company: ExportCompany): MetricRow[] {
  const byType = new Map<MetricType, CompanyMetric>();
  for (const m of company.metrics) {
    const prev = byType.get(m.metricType);
    if (!prev || (m.revision ?? 0) >= (prev.revision ?? 0)) byType.set(m.metricType, m);
  }
  const rows: MetricRow[] = [];
  for (const t of CORE) rows.push(toMetricRow(t, byType.get(t)));
  for (const t of OPTIONAL) {
    const row = toMetricRow(t, byType.get(t));
    if (!row.unknown) rows.push(row);
  }
  return rows;
}

export function companiesFromCards(cards: readonly CardWithCompany[]): ExportCompany[] {
  const seen = new Set<string>();
  const out: ExportCompany[] = [];
  const entities = cards
    .filter((c) => c.company && c.card.cardType !== 'culture' && c.card.cardType !== 'vice' && c.card.cardType !== 'insight')
    .sort((a, b) => (b.card.tier ?? 0) - (a.card.tier ?? 0) || a.company!.name.localeCompare(b.company!.name));
  for (const c of entities) {
    const co = c.company!;
    if (seen.has(co.id)) continue;
    seen.add(co.id);
    out.push({
      id: co.id,
      name: co.name,
      oneLiner: co.oneLiner ?? null,
      hq: co.hqLocation ?? null,
      website: co.websiteUrl ?? null,
      logoUrl: co.logoUrl ?? null,
      tier: c.card.tier ?? null,
      metrics: c.metrics,
    });
  }
  return out;
}

export function tierLabel(tier: number | null): string | null {
  return tier ? `T${tier} ${TIER_LABELS[tier as MaturityTier] ?? ''}`.trim() : null;
}

// -- Footnotes ---------------------------------------------------------------

export interface ReportCompany extends ExportCompany {
  rows: Array<MetricRow & { footnotes: number[] }>;
  footnotes: Array<{ n: number; title: string; url: string }>;
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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
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
          footnotes.push({ n, title: s.title || hostOf(s.url), url: s.url });
        }
        return n;
      });
      if (r.unknown) unknownCount += 1;
      else figureCount += 1;
      return { ...r, footnotes: fns };
    });
    return { ...co, rows, footnotes, unknownCount: rows.filter((r) => r.unknown).length };
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
  'source_title', 'source_url', 'other_source_urls', 'method_note',
] as const;

/** One row per company x metric. Unknown figures are written as blank value + "Unknown". */
export function metricsToCsv(market: string | null, companies: readonly ExportCompany[]): string {
  const lines: string[] = [CSV_HEADER.join(',')];
  for (const co of companies) {
    for (const r of metricRowsFor(co)) {
      const [first, ...rest] = r.sources;
      lines.push(
        [
          market, co.name, r.label, r.value, r.valueText, r.confidence,
          r.asOf, r.capturedAt ? r.capturedAt.slice(0, 10) : '', first?.title ?? '', first?.url ?? '',
          rest.map((s) => s.url).join(' | '), r.note,
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
    `*Stratemark research conversation${args.scopeLabel ? ` · ${args.scopeLabel}` : ''} · exported ${(args.now ?? new Date()).toISOString().slice(0, 10)}*`,
    '',
  );
  for (const m of args.messages) {
    if (m.role === 'user') {
      out.push(`**You:** ${m.text.trim()}`, '');
    } else {
      out.push('**Stratemark:**', '', splitFollowUps(m.text).body, '');
      const cites = usableCitations(m.citations ?? []);
      if (cites.length) {
        out.push('Sources:', ...cites.map((c, i) => `${i + 1}. [${c.title || hostOf(c.url)}](${c.url})`), '');
      }
    }
  }
  out.push('---', '*Generated by Stratemark · sources cited. Figures not in the research are marked Unknown, never estimated.*', '');
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
