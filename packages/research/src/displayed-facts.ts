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
import { isSignalCardType, type CardWithCompany, type Company, type CompanyMetric, type MetricType } from '@mi/contracts';
import { assessFacts } from './assess-facts';
import { companyOriginalReceipts, projectCompanyFacts } from './company-facts';
import { isOriginalSourceAttempt, originalSupportReferences, type OriginalSourceAttempt } from './original-source';
import type { ResearchEvidence } from './research-evidence';
import { savedCompanyProfile } from './saved-profile';
import { pageDatesOf, type PageDates } from './source-assessment';
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
export function projectedCompanyFacts(input: Omit<DisplayedFactsInput, 'sourceChecks'>, options: { showAgedOut?: boolean; agedOut?: Set<MetricType> } = {}): CompanyMetric[] {
  const current = projectCompanyFacts(input.company, [...input.metrics], [...input.attempts],
    { nowMs: input.now.getTime(), showAgedOut: options.showAgedOut, agedOut: options.agedOut });
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
  const shownAgedOut = new Set<MetricType>();
  const shown = applySourceChecks(input.company.id, projectedCompanyFacts(input, { showAgedOut: true, agedOut: shownAgedOut }), input.sourceChecks);
  return assessFacts(shown, { company: input.company, rivalWebsites: input.rivalWebsites, now: input.now, shownAgedOut,
    pageDates: companyPageDates(input.company.id, input.metrics, input.attempts, input.sourceChecks) });
}

/**
 * The publication dates this company's saved pages (and source checks) recorded, for
 * assessFacts: an upper bound that can only make a figure look older.
 */
export function companyPageDates(companyId: string, metrics: readonly CompanyMetric[], attempts: unknown, sourceChecks?: SourceChecks): PageDates {
  const receipts = companyOriginalReceipts(companyId, attempts, originalSupportReferences([...metrics], companyId));
  const checks = Object.entries(sourceChecks ?? {}).filter(([key]) => key.startsWith(`${companyId}|`)).map(([, check]) => check);
  return pageDatesOf(receipts, checks);
}

/**
 * The websites of the other companies in the card's deck (one deck is one market): what the
 * repository reads from its market roster. The card read paths (apps/api, SentinelRepository)
 * pass this to projectCompanyCardFacts so a source on a rival's domain reads as a competitor's
 * everywhere, not only where the roster happens to be at hand. Signal cards own no company.
 */
export function deckRivalWebsites(card: CardWithCompany, deckCards: readonly CardWithCompany[]): string[] {
  const own = card.company?.id;
  const sites = deckCards.flatMap((row) => row.company && row.company.id !== own && !isSignalCardType(row.card.cardType) && row.company.websiteUrl
    ? [row.company.websiteUrl] : []);
  return [...new Set(sites)];
}

/**
 * A card's facts through the SAME read-time composition as getCompanyFacts: accepted facts
 * (an old verified figure shows as a dated estimate), assessed afresh with an injected
 * clock; any assessment on the incoming card is discarded. A signal card gets no facts.
 */
export function projectCompanyCardFacts(card: CardWithCompany, attempts: unknown, options: { now: Date; rivalWebsites?: readonly string[] }): CardWithCompany {
  const copy = structuredClone(card);
  if (!card.company || isSignalCardType(card.card.cardType)) return { ...copy, metrics: [] };
  const valid = Array.isArray(attempts) ? attempts.filter(isOriginalSourceAttempt) : [];
  return { ...copy, metrics: displayedCompanyFacts({ company: card.company, metrics: card.metrics, attempts: valid, evidence: [],
    now: options.now, rivalWebsites: options.rivalWebsites }) };
}
