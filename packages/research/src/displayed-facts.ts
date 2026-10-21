/**
 * The facts a company's card and dashboard actually show, composed from the
 * stored ledger. This is the ONE composition of the read path:
 *
 *   raw observations → projectCompanyFacts (original-backed acceptance)
 *                    → savedCompanyProfile (offline recovery from the latest
 *                      retained company_profile, roster-guarded)
 *                    → applySourceChecks (a figure whose page does not state
 *                      it is hidden; a confirming page becomes the citation)
 *
 * GeminiRepository.projectedFacts/getCompanyFacts and the completeness report
 * both call it, so "what the user sees" and "what the scoreboard counts as
 * filled" cannot drift apart.
 *
 * Pure: no provider, no storage. The caller supplies the scoped original
 * receipts (the repository reads them through its original-source service,
 * which on desktop lives outside the snapshot).
 */
import type { Company, CompanyMetric } from '@mi/contracts';
import { projectCompanyFacts } from './company-facts';
import { assessedForDisplay, companyDomainOf } from './metric-assessment';
import type { OriginalSourceAttempt } from './original-source';
import type { ResearchEvidence } from './research-evidence';
import { savedCompanyProfile } from './saved-profile';
import { applySourceChecks, type SourceChecks } from './source-binding';

export interface DisplayedFactsInput {
  company: Company;
  /** The whole metric ledger, or this company's rows; others are ignored. */
  metrics: readonly CompanyMetric[];
  /** Original-source attempts already scoped to this company (or unscoped; projection re-scopes). */
  attempts: readonly OriginalSourceAttempt[];
  evidence: readonly ResearchEvidence[];
  /** The market roster, excluding this company: enables roster-guarded profile recovery. */
  otherCompanies?: readonly string[];
  sourceChecks?: SourceChecks;
  /** The clock for figure ages; defaults to the present. */
  now?: Date;
}

/** Facts before source binding hides or relinks any (the repository's projectedFacts). */
export function projectedCompanyFacts(input: Omit<DisplayedFactsInput, 'sourceChecks'>): CompanyMetric[] {
  const current = projectCompanyFacts(input.company, [...input.metrics], [...input.attempts]);
  return savedCompanyProfile(input.company, current, input.evidence, input.otherCompanies).metrics;
}

/** Facts exactly as getCompanyFacts serves them. */
export function displayedCompanyFacts(input: DisplayedFactsInput): CompanyMetric[] {
  return assessedFacts(applySourceChecks(input.company.id, projectedCompanyFacts(input), input.sourceChecks), input.company, input.now);
}

/** Every shown figure assessed afresh from its stored citations (so rows saved before
 * assessments existed get one), with a `verified` label its evidence no longer supports
 * lowered. Values are never changed or dropped. */
export function assessedFacts(facts: readonly CompanyMetric[], company: Pick<Company, 'websiteUrl'>, now: Date = new Date()): CompanyMetric[] {
  const domain = companyDomainOf(company.websiteUrl);
  return facts.map((fact) => assessedForDisplay(fact, now, domain));
}
