/**
 * One display form for a headquarters location, whatever lane wrote it:
 *
 *   US:      "City, Full State"      ("San Francisco, California")
 *   non-US:  "City, Country"         ("Zurich, Switzerland")
 *
 * Title Case, states and the common country codes spelled out, no street, ZIP
 * or region between city and country. A US location whose state is unknown
 * keeps its country ("Austin, United States"); input this cannot read is kept
 * as written (cleaned of digits and stray spacing) rather than guessed at.
 * A two-letter code that is both a US state and a country ("IN", "CA") is
 * read as a state only on positive US evidence; otherwise it stays as written.
 * Pure formatting: it never adds a place the input did not state.
 */

export const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico',
};

/** Country codes common in JSON-LD and model output, spelled out. */
export const COUNTRY_CODES: Record<string, string> = {
  GB: 'United Kingdom', UK: 'United Kingdom', CH: 'Switzerland', DE: 'Germany', FR: 'France', CN: 'China',
  JP: 'Japan', CA: 'Canada', IL: 'Israel', IN: 'India', NL: 'Netherlands', SE: 'Sweden', AU: 'Australia',
  SG: 'Singapore', IE: 'Ireland', ES: 'Spain', IT: 'Italy', KR: 'South Korea', NO: 'Norway', DK: 'Denmark',
  FI: 'Finland', BE: 'Belgium', AT: 'Austria', BR: 'Brazil', LU: 'Luxembourg', HK: 'Hong Kong', NZ: 'New Zealand',
  MX: 'Mexico', AE: 'United Arab Emirates', UAE: 'United Arab Emirates',
};

const US_NAMES = /^(?:us|usa|u\.s\.?|u\.s\.a\.?|united states(?: of america)?|america)$/i;
const CITY_ALIASES: Record<string, string> = { nyc: 'New York', 'new york city': 'New York', sf: 'San Francisco' };
const STATE_BY_NAME = new Map(Object.values(US_STATES).map((name) => [name.toLowerCase(), name]));
const STATE_ALIASES: Record<string, string> = { 'd.c.': 'DC', 'd.c': 'DC', 'washington d.c.': 'DC', 'washington, d.c.': 'DC' };

/** "ROUND ROCK" -> "Round Rock", "ST. LOUIS" -> "St. Louis". */
export function titleCase(raw: string): string {
  return raw.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_m, lead: string, ch: string) => `${lead}${ch.toUpperCase()}`);
}

/** Title Case only text written all upper or all lower case ("NEW YORK",
 * "zurich"); mixed case ("McLean", "São Paulo") is the source's own spelling. */
function cased(part: string): string {
  return part === part.toUpperCase() || part === part.toLowerCase() ? titleCase(part) : part;
}

/**
 * Every ISO 3166-1 alpha-2 country code. A two-letter code that is both a US
 * state and a country ("IN" India/Indiana, "CA" Canada/California, "DE",
 * "GA", "PA" ...) says nothing on its own about which was meant.
 */
const ISO_ALPHA2 = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ '
  + 'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR '
  + 'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP '
  + 'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT '
  + 'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW '
  + 'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG '
  + 'UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));

/** A US state code that is also a country code: read as a state only with US evidence. */
export function ambiguousRegionCode(code: string): boolean {
  const key = code.toUpperCase();
  // Puerto Rico is Puerto Rico under either reading.
  return Boolean(US_STATES[key]) && ISO_ALPHA2.has(key) && key !== 'PR';
}

/**
 * A US state from a region part. A two-letter code is read as a state only
 * on positive US evidence (`usEvidence`: the text names the US, or the
 * caller knows the address is a US filing), or when the code cannot also be
 * a country ("TX", "NY", "OR"). Full state names are always read.
 */
function usState(part: string, usEvidence: boolean): string | null {
  const key = STATE_ALIASES[part.toLowerCase()] ?? part;
  if (/^[A-Za-z]{2}$/.test(key) && US_STATES[key.toUpperCase()]) {
    const code = key.toUpperCase();
    // Lower-case "in" / "or" are words, not codes, unless the US is stated.
    if (!usEvidence && key !== code) return null;
    return usEvidence || !ambiguousRegionCode(code) ? US_STATES[code]! : null;
  }
  return STATE_BY_NAME.get(part.toLowerCase()) ?? (key === 'DC' ? US_STATES.DC! : null);
}

function country(part: string): string {
  if (!/^[A-Za-z]{2,3}$/.test(part)) return cased(part);
  const code = part.toUpperCase();
  // "Toronto, CA" / "Mumbai, IN": kept as written. Spelling the code out as
  // either the country or the state would choose a fact the text did not state.
  if (ambiguousRegionCode(code)) return code;
  return COUNTRY_CODES[code] ?? cased(part);
}

