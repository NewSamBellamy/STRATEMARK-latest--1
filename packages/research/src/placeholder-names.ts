/**
 * The one definition of "this is a template row, not a business".
 *
 * A structured-output model under a minimum-count schema pads a short roster
 * with invented rows ("Company Two … Placeholder company to satisfy minimum
 * count"). Every place a candidate becomes a stored company, and the load-time
 * revalidation of stored companies, asks this one function. The match is on the
 * WHOLE name, so real companies that merely contain a generic word
 * ("Company.com", "Vendr", "Example Health") are never rejected.
 */
const GENERIC = '(?:company|placeholder|entity|startup|firm|vendor|player|competitor|example|sample|organi[sz]ation|business|provider|supplier|brand|demo|test|dummy|generic|fictional|hypothetical|unnamed|unknown)';
const ORDINAL = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|first|second|third|fourth|fifth)';
const SLOT = String.raw`(?:[a-z]|\d{1,3}|${ORDINAL})`;
const LEGAL = '(?:corp|corporation|inc|incorporated|co|company|llc|ltd|limited|gmbh|plc|industries|enterprises|group|holdings|technologies|systems|solutions|labs?)';

const PLACEHOLDER_NAME_PATTERNS: readonly RegExp[] = [
  // "Company Two", "Company 7", "Competitor A", "Vendor #3", "Startup", "Company"
  new RegExp(String.raw`^${GENERIC}\s*[-#:]?\s*${SLOT}?$`, 'i'),
  // "Example Corp", "Sample Inc", "Acme", "Acme Corp", "Demo Company", "Foo Bar Inc"
  new RegExp(String.raw`^(?:example|sample|demo|test|dummy|foo\s*bar|lorem\s*ipsum|john\s*doe|widget|your)\s*(?:${LEGAL})?(?:\s*${SLOT})?$`, 'i'),
  // "Unknown company", "Another startup", "Other competitor", "Generic vendor"
  new RegExp(String.raw`^(?:unknown|unnamed|untitled|another|other|additional|generic|fictional|hypothetical|new|next|\w+\s+related)\s+${GENERIC}\s*${SLOT}?$`, 'i'),
  // "Company Name", "[Company Name]", "<company>", "Your Company"
  new RegExp(String.raw`^[\[<(]?\s*(?:your\s+|insert\s+|the\s+)?${GENERIC}(?:\s+name)?\s*[\]>)]?$`, 'i'),
  // Not-a-name tokens.
  /^(?:tbd|tba|tbc|n\/?a|none|null|undefined|unknown|unnamed|untitled|etc\.?|\.{2,}|…|\?+|-+|_+)$/i,
];

const PLACEHOLDER_DESCRIPTOR =
  /\b(?:placeholder|to satisfy|minimum count|fictional|hypothetical|dummy entry|example company)\b/i;

/** A row the model made up to fill a count, not a business it found. */
export function isPlaceholderCompany(name: string, descriptor?: string | null): boolean {
  const flat = name.normalize('NFKC').trim().replace(/[.,;:!]+$/, '').replace(/\s+/g, ' ');
  if (!flat) return true;
  return PLACEHOLDER_NAME_PATTERNS.some((re) => re.test(flat)) || PLACEHOLDER_DESCRIPTOR.test(descriptor ?? '');
}

/** Name-only form, for stored rows whose descriptor is free human-readable copy. */
export function hasPlaceholderName(name: string): boolean {
  return isPlaceholderCompany(name, null);
}
