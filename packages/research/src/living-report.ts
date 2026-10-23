/**
 * The living company report: compose it, from stored research only.
 *
 * Two ways to the same document shape (see @mi/contracts company-report.ts):
 *   - `ai`: one structured model call over a bounded, priority-truncated set of evidence, then the deterministic
 *     gate (living-report-gate.ts). Sections the model left empty or the gate emptied are filled from stored text.
 *   - `stored_data`: no model (no key, a failure, too little to write from, or a gate that left too little). Built
 *     only from stored passages, each cited to its own source, with the figures as the app shows them and the gaps
 *     named. It must read as a usable document, never an error page.
 *
 * Spending: at most ONE structure call per compose, and only when the caller passes a client. Reading and
 * hashing are free; callers decide when to compose (a person's click), never this module.
 */
import {
  COMPANY_REPORT_SECTION_IDS,
  COMPANY_REPORT_SECTION_TITLES,
  type CompanyReport,
  type CompanyReportBlock,
  type CompanyReportFigure,
  type CompanyReportSection,
  type CompanyReportSectionId,
  type CompanyReportSource,
} from '@mi/contracts';
import { AbortError, throwIfAborted } from './util';

const isAbortError = (e: unknown) => e instanceof AbortError || (e instanceof Error && e.name === 'AbortError');
import { STRUCTURE_SYSTEM } from './prompts';
import type { LlmClient } from './types';
import { LIVING_REPORT_LABEL, gateReport, reportOutSchema, reportPrompt, type GatedReport } from './living-report-gate';
import { selectEvidence, type NumberedItem, type ReportInputs } from './living-report-inputs';

/** What goes to the model: bounded so one call stays cheap however much the app holds. */
export const MODEL_EVIDENCE_BOUNDS = { maxItems: 64, maxChars: 24_000 } as const;
/** A report needs something to say: below this the stored-data report is used and no model is called. */
export const MIN_EVIDENCE_FOR_MODEL = 4;
/** A model report must keep at least this many sections, one of them the executive summary, or it is replaced. */
export const MIN_SECTIONS_FOR_MODEL = 3;

export type ReportFallbackReason = 'no_model' | 'too_little_evidence' | 'model_failed' | 'gate_rejected';

export interface ComposeArgs {
  inputs: ReportInputs;
  /** Absent when there is no key or model: the stored-data report is built and nothing is spent. */
  client?: Pick<LlmClient, 'structure'> | null;
  now?: () => Date;
  signal?: AbortSignal;
}

export interface ComposeOutcome {
  report: CompanyReport;
  fallback: ReportFallbackReason | null;
  /** What the gate removed (zeros for a stored-data report). */
  gate: GatedReport['dropped'] | null;
}

// ---- stored-data blocks -------------------------------------------------------

