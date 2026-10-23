/**
 * The Company Report: one living, written document about a company, put together from everything the app
 * holds (dashboard tabs, figures, the user's own research notes and digests, chat-derived evidence).
 *
 * Integrity (AGENTS.md Rule 9), carried by the shape itself:
 *   - Every factual block names the sources it rests on by id (`citations` point into `sources`).
 *   - A block of type `analyst_view` is commentary: it may carry no new figure and says so on the page.
 *   - Figures are never written by a model: a `figures` block is read from the stored metrics, each with its own
 *     trust label, and an unknown figure stays unknown (`display: null`).
 *   - A report written without a model (`status: 'stored_data'`) is a fair, usable document built only from
 *     stored text; it is labelled as such.
 *
 * Additive and optional: nothing else in the contracts depends on it.
 */
import { z } from 'zod';

export const COMPANY_REPORT_SECTION_IDS = [
  'executive_summary',
  'what_they_do',
  'market_position',
  'business_model',
  'leadership_culture',
  'momentum',
  'risks',
  'your_research',
  'sources',
] as const;
export type CompanyReportSectionId = (typeof COMPANY_REPORT_SECTION_IDS)[number];

export const COMPANY_REPORT_SECTION_TITLES: Record<CompanyReportSectionId, string> = {
  executive_summary: 'Executive summary',
  what_they_do: 'What they do & products',
  market_position: 'Market position & competitors',
  business_model: 'Business model & figures',
  leadership_culture: 'Leadership & culture',
  momentum: 'Momentum: news, roadmap & history',
  risks: 'Risks & open questions',
  your_research: "What you've added",
  sources: 'Sources',
};

export const COMPANY_REPORT_BLOCK_TYPES = ['paragraph', 'bullets', 'figures', 'quote', 'analyst_view'] as const;
export type CompanyReportBlockType = (typeof COMPANY_REPORT_BLOCK_TYPES)[number];

/** Where a piece of evidence came from. `note` is the user's own research (never independently verified). */
export const COMPANY_REPORT_SOURCE_KINDS = ['web', 'note', 'stored', 'figure'] as const;
export type CompanyReportSourceKind = (typeof COMPANY_REPORT_SOURCE_KINDS)[number];

export interface CompanyReportSource {
  /** Stable within one report ("s1"); what `citations` refer to. */
  id: string;
  kind: CompanyReportSourceKind;
  /** Publisher or document name; for a stored item, the research it came from ("Team & Org research"). */
  title: string;
  /** A real page, or null for stored research and the user's own notes. */
  url: string | null;
  /** The passage the report read from this source (bounded), so a reader can check the claim. */
  excerpt: string | null;
  asOf: string | null;
}

export type CompanyReportTrust = 'verified' | 'user_verified' | 'estimated' | 'unknown';

export interface CompanyReportFigure {
  metricType: string;
  label: string;
  /** The figure as the app shows it; null when unknown. */
  display: string | null;
  trust: CompanyReportTrust;
  asOf: string | null;
  /** Source ids behind this figure. */
  citations: string[];
}

export interface CompanyReportItem { text: string; citations: string[] }

export interface CompanyReportBlock {
  type: CompanyReportBlockType;
  /** paragraph, quote and analyst_view text. Empty for bullets and figures. */
  text: string;
  citations: string[];
  /** bullets */
  items?: CompanyReportItem[];
  /** figures */
  figures?: CompanyReportFigure[];
  /** quote: who said it, when the source says. */
  attribution?: string;
}

export interface CompanyReportSection {
  id: CompanyReportSectionId;
  title: string;
  blocks: CompanyReportBlock[];
}

export interface CompanyReportBasis {
  /** Fingerprint of everything the report was written from; a different one means the report is behind. */
  dataHash: string;
  /** Pieces of evidence the report read. */
  sources: number;
  /** Of those, how many are the user's own notes and digests. */
  notes: number;
  /** Dashboard tabs that had stored research. */
  tabs: number;
  tabNames: string[];
  /** Known figures at the time. */
  figures: number;
}

/** `ai`: written by a model and then checked by the gate. `stored_data`: assembled from stored text, no model. */
export type CompanyReportStatus = 'ai' | 'stored_data';

export interface CompanyReport {
  companyId: string;
  companyName: string;
  generatedAt: string;
  headline: string;
  /** Two or three sentences: the report in brief. */
  abstract: string;
  /** Source ids the abstract rests on. */
  abstractCitations?: string[];
  basedOn: CompanyReportBasis;
  status: CompanyReportStatus;
  sections: CompanyReportSection[];
  sources: CompanyReportSource[];
}

/** What the repository hands back: the report, and whether the research has moved on since it was written. */
export interface CompanyReportResult {
  report: CompanyReport;
  /** True when the stored research now differs from what the report was written from. */
  stale: boolean;
  /** Plain-language note when the report is not what was asked for ("no model key", "update failed"). */
  notice?: string | null;
}

const ids = z.array(z.string()).catch([]);
const itemSchema = z.object({ text: z.string(), citations: ids });
const figureSchema = z.object({
  metricType: z.string(),
  label: z.string(),
  display: z.string().nullable().catch(null),
  trust: z.enum(['verified', 'user_verified', 'estimated', 'unknown']).catch('unknown'),
  asOf: z.string().nullable().catch(null),
  citations: ids,
});
const blockSchema = z.object({
  type: z.enum(COMPANY_REPORT_BLOCK_TYPES),
  text: z.string().catch(''),
  citations: ids,
  items: z.array(itemSchema).optional(),
  figures: z.array(figureSchema).optional(),
  attribution: z.string().optional(),
});
const sourceSchema = z.object({
  id: z.string(),
  kind: z.enum(COMPANY_REPORT_SOURCE_KINDS),
  title: z.string(),
  url: z.string().nullable().catch(null),
  excerpt: z.string().nullable().catch(null),
  asOf: z.string().nullable().catch(null),
});

/** Validates a stored or received report; a malformed one fails and is simply not shown. */
export const companyReportSchema = z.object({
  companyId: z.string(),
  companyName: z.string(),
  generatedAt: z.string(),
  headline: z.string(),
  abstract: z.string().catch(''),
  abstractCitations: z.array(z.string()).optional(),
  basedOn: z.object({
    dataHash: z.string(),
    sources: z.number().catch(0),
    notes: z.number().catch(0),
    tabs: z.number().catch(0),
    tabNames: z.array(z.string()).catch([]),
    figures: z.number().catch(0),
  }),
  status: z.enum(['ai', 'stored_data']),
  sections: z.array(z.object({
    id: z.enum(COMPANY_REPORT_SECTION_IDS),
    title: z.string(),
    blocks: z.array(blockSchema),
  })),
  sources: z.array(sourceSchema),
});
