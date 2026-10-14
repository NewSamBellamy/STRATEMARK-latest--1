/**
 * The registrant profile an SEC submissions feed states about itself: its
 * listed tickers, the website it gives EDGAR (often blank), and its business
 * address. Kept as a bounded slice inside the retained submissions receipt
 * (sec-ownership.ts) so identity and headquarters re-derive from the record.
 */
import { z } from 'zod';
import { canonicalHqLocation, titleCase, US_STATES } from './brand/hq-format';

const MAX_FIELD = 200;
const MAX_TICKERS = 10;

export interface SubmissionsProfile {
  tickers: string[];
  website: string | null;
  investorWebsite: string | null;
  business: { city: string; stateOrCountry: string; stateOrCountryDescription: string | null } | null;
}

const text = (value: unknown, max = MAX_FIELD): string | null =>
  typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null;

/** Reader-side: the profile fields of the raw submissions document. */
export function selectSubmissionsProfile(doc: unknown): SubmissionsProfile {
  const raw = (doc ?? {}) as { tickers?: unknown; website?: unknown; investorWebsite?: unknown; addresses?: { business?: Record<string, unknown> | null } | null };
  const tickers = Array.isArray(raw.tickers)
    ? raw.tickers.filter((t): t is string => typeof t === 'string' && /^[A-Z][A-Z0-9.-]{0,9}$/.test(t)).slice(0, MAX_TICKERS) : [];
  const business = raw.addresses?.business ?? null;
  const city = text(business?.city, 60);
  const stateOrCountry = text(business?.stateOrCountry, 4);
  return {
    tickers,
    website: text(raw.website),
    investorWebsite: text(raw.investorWebsite),
    business: city && stateOrCountry ? { city, stateOrCountry, stateOrCountryDescription: text(business?.stateOrCountryDescription, 60) } : null,
  };
}

export const submissionsProfileSchema = z.object({
  tickers: z.array(z.string().max(10)).max(MAX_TICKERS),
  website: z.string().max(MAX_FIELD).nullable(),
  investorWebsite: z.string().max(MAX_FIELD).nullable(),
  business: z.object({
    city: z.string().max(60),
    stateOrCountry: z.string().max(4),
    stateOrCountryDescription: z.string().max(60).nullable(),
  }).nullable(),
});

const sliceSchema = z.object({
  cik: z.string().regex(/^\d{10}$/),
  name: z.string().min(1),
  profile: submissionsProfileSchema,
});

/** The identity and profile of a retained submissions slice. Null for a slice
 * retained before profiles were kept, or anything unparsable. */
export function parseSubmissionsProfile(slice: string): { cik: string; name: string; profile: SubmissionsProfile } | null {
  try { return sliceSchema.parse(JSON.parse(slice)); } catch { return null; }
}

const placeWord = /^[A-Za-z][A-Za-z .'-]{1,59}$/;

/**
 * A readable place from the business address the registrant filed: "Armonk,
 * New York". A US state code is spelled out; outside the US the filed
 * description is used only when it is a written name, never an EDGAR code
 * ("X0", "A6"). Street, ZIP and anything with digits are never shown.
 */
export function secHeadquartersPlace(profile: SubmissionsProfile | null): string | null {
  const address = profile?.business;
  if (!address || !placeWord.test(address.city)) return null;
  const city = titleCase(address.city.replace(/\s+/g, ' '));
  const state = US_STATES[address.stateOrCountry.toUpperCase()];
  if (state) return canonicalHqLocation(`${city}, ${state}`);
  const description = address.stateOrCountryDescription?.replace(/\s+/g, ' ').trim() ?? '';
  if (description.length < 4 || !placeWord.test(description.replace(/,/g, ''))) return null;
  return canonicalHqLocation(`${city}, ${titleCase(description)}`);
}