const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+(?=[A-Z“"(])/).map((s) => s.trim()).filter(Boolean);
const firstSentences = (text: string, n: number) => sentences(text).slice(0, n).join(' ');
const TAB_TITLES: Record<string, string> = {
  overview: 'Overview', products_roadmap: 'Products & Roadmap', team_org: 'Team & Org', history: 'History', live_intel: 'Live intel', mission_governance: 'Mission & Governance',
};

function figuresFor(inputs: ReportInputs, sources: readonly NumberedItem[]): CompanyReportFigure[] {
  const idOf = new Map(sources.map((s) => [s.key, s.id]));
  const known = inputs.figures.map((f): CompanyReportFigure => ({
    metricType: f.metricType, label: f.label, display: f.display, trust: f.trust, asOf: f.asOf, citations: f.itemKey && idOf.has(f.itemKey) ? [idOf.get(f.itemKey)!] : [],
  }));
  const gaps = inputs.missingFigures.slice(0, 4).map((f): CompanyReportFigure => ({ metricType: f.metricType, label: f.label, display: null, trust: 'unknown', asOf: null, citations: [] }));
  return [...known, ...gaps];
}

const bullet = (s: NumberedItem) => ({ text: s.text, citations: [s.id] });

/** The stored passages of one section as blocks: nothing added, each cited to its own source. */
function storedBlocks(id: CompanyReportSectionId, inputs: ReportInputs, sources: readonly NumberedItem[]): CompanyReportBlock[] {
  const mine = sources.filter((s) => s.section === id && s.kind !== 'figure');
  const from = (origin: string) => mine.filter((s) => s.origin === origin);
  const prose = (list: readonly NumberedItem[], n: number): CompanyReportBlock[] =>
    list.slice(0, n).map((s) => ({ type: 'paragraph', text: s.text, citations: [s.id] }));
  const list = (items: readonly NumberedItem[], n: number): CompanyReportBlock[] =>
    items.length ? [{ type: 'bullets', text: '', citations: [], items: items.slice(0, n).map(bullet) }] : [];
  const gapNote = (text: string): CompanyReportBlock => ({ type: 'analyst_view', text, citations: [] });

  switch (id) {
    case 'executive_summary': return prose(mine, 3);
    case 'what_they_do': return [...prose(from('overview'), 2), ...list(from('products_roadmap'), 8)];
    case 'market_position': return [...prose(from('overview'), 2), ...list(from('products_roadmap'), 6)];
    case 'business_model': {
      const figures = figuresFor(inputs, sources);
      const blocks: CompanyReportBlock[] = figures.length ? [{ type: 'figures', text: '', citations: [], figures }] : [];
      blocks.push(...prose(from('overview'), 1), ...list(mine.filter((s) => s.origin !== 'overview'), 5));
      const gaps = inputs.missingFigures.slice(0, 4).map((f) => f.label);
      if (gaps.length) blocks.push(gapNote(`Not yet found in the research: ${gaps.join(', ')}. These stay unknown until a source states them.`));
      return blocks;
    }
    case 'leadership_culture': {
      const quotes = mine.filter((s) => s.quote).slice(0, 2).map((s): CompanyReportBlock => ({ type: 'quote', text: s.quote!.text, citations: [s.id], ...(s.quote!.attribution ? { attribution: s.quote!.attribution } : {}) }));
      const rest = mine.filter((s) => !s.quote);
      return [...list(rest.filter((s) => s.origin === 'team_org'), 8), ...prose(rest.filter((s) => s.origin !== 'team_org').slice(0, 2), 2), ...list(rest.filter((s) => s.origin !== 'team_org').slice(2), 5), ...quotes];
    }
    case 'momentum': return [
      ...list(mine.filter((s) => s.origin === 'live_intel' || s.origin === 'chat'), 6),
      ...list(mine.filter((s) => s.origin === 'products_roadmap'), 5),
      ...list(mine.filter((s) => s.origin === 'history'), 6),
    ];
    case 'risks': {
      const blocks = list(mine, 6);
      const missing = Object.keys(TAB_TITLES).filter((t) => !inputs.tabNames.includes(t)).map((t) => TAB_TITLES[t]!);
      if (missing.length) blocks.push(gapNote(`Not yet researched: ${missing.join(', ')}. Open those tabs to fill the gaps; this report updates when they land.`));
      return blocks;
    }
    case 'your_research': {
      const quotes = mine.filter((s) => s.quote).slice(0, 4).map((s): CompanyReportBlock => ({ type: 'quote', text: s.quote!.text, citations: [s.id], ...(s.quote!.attribution ? { attribution: s.quote!.attribution } : {}) }));
      return [...list(mine.filter((s) => !s.quote), 8), ...quotes];
    }
    case 'sources': return [];
  }
}

function sourceList(sources: readonly NumberedItem[]): CompanyReportSource[] {
  return sources.map((s) => ({
    id: s.id, kind: s.kind, title: s.title, url: s.url, excerpt: s.text.length > 300 ? `${s.text.slice(0, 299).trimEnd()}…` : s.text, asOf: s.asOf,
  }));
}

function sourcesSection(sources: readonly NumberedItem[]): CompanyReportSection | null {
  // One line per distinct page or document; its citation points at the first passage read from it.
  const seen = new Set<string>();
  const items = sources.flatMap((s) => {
    const key = s.url ?? `${s.kind}:${s.title}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ text: s.title, citations: [s.id] }];
  });
  return items.length ? { id: 'sources', title: COMPANY_REPORT_SECTION_TITLES.sources, blocks: [{ type: 'bullets', text: '', citations: [], items: items.slice(0, 60) }] } : null;
}

function basis(inputs: ReportInputs, sources: readonly NumberedItem[]): CompanyReport['basedOn'] {
  const distinct = new Set(sources.filter((s) => !s.userSupplied).map((s) => s.url ?? `${s.kind}:${s.title}`));
  const notes = new Set(sources.filter((s) => s.userSupplied).map((s) => s.title));
  return { dataHash: inputs.dataHash, sources: distinct.size, notes: notes.size, tabs: inputs.tabNames.length, tabNames: [...inputs.tabNames], figures: inputs.figures.length };
}

/** One short line from a sentence: the stop dropped, cut at a natural break, never mid-word. */
function shortLine(sentence: string, max = 96): string {
  const text = sentence.replace(/\s+/g, ' ').trim().replace(/[.!?]$/, '');
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  const breaks = [...window.matchAll(/[,;:—–]| (?:that|which|focused on|with|using|for) /g)];
  const cut = breaks.length > 0 ? breaks[breaks.length - 1]!.index! : -1;
  if (cut >= 36) return `${window.slice(0, cut).trimEnd()}…`;
  const word = window.lastIndexOf(' ');
  return `${window.slice(0, word > 36 ? word : max).trimEnd()}…`;
}

function fallbackHeadline(inputs: ReportInputs): string {
  const name = inputs.company.name;
  const lead = inputs.company.oneLiner ? shortLine(firstSentences(inputs.company.oneLiner, 1)) : '';
  if (!lead) return `${name}: company report`;
  // A one-liner that already opens with the name does not repeat it.
  return lead.toLowerCase().startsWith(name.toLowerCase()) ? lead : `${name}: ${lead}`;
}

/**
 * Assemble the final document. `gated` is null for the stored-data report. A section the model did not write
 * (or the gate emptied) is filled from stored text; figures and sources always come from stored data.
 */
function assemble(inputs: ReportInputs, sources: readonly NumberedItem[], gated: GatedReport | null, status: CompanyReport['status'], now: Date): CompanyReport {
  const written = new Map((gated?.sections ?? []).map((s) => [s.id, s.blocks]));
  const sections: CompanyReportSection[] = [];
  for (const id of COMPANY_REPORT_SECTION_IDS) {
    if (id === 'sources') continue;
    let blocks = written.get(id) ?? storedBlocks(id, inputs, sources);
    // Figures are never the model's: the table leads the business section whoever wrote the rest.
    if (id === 'business_model' && written.has(id)) {
      const figures = figuresFor(inputs, sources);
      if (figures.length) blocks = [{ type: 'figures', text: '', citations: [], figures }, ...blocks];
    }
    if (blocks.length) sections.push({ id, title: COMPANY_REPORT_SECTION_TITLES[id], blocks });
  }
  const tail = sourcesSection(sources);
  if (tail) sections.push(tail);

  const leadItem = sources.find((s) => s.section === 'executive_summary' && s.kind !== 'figure');
  const abstract = gated?.abstract ?? (leadItem ? firstSentences(leadItem.text, 2) : `No research has been stored for ${inputs.company.name} yet.`);
  const abstractCites = gated?.abstract ? gated.abstractCites : leadItem ? [leadItem.id] : [];
  return {
    companyId: inputs.company.id,
    companyName: inputs.company.name,
    generatedAt: now.toISOString(),
    headline: gated?.headline ?? fallbackHeadline(inputs),
    abstract,
    abstractCitations: abstractCites,
    basedOn: basis(inputs, sources),
    status,
    sections,
    sources: sourceList(sources),
  };
}

/** The report built from stored text alone: free, deterministic, and never an error page. */
export function buildStoredDataReport(inputs: ReportInputs, now: () => Date = () => new Date()): CompanyReport {
  return assemble(inputs, selectEvidence(inputs.items), null, 'stored_data', now());
}

const sectionCount = (g: GatedReport) => g.sections.length;

/** Compose the report: one bounded model call when a client is given, the stored-data report otherwise or on any failure. */
export async function composeCompanyReport(args: ComposeArgs): Promise<ComposeOutcome> {
  const { inputs, client, signal } = args;
  const now = args.now ?? (() => new Date());
  const stored = (fallback: ReportFallbackReason): ComposeOutcome => ({ report: buildStoredDataReport(inputs, now), fallback, gate: null });
  throwIfAborted(signal);
  if (!client) return stored('no_model');
  if (inputs.items.length < MIN_EVIDENCE_FOR_MODEL) return stored('too_little_evidence');

  const sources = selectEvidence(inputs.items, MODEL_EVIDENCE_BOUNDS);
  const figureText = inputs.figures.map((f) => `${f.label} ${f.display ?? ''}`).join('\n');
  let raw: unknown;
  try {
    raw = await client.structure(reportPrompt(inputs, sources, now().toISOString().slice(0, 10)), reportOutSchema, { system: STRUCTURE_SYSTEM, signal, label: LIVING_REPORT_LABEL });
  } catch (error) {
    // The caller's own cancel stops the report; a model that failed only costs the model's part.
    if (signal?.aborted || isAbortError(error)) throw error;
    return stored('model_failed');
  }
  throwIfAborted(signal);
  const gated = gateReport(raw, sources, figureText);
  if (sectionCount(gated) < MIN_SECTIONS_FOR_MODEL || !gated.sections.some((s) => s.id === 'executive_summary')) return { ...stored('gate_rejected'), gate: gated.dropped };
  return { report: assemble(inputs, sources, gated, 'ai', now()), fallback: null, gate: gated.dropped };
}

/** Whether the research has moved on since the report was written. */
export function isReportStale(report: Pick<CompanyReport, 'basedOn'>, inputs: Pick<ReportInputs, 'dataHash'>): boolean {
  return report.basedOn.dataHash !== inputs.dataHash;
}
