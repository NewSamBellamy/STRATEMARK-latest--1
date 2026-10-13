/**
 * Headquarters from free, keyless sources — never a model's recollection.
 *
 * 1. The company's own homepage JSON-LD Organization address (locality +
 *    region/country), already read by the asset lane.
 * 2. Wikidata P159 (headquarters location) + P17 (country), on the item the
 *    homepage links via sameAs, or the single item whose official website
 *    (P856) is the company's own domain. A same-named item on another domain
 *    never speaks for the company.
 */
import { extractOrganizationJsonLd } from '../registries/jsonld';

type FetchLike = typeof fetch;

export interface Headquarters {
  location: string;
  sourceUrl: string;
  via: 'homepage-jsonld' | 'wikidata';
}

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

function rootHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch { return null; }
}

/** "San Mateo, California", "Zurich, Switzerland" — a place, not a street address. */
function place(...parts: Array<string | null | undefined>): string | null {
  const kept: string[] = [];
  for (const part of parts) {
    const clean = part?.replace(/\s+/g, ' ').trim();
    if (!clean || clean.length > 60 || /\d/.test(clean)) continue;
    if (!kept.some((k) => k.toLowerCase() === clean.toLowerCase())) kept.push(clean);
  }
  return kept.length ? kept.join(', ') : null;
}

/** Two-letter country codes are common in JSON-LD; spell the usual ones out. */
const COUNTRY_CODES: Record<string, string> = {
  US: 'USA', USA: 'USA', GB: 'United Kingdom', UK: 'United Kingdom', CH: 'Switzerland', DE: 'Germany',
  FR: 'France', CN: 'China', JP: 'Japan', CA: 'Canada', IL: 'Israel', IN: 'India', NL: 'Netherlands',
  SE: 'Sweden', AU: 'Australia', SG: 'Singapore', IE: 'Ireland', ES: 'Spain', IT: 'Italy', KR: 'South Korea',
  NO: 'Norway', DK: 'Denmark', FI: 'Finland', BE: 'Belgium', AT: 'Austria', BR: 'Brazil',
};

export function homepageHeadquarters(html: string, homepageUrl: string): Headquarters | null {
  const org = extractOrganizationJsonLd(html);
  if (!org?.addressLocality) return null;
  const country = org.addressCountry ? COUNTRY_CODES[org.addressCountry.toUpperCase()] ?? org.addressCountry : null;
  const location = place(org.addressLocality, org.addressRegion && org.addressRegion.length > 2 ? org.addressRegion : null, country);
  return location ? { location, sourceUrl: homepageUrl, via: 'homepage-jsonld' } : null;
}

async function getJson(url: string, doFetch: FetchLike): Promise<unknown> {
  try {
    const res = await doFetch(url, { headers: { accept: 'application/json' } });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

type Entity = { labels?: { en?: { value?: string } }; claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } }; rank?: string }>> };

function claimIds(entity: Entity | undefined, prop: string): string[] {
  const claims = entity?.claims?.[prop] ?? [];
  const preferred = claims.filter((c) => c.rank === 'preferred');
  return (preferred.length ? preferred : claims.filter((c) => c.rank !== 'deprecated'))
    .map((c) => (c.mainsnak?.datavalue?.value as { id?: unknown } | undefined)?.id)
    .filter((id): id is string => typeof id === 'string');
}

async function entities(ids: string[], props: string, doFetch: FetchLike): Promise<Record<string, Entity>> {
  if (!ids.length) return {};
  const data = await getJson(`${WIKIDATA_API}?action=wbgetentities&ids=${ids.map(encodeURIComponent).join('|')}&props=${props}&languages=en&format=json&origin=*`, doFetch) as { entities?: Record<string, Entity> } | null;
  return data?.entities ?? {};
}

export async function wikidataHeadquarters(input: { name: string; websiteUrl: string | null; qid?: string | null; fetchImpl?: FetchLike }): Promise<Headquarters | null> {
  const doFetch = input.fetchImpl ?? fetch;
  const host = rootHost(input.websiteUrl);
  if (!host) return null;
  let candidates = input.qid ? [input.qid] : [];
  if (!candidates.length) {
    const search = await getJson(`${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(input.name)}&language=en&format=json&type=item&limit=7&origin=*`, doFetch) as { search?: Array<{ id?: string }> } | null;
    candidates = (search?.search ?? []).map((s) => s.id).filter((id): id is string => typeof id === 'string');
  }
  const found = await entities(candidates, 'claims', doFetch);
  // Identity by domain: the item's official website must be the company's own.
  const matches = Object.entries(found).filter(([, entity]) => (entity.claims?.P856 ?? [])
    .some((c) => { const h = rootHost(String(c.mainsnak?.datavalue?.value ?? '')); return h === host || (h !== null && host.endsWith(`.${h}`)); }));
  if (matches.length !== 1) return null;
  const [qid, entity] = matches[0]!;
  const cityId = claimIds(entity, 'P159')[0];
  if (!cityId) return null;
  const countryId = claimIds(entity, 'P17')[0];
  const labels = await entities([cityId, ...(countryId && countryId !== cityId ? [countryId] : [])], 'labels', doFetch);
  const location = place(labels[cityId]?.labels?.en?.value, countryId ? labels[countryId]?.labels?.en?.value : null);
  return location ? { location, sourceUrl: `https://www.wikidata.org/wiki/${qid}`, via: 'wikidata' } : null;
}
