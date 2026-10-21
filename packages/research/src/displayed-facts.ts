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
import { assessFacts } from './assess-facts';
import { projectCompanyFacts } from './company-facts';
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
  /** The clock for figure ages and the 366-day window: injected, never read here. */
  now: Date;
  /** Websites of the market's other companies: a source on one of them reads as a competitor's. */
  rivalWebsites?: readonly string[];
}

/** Facts before source binding hides or relinks any (the repository's projectedFacts). */
export function projectedCompanyFacts(input: Omit<DisplayedFactsInput, 'sourceChecks'>, options: { showAgedOut?: boolean } = {}): CompanyMetric[] {
  const current = projectCompanyFacts(input.company, [...input.metrics], [...input.attempts], { nowMs: input.now.getTime(), showAgedOut: options.showAgedOut });
  return savedCompanyProfile(input.company, current, input.evidence, input.otherCompanies).metrics;
}

/**
 * The accepted facts BEFORE any currency effect: what hunt-target and readiness
 * decisions read, so hunt cost does not change (assess-facts.ts).
 */
export function acceptedCompanyFacts(input: DisplayedFactsInput): CompanyMetric[] {
  return applySourceChecks(input.company.id, projectedCompanyFacts(input), input.sourceChecks);
}

/**
 * Facts exactly as getCompanyFacts serves them: accepted facts (an old verified or
 * quoted figure shows as a dated estimate instead of vanishing), then assessed afresh
 * with the effects applied. Any assessment already on a row is discarded.
 */
export function displayedCompanyFacts(input: DisplayedFactsInput): CompanyMetric[] {
  const shown = applySourceChecks(input.company.id, projectedCompanyFacts(input, { showAgedOut: true }), input.sourceChecks);
  return assessFacts(shown, { company: input.company, rivalWebsites: input.rivalWebsites, now: input.now });
}
