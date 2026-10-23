/**
 * The Company Report for the keyless demo deck.
 *
 * The sample repository holds research but no model, so its report is always the stored-data one: assembled from the
 * sample's own stored tabs, figures and notes, free, with no commentary. It is built by the same engine as the real
 * report (readCompanyReport / writeCompanyReport), so the demo shows the real document shape. Nothing is invented and
 * nothing is spent: with no client the engine never calls a model.
 */
import { readCompanyReport, writeCompanyReport, type ReportHost } from '@mi/research';
import type { CompanyReport, MarketIntelRepository } from '@mi/contracts';

export function installDemoCompanyReport(repo: MarketIntelRepository, now: () => Date = () => new Date()): MarketIntelRepository {
  const kept = new Map<string, CompanyReport>();
  const host: ReportHost = {
    company: (id) => repo.getCompany(id),
    tab: (id, tab) => (repo.peekDashboardTab ? repo.peekDashboardTab(id, tab) : Promise.resolve(null)),
    metrics: (id) => (repo.getCompanyFacts ? repo.getCompanyFacts(id) : repo.getCompanyMetrics(id)),
    evidence: async (id) => {
      const passages = (await repo.searchResearchCorpus?.({ query: '', companyIds: [id], limit: 60 })) ?? [];
      return passages.map((p) => ({
        id: p.evidenceId, companyId: id, topic: p.topic, capturedAt: p.capturedAt, text: p.snippet, citations: p.citations, queries: [],
      }));
    },
    kept: (id) => kept.get(id),
    keep: async (id, report) => { kept.set(id, report); },
    client: null,
    now,
  };
  return Object.assign(repo, {
    peekCompanyReport: (companyId: string) => readCompanyReport(host, companyId),
    getCompanyReport: (companyId: string, options?: { force?: boolean; signal?: AbortSignal }) => writeCompanyReport(host, companyId, options),
  });
}
