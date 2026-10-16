import type { Company, CompanyMetric } from '@mi/contracts';

/**
 * What kind of company this is, for choosing what its tabs research first.
 * Read only from figures already on file with a value (never from a model's
 * say-so), so a type can be wrong only the way the stored facts are. It steers
 * where a search looks; it never adds, removes or relabels a figure.
 */
export type CompanyListing = 'public' | 'private' | 'unknown';
export type CompanyStage = 'enterprise' | 'startup' | 'smb' | 'local' | 'unknown';
export interface CompanyType { listing: CompanyListing; stage: CompanyStage }

// A business people visit in person: its story is its locations and its reviews.
const LOCAL_PATTERN =
  /\b(?:restaurants?|caf[eé]s?|coffee shops?|baker(?:y|ies)|bars?|pubs?|breweries|brewery|salons?|barbers?|spas?|gyms?|fitness studios?|dental|dentists?|clinics?|veterinar(?:y|ians?)|plumb(?:er|ers|ing)|electricians?|roofing|landscaping|auto repair|car wash|dry clean\w*|florists?|boutiques?|hotels?|motels?|inns?|daycares?|grocer(?:y|s)|pharmac(?:y|ies)|real estate agen(?:cy|ts?))\b/i;

type Fact = Pick<CompanyMetric, 'metricType' | 'value' | 'confidence' | 'citations'>;

export function classifyCompanyType(company: Pick<Company, 'oneLiner'>, facts: readonly Fact[]): CompanyType {
  // Only a figure the app would show: entered by a person, or sourced. An uncited "verified" is withheld on read, so it is ignored here too.
  const known = (type: Fact['metricType']) => facts.find((f) => f.metricType === type && f.value != null && f.confidence !== 'unknown' &&
    (f.confidence === 'user_verified' || (f.citations?.length ?? 0) > 0));
  const funded = Boolean(known('last_round') || known('funding_total'));
  const listing: CompanyListing = known('market_cap') ? 'public' : funded ? 'private' : 'unknown';
  const employees = known('employees')?.value ?? null;
  const stage: CompanyStage = listing === 'public' || (employees != null && employees >= 1000) ? 'enterprise'
    : LOCAL_PATTERN.test(company.oneLiner) && (employees == null || employees < 250) ? 'local'
      : funded ? 'startup'
        : employees != null ? 'smb' : 'unknown';
  return { listing, stage };
}

/** What a company's shared tab searches should look for first, by type; null when the type is not known. */
export function companyTypeFocus(type: CompanyType): string | null {
  if (type.listing === 'public') return 'It is a listed company: start from what its annual and quarterly filings and investor pages report (business segments, reported products, named executive officers, dated corporate events).';
  switch (type.stage) {
    case 'startup': return 'It is a venture-backed private company: cover each funding round with its date, amount and named lead investors where sources state them, and its founders and early team.';
    case 'local': return 'It is a local business: cover its locations and what each offers, when each opened, its owners, and what named review sites and local press say about it.';
    case 'enterprise': return 'It is a large company: cover its divisions and main brands, and the executives who run them.';
    case 'smb': return 'It is a small private business: cover its services, where it operates, its owners and its named customers.';
    default: return null;
  }
}
