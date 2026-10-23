/**
 * The repository-facing half of the living company report: read (free) and write (one model call, on request).
 *
 * The repository hands over a small host (what it holds and a way to keep a report); everything about when to spend
 * lives here, so it is testable with a fake host and the 7k-line repository only carries thin hooks.
 *
 *   read  - never researches, never calls a model. The kept report, marked stale when the stored research has moved
 *           on since; with none kept, the stored-data report (free, deterministic), never cached.
 *   write - a current report is returned for free. Otherwise one compose call. A model report is kept by data hash;
 *           a stored-data report is not kept (it is free to rebuild). When the update fails and an earlier model
 *           report exists, that report stays, with a notice.
 */
import {
  companyReportSchema,
  type Company,
  type CompanyMetric,
  type CompanyReport,
  type CompanyReportResult,
  type DashboardTab,
} from '@mi/contracts';
import type { ResearchEvidence } from './research-evidence';
import type { LlmClient } from './types';
import { REPORT_TABS, gatherReportInputs, type ReportInputs } from './living-report-inputs';
import { buildStoredDataReport, composeCompanyReport, isReportStale, type ReportFallbackReason } from './living-report';

export interface ReportHost {
  company(companyId: string): Pick<Company, 'id' | 'name' | 'oneLiner' | 'websiteUrl' | 'hqLocation' | 'founded'> | null;
  /** A stored tab as the dashboard shows it, or null; never researches. */
  tab(companyId: string, tab: DashboardTab): Promise<{ content: unknown; lastRefreshedAt?: string | null } | null>;
  metrics(companyId: string): Promise<CompanyMetric[]>;
  evidence(companyId: string): ResearchEvidence[];
  /** The report kept for this company, unvalidated. */
  kept(companyId: string): unknown;
  keep(companyId: string, report: CompanyReport): Promise<void>;
  client: Pick<LlmClient, 'structure'> | null;
  now: () => Date;
}

const NOTICES: Record<ReportFallbackReason, string> = {
  no_model: 'No AI model is available, so this report is assembled from your stored research without commentary.',
  too_little_evidence: 'There is not enough stored research to write from yet, so this report shows what is stored.',
  model_failed: 'The AI update did not finish, so this report is assembled from your stored research without commentary.',
  gate_rejected: 'The AI draft did not pass the source check, so this report is assembled from your stored research without commentary.',
};

export async function reportInputsFor(host: ReportHost, companyId: string): Promise<ReportInputs | null> {
  const company = host.company(companyId);
  if (!company) return null;
  const tabs: Parameters<typeof gatherReportInputs>[0]['tabs'] = {};
  for (const tab of REPORT_TABS) {
    const stored = await host.tab(companyId, tab).catch(() => null);
    if (stored) tabs[tab] = stored;
  }
  return gatherReportInputs({ company, tabs, metrics: await host.metrics(companyId).catch(() => []), evidence: host.evidence(companyId) });
}

function keptReport(host: ReportHost, companyId: string): CompanyReport | null {
  const raw = host.kept(companyId);
  const parsed = raw ? companyReportSchema.safeParse(raw) : null;
  return parsed?.success && parsed.data.companyId === companyId ? (parsed.data as CompanyReport) : null;
}

export async function readCompanyReport(host: ReportHost, companyId: string): Promise<CompanyReportResult | null> {
  const inputs = await reportInputsFor(host, companyId);
  if (!inputs) return null;
  const kept = keptReport(host, companyId);
  if (kept) return { report: kept, stale: isReportStale(kept, inputs) };
  return { report: buildStoredDataReport(inputs, host.now), stale: false, notice: 'This report is assembled from your stored research. Write the full report to add analyst commentary.' };
}

export async function writeCompanyReport(host: ReportHost, companyId: string, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<CompanyReportResult> {
  const inputs = await reportInputsFor(host, companyId);
  if (!inputs) throw new Error('Company not found for its report.');
  const kept = keptReport(host, companyId);
  if (kept && !options.force && !isReportStale(kept, inputs)) return { report: kept, stale: false };

  const outcome = await composeCompanyReport({ inputs, client: host.client, now: host.now, signal: options.signal });
  if (outcome.report.status === 'ai') {
    await host.keep(companyId, outcome.report);
    return { report: outcome.report, stale: false };
  }
  // The update fell back. An earlier model report is better than a plainer one: keep showing it, and say why.
  const why = outcome.fallback ? NOTICES[outcome.fallback] : null;
  if (kept) return { report: kept, stale: isReportStale(kept, inputs), notice: `The report could not be updated. ${why ?? ''}`.trim() };
  return { report: outcome.report, stale: false, notice: why };
}
