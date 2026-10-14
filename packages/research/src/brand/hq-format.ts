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

function usState(part: string, allowCode: boolean): string | null {
  const key = STATE_ALIASES[part.toLowerCase()] ?? part;
  if (allowCode && /^[A-Za-z]{2}$/.test(key) && US_STATES[key.toUpperCase()] && (key === key.toUpperCase() || key === 'DC')) return US_STATES[key.toUpperCase()]!;
  return STATE_BY_NAME.get(part.toLowerCase()) ?? (key === 'DC' ? US_STATES.DC! : null);
}

function country(part: string): string {
  return COUNTRY_CODES[part.toUpperCase()] && /^[A-Za-z]{2,3}$/.test(part) ? COUNTRY_CODES[part.toUpperCase()]! : cased(part);
}

export function canonicalHqLocation(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const parts = raw.split(',')
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
  // A state anywhere after the city: a two-letter code only when the country
  // is the US or unstated ("Toronto, ON, Canada" is not Oregon).
  const regions = isUs ? rest.slice(0, -1) : rest.length === 1 ? rest : [];
  const state = regions.map((part) => usState(part, isUs || rest.length === 1)).find(Boolean);
  if (state) return `${city}, ${state}`;
  if (isUs) return `${city}, United States`;
  const named = country(last);
  return named.toLowerCase() === city.toLowerCase() ? city : `${city}, ${named}`;
}
