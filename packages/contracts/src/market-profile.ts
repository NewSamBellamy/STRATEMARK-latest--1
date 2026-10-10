import type { MetricType } from './enums';

/**
 * Market profiles: how a card fits its market instead of forcing every company
 * through an operating-company template.
 *
 * The beta's documented failure mode: a venture-capital deck rendered as a
 * ghost town. a16z's card showed 738 employees (real, SEC Form ADV) and three
 * honest Unknowns — while its own retained research said "$42 billion in AUM",
 * a figure the operating-company slot template could neither hunt nor display.
 * The metrics pipeline was honest; the CARD was shaped for the wrong market.
 *
 * A profile is derived from what the company IS (its name and one-liner), never
 * asserted by a model, so a deck can never talk itself into a looser gate.
 * Classification is deliberately conservative: a missed financial firm keeps
 * today's behavior (users/ARR hunted, AUM slot absent), while a false financial
 * firm would suppress ARR hunting — so service-provider phrasing ("platform for
 * private equity") is excluded below.
 */
export type MarketProfile = 'operating_company' | 'financial_firm';

/** Firms whose scale metric is assets under management, not revenue per user. */
const FINANCIAL_FIRM_PATTERN =
  /\b(?:venture capital|venture firm|vc firm|private equity|asset management|asset manager|hedge fund|investment bank|investment banking|family office|wealth management|private credit|growth equity|fund manager|capital management|merchant bank)\b/i;

// "Platform for private equity" serves the industry; it is not itself the fund.
const SERVES_FINANCIAL_PATTERN =
  /\b(?:for|serves?|serving|power(?:ed|ing)?|built)\s+(?:the\s+)?(?:venture capital|private equity|hedge funds?|asset manag\w+|investment bank\w+|family offices?|wealth manag\w+|financial (?:advisors?|institutions?|firms?))\b/i;

export interface MarketProfileInput {
  name?: string | null;
  oneLiner?: string | null;
}

export function classifyMarketProfile(company: MarketProfileInput | null | undefined): MarketProfile {
  const text = `${company?.name ?? ''} ${company?.oneLiner ?? ''}`;
  if (!FINANCIAL_FIRM_PATTERN.test(text)) return 'operating_company';
  return SERVES_FINANCIAL_PATTERN.test(text) ? 'operating_company' : 'financial_firm';
}

/**
 * The metric types worth RESEARCHING per profile, priority order first. Hunt
 * targeting, hunt prompt ordering and verification candidates all read from
 * this table, so a financial firm's budget goes to AUM first — never to a
 * search for "a16z ARR" (a figure that does not exist and never will).
 */
export function profileMetricTypes(profile: MarketProfile): readonly MetricType[] {
  return profile === 'financial_firm'
    ? ['aum', 'employees', 'market_cap', 'valuation', 'market_share']
    : ['market_cap', 'valuation', 'market_share', 'arr', 'users', 'employees'];
}

/**
 * The card's four front slots per profile, in display order. Operating company
 * is the original four (spec §6.1). A financial firm leads with AUM — the
 * headline scale figure for the profile — and keeps the value slot; the ARR
 * slot stays last because public financials (Blackstone, KKR) do report
 * revenue, and where it stays Unknown that is the honest answer. Adding a
 * real-estate or biotech profile later is one more table row plus one regex.
 */
export const PROFILE_CORE_SLOTS: Record<MarketProfile, readonly (readonly MetricType[])[]> = {
  operating_company: [['employees'], ['arr'], ['users'], ['valuation', 'market_cap']],
  financial_firm: [['aum'], ['employees'], ['valuation', 'market_cap'], ['arr']],
};
