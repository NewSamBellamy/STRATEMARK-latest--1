import { classifyMarketProfile, type Company, type CompanyMetric } from '@mi/contracts';
import { enrichmentOutSchema } from './schemas';
import { providerCompanySummary, reportedCompanyMetrics } from './reported-metrics';
import type { ResearchEvidence } from './research-evidence';
import { CONFLICTING_OBSERVATIONS_NOTE } from './company-facts';
import { isFreshForMetric } from './capture-age';

/** The single eligibility rule for offline recovery: the latest retained
 * company_profile for exactly this subject and name — newest wins even when
 * the newest record carries no grounding (stale data must not masquerade as
 * current). Both offline projectors (the read projection and the repository's
 * free recovery) select evidence through this — one rule, not two that drift. */
export function latestSavedCompanyProfile(
  company: Pick<Company, 'id' | 'name'>,
  evidence: readonly ResearchEvidence[],
): ResearchEvidence | undefined {
  return evidence
    .filter(row => row.companyId === company.id && row.topic === 'company_profile' && row.companyName === company.name)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
}

/** Offline recovery of literal observations already paid for and saved.
 * Only the latest matching profile is eligible. Never replace an existing
 * observation, invent a selector, or turn provider attribution into verification.
 * `otherCompanies` is the market roster: passing it enables roster-guarded
 * attribution for sentences whose subject is present but not sentence-initial
 * ("As of December 31, 2025, Equinix, Inc. employed…"); without it those
 * fail closed, exactly like the hydration-time gate. */
export function savedCompanyProfile(company: Company, metrics: readonly CompanyMetric[], evidence: readonly ResearchEvidence[],
  otherCompanies?: readonly string[], now: Date = new Date()) {
  const profile = latestSavedCompanyProfile(company, evidence);
  if (!profile) return { company, metrics: [...metrics] };
  const recovered = reportedCompanyMetrics({ companyId: company.id, companyName: company.name, website: company.websiteUrl,
    enrichment: enrichmentOutSchema.parse({ metrics: {} }), text: profile.text, grounding: profile.grounding, capturedAt: profile.capturedAt,
    identity: otherCompanies ? { answerText: profile.grounding?.answerText, otherCompanies } : undefined,
    profile: classifyMarketProfile(company) });
  const current = metrics.filter(row => row.companyId === company.id);
  // A slot withheld because sources disagree is not missing: filling it from the
  // saved profile would show one side of the conflict as fact.
  // A profile captured longer ago than the metric's horizon is dated context, not a current basis: it
  // fills no slot, so the gap stays a gap and a fresh lookup is triggered (never an old guess shown as now).
  const missing = recovered.filter(row => row.value !== null && isFreshForMetric(profile.capturedAt, row.metricType, now) && !current.some(existing => existing.metricType === row.metricType &&
    (existing.value !== null || existing.confidence === 'user_verified' || existing.methodNote === CONFLICTING_OBSERVATIONS_NOTE)));
  return { company: withProfileSummary(company, profile),
    metrics: [...current.filter(row => !missing.some(repair => repair.metricType === row.metricType)), ...missing] };
}

/** The company as its latest saved profile describes it, without re-running
 * metric recovery: for callers that show the company, not its figures. */
export function savedCompanySummary(company: Company, evidence: readonly ResearchEvidence[]): Company {
  const profile = latestSavedCompanyProfile(company, evidence);
  return profile ? withProfileSummary(company, profile) : company;
}

/** A source-backed one-liner replaces only a missing or placeholder one. */
function withProfileSummary(company: Company, profile: ResearchEvidence): Company {
  const summary = providerCompanySummary(company.name, company.websiteUrl, profile.text, profile.grounding);
  return summary && (!company.oneLiner || company.oneLiner.startsWith('No source-backed company snapshot')) ? { ...company, oneLiner: summary.summary } : company;
}
