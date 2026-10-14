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
// Credit managers describe themselves as lenders and credit investors, not as
// "asset managers": a private-credit deck (Golub, HPS, Ares, Audax Private
// Debt) used to classify mostly as operating companies — no AUM slot on the
// card and no Form ADV lane — while Churchill and Antares, whose descriptors
// happened to say "asset management"/"private credit", got both.
const FINANCIAL_FIRM_PATTERN =
  /\b(?:venture capital|venture firm|vc firm|private equity|asset management|asset managers?|hedge fund|investment bank|investment banking|family office|wealth management|private credit|growth equity|fund manager|capital management|merchant bank|private debt|direct lend(?:er|ers|ing)|middle[- ]market lend(?:er|ers|ing)|credit (?:manager|investment (?:firm|manager)|asset manager|fund manager)|alternative (?:asset|investment) (?:manager|management|firm)s?|investment (?:manager|management firm|firm)s?|business development compan(?:y|ies)|investment partners)\b/i;

// "Platform for private equity" serves the industry; it is not itself the fund.
// "Financing for private equity-backed companies" is a lender's business, not a
// vendor's customer list.
const SERVES_FINANCIAL_PATTERN =
  /\b(?:for|serves?|serving|power(?:ed|ing)?|built)\s+(?:the\s+)?(?:venture capital|private equity|hedge funds?|asset manag\w+|investment bank\w+|family offices?|wealth manag\w+|financial (?:advisors?|institutions?|firms?))\b(?![- ](?:backed|sponsor|owned))/i;

// A manager's "direct lending platform" is its fund franchise, not a product.
const LENDING_FRANCHISE_PATTERN = /\b(?:(?:direct )?lending|credit|financing|investment|investing)\s+platforms?\b/gi;

export interface MarketProfileInput {
  name?: string | null;
  oneLiner?: string | null;
}

// "Venture capital portfolio management software" builds a product for the
// industry: the industry words are its customers, not its business.
const FINANCIAL_PRODUCT_PATTERN =
  /\b(?:software|saas|platform|app|application|tools?|api|fintech|data provider|analytics|crm|erp)\b/i;

export function classifyMarketProfile(company: MarketProfileInput | null | undefined): MarketProfile {
  const text = `${company?.name ?? ''} ${company?.oneLiner ?? ''}`;
  if (!FINANCIAL_FIRM_PATTERN.test(text)) return 'operating_company';
  return SERVES_FINANCIAL_PATTERN.test(text) || FINANCIAL_PRODUCT_PATTERN.test(text.replace(LENDING_FRANCHISE_PATTERN, ' '))
    ? 'operating_company' : 'financial_firm';
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

/** A card face shows this many sourced figures (the strongest, of any type). */
export const CARD_FACE_SIZE = 4;

/** The face shows one figure per family: revenue OR ARR, valuation OR market cap. */
export function faceFamilyOf(type: MetricType): string {
  return type === 'arr' || type === 'revenue' ? 'revenue'
    : type === 'valuation' || type === 'market_cap' ? 'value' : type;
}

/** Card-fact types: small private brands rarely publish ARR or a valuation, so
 * the card face accepts these as ordered alternatives in its slots. */
const CARD_FACT_SLOT_TYPES: readonly MetricType[] = ['revenue', 'funding_total', 'last_round', 'distribution'];

/**
 * What a metrics HUNT should ask for: the profile's research priorities plus
 * every card-fact alternative its face slots accept. A hunt that only asks for
 * profileMetricTypes can never fill a slot whose honest figure is a funding
 * round or a distribution footprint. Derived from PROFILE_CORE_SLOTS so the
 * hunt and the card face cannot drift apart.
 */
export function profileHuntTypes(profile: MarketProfile): readonly MetricType[] {
  const base = profileMetricTypes(profile);
  const slotFacts = PROFILE_CORE_SLOTS[profile].flat().filter((type) => CARD_FACT_SLOT_TYPES.includes(type));
  return [...new Set<MetricType>([...base, ...slotFacts])];
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
  operating_company: [
    ['employees'],
    ['arr', 'revenue', 'funding_total'],
    ['users', 'distribution'],
    ['valuation', 'market_cap', 'last_round', 'funding_total'],
  ],
  financial_firm: [['aum'], ['employees'], ['valuation', 'market_cap'], ['arr']],
};