export interface HqFormatOptions {
  /** The address is a US filing (SEC submissions): its region codes are states. */
  usFiler?: boolean;
}

export function canonicalHqLocation(raw: string | null | undefined, options: HqFormatOptions = {}): string | null {
  if (raw == null) return null;
  // "Miami, FL / Dallas, Texas": two places in one string. Only the first is
  // the headquarters; joining its city to the last region invents a place.
  let first = raw.split(/\s*[;|/]\s*|\s+(?:and|&|with|plus)\s+|\s*\(/i)[0] ?? raw;
  // "San Ratael / San Francisco, California, United States": a slash or pipe
  // offers alternatives, and the region and country written after the last
  // one belong to it. A bare first alternative is the place the text did not
  // state in full, so the first qualified alternative is kept instead.
  if (!first.includes(',')) {
    const alternatives = (raw.split(/\s*[;(]|\s+(?:and|&|with|plus)\s+/i)[0] ?? raw).split(/\s*[|/]\s*/);
    first = alternatives.find((alt) => alt.includes(',')) ?? first;
  }
  const parts = first.split(',')
    // A street line ("100 Main St") is never the place; a ZIP or postal code
    // beside a state ("CA 94105") is dropped from it.
    .filter((part) => !/^\s*\d/.test(part))
    .map((part) => part.replace(/\b[A-Z]{0,2}\d[\dA-Z-]*\b/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 0 && part.length <= 60);
  if (!parts.length) return null;
  const cityRaw = parts[0]!;
  const city = CITY_ALIASES[cityRaw.toLowerCase()] ?? cased(cityRaw);
  if (parts.length === 1) return city;
  const rest = parts.slice(1);
  const last = rest[rest.length - 1]!;
  const isUs = US_NAMES.test(last);
  const usEvidence = isUs || Boolean(options.usFiler);
  // A state anywhere after the city when the country is the US or unstated
  // ("Toronto, ON, Canada" is not Oregon).
  // A state written right after the city belongs to that city, even when
  // more places follow ("Miami, FL, Dallas, TX" is Miami, Florida).
  const adjacent = !isUs && rest.length > 1 ? usState(rest[0]!, usEvidence) : null;
  if (adjacent && !ambiguousRegionCode(rest[0]!)) return `${city}, ${adjacent}`;
  const regions = isUs ? rest.slice(0, -1) : rest.length === 1 ? rest : [];
  const state = regions.map((part) => usState(part, usEvidence)).find(Boolean);
  if (state) return `${city}, ${state}`;
  if (isUs) {
    // A region the text stated but this cannot read is kept, never dropped.
    const region = regions.find((part) => !US_NAMES.test(part));
    return region ? `${city}, ${cased(region)}, United States` : `${city}, United States`;
  }
  const named = country(last);
  return named.toLowerCase() === city.toLowerCase() ? city : `${city}, ${named}`;
}

const escapeRe = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LINK = String.raw`[\s,.(–—-]{1,3}(?:in\s+|of\s+)?`;

/**
 * Keeps a "City, State" headquarters derivable from the evidence text that
 * supports it. Where the text names the city, the state must stand beside it;
 * otherwise only what the text literally says is kept: the state it puts
 * beside that city, or the bare city. Text that never names the city cannot
 * speak for the location, which is returned unchanged.
 */
export function hqGroundedInEvidence(location: string | null | undefined, evidence: string | null | undefined): string | null {
  if (!location) return null;
  const at = location.lastIndexOf(', ');
  if (at < 0 || !evidence) return location;
  const city = location.slice(0, at);
  const state = location.slice(at + 2);
  const code = Object.entries(US_STATES).find(([, name]) => name === state)?.[0];
  if (!code) return location;
  const cityRe = String.raw`\b${escapeRe(city)}`;
  if (!new RegExp(String.raw`${cityRe}(?!\w)`, 'i').test(evidence)) return location;
  const beside = (name: string, abbr: string): boolean => new RegExp(String.raw`${cityRe}${LINK}${escapeRe(name)}\b`, 'i').test(evidence)
    // A code that is also a word or country ("IN", "OR") counts only in capitals.
    || new RegExp(String.raw`${cityRe}${LINK}${abbr}\b`, ambiguousRegionCode(abbr) ? '' : 'i').test(evidence);
  if (beside(state, code)) return location;
  for (const [abbr, name] of Object.entries(US_STATES)) {
    if (name !== state && beside(name, abbr)) return `${city}, ${name}`;
  }
  return city;
}
