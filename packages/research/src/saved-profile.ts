import type { Company, CompanyMetric } from '@mi/contracts';
import { enrichmentOutSchema } from './schemas';
import { providerCompanySummary, reportedCompanyMetrics } from './reported-metrics';
import type { ResearchEvidence } from './research-evidence';

/** Offline recovery of literal observations already paid for and saved.
 * Only the latest matching profile is eligible. Never replace an existing
 * observation, invent a selector, or turn provider attribution into verification. */
export function savedCompanyProfile(company: Company, metrics: readonly CompanyMetric[], evidence: readonly ResearchEvidence[]) {
  const profile = evidence.filter(row => row.companyId === company.id && row.topic === 'company_profile' && row.companyName === company.name)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
  if (!profile) return { company, metrics: [...metrics] };
  const recovered = reportedCompanyMetrics({ companyId: company.id, companyName: company.name, website: company.websiteUrl,
    enrichment: enrichmentOutSchema.parse({ metrics: {} }), text: profile.text, grounding: profile.grounding, capturedAt: profile.capturedAt });
  const current = metrics.filter(row => row.companyId === company.id);
  const missing = recovered.filter(row => row.value !== null && !current.some(existing => existing.metricType === row.metricType &&
    (existing.value !== null || existing.confidence === 'user_verified')));
  const summary = providerCompanySummary(company.name, company.websiteUrl, profile.text, profile.grounding);
  return { company: summary && (!company.oneLiner || company.oneLiner.startsWith('No source-backed company snapshot')) ? { ...company, oneLiner: summary.summary } : company,
    metrics: [...current.filter(row => !missing.some(repair => repair.metricType === row.metricType)), ...missing] };
}
