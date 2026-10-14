/**
 * The year a company was founded — found once, stored with its source.
 *
 * Two lanes, in the same precedence the dashboard header has always used:
 *
 *  1. Wikidata: the company's OWN item, matched by its official website
 *     (P856), with exactly one year-precision inception (P571). Zero provider
 *     calls. A name match alone is never enough: sources disagree on founding
 *     years often enough that only an identity-matched item counts.
 *  2. History: the earliest dated milestone of the researched History tab
 *     whose own words describe a founding (a first product launch is not a
 *     founding). The tab's grounded citations are the provenance.
 *
 * Anything else is "no answer", never a guess (AGENTS.md Rule 9): every stored
 * year carries at least one usable citation.
 */
import { usableCitations, type Citation, type CompanyFounded, type HistoryContent } from '@mi/contracts';
import { rootDomain } from './util';

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

/** Reads a JSON document (the caller owns timeouts and transport). */
export type JsonFetcher = (url: string) => Promise<unknown>;

export interface WikidataFoundedYear { year: number; qid: string }

type Claim = { mainsnak?: { datavalue?: { value?: unknown } } };
type Entity = { claims?: Record<string, Claim[]>; labels?: { en?: { value?: string } } };

function claimValues(entity: Entity, property: string): unknown[] {
  return (entity.claims?.[property] ?? []).map((claim) => claim.mainsnak?.datavalue?.value);
}

/** "+2015-04-01T00:00:00Z" at year precision or finer; century/decade-level dates are not a year. */
function yearOf(value: unknown): number | null {
  const v = value as { time?: unknown; precision?: unknown } | undefined;
  if (typeof v?.time !== 'string' || typeof v.precision !== 'number' || v.precision < 9) return null;
  const year = /^\+?(\d{4})-/.exec(v.time)?.[1];
  return year ? Number(year) : null;
}

/** The company's own Wikidata item and its single inception year, or null. */
export async function wikidataFoundedYear(name: string, website: string | null | undefined, getJson: JsonFetcher): Promise<WikidataFoundedYear | null> {
  const domain = website ? rootDomain(website) : null;
  if (!domain) return null;
  const search = await getJson(`${WIKIDATA_API}?origin=*&format=json&action=wbsearchentities&language=en&type=item&limit=7&search=${encodeURIComponent(name)}`) as { search?: Array<{ id?: string }> };
  const ids = (search?.search ?? []).map((hit) => hit.id).filter((id): id is string => typeof id === 'string' && /^Q\d+$/.test(id)).slice(0, 7);
  if (ids.length === 0) return null;
  const response = await getJson(`${WIKIDATA_API}?origin=*&format=json&action=wbgetentities&props=claims%7Clabels&languages=en&ids=${ids.join('|')}`) as { entities?: Record<string, Entity> };
  const owners = ids.filter((id) => claimValues(response?.entities?.[id] ?? {}, 'P856')
    .some((site) => typeof site === 'string' && rootDomain(site) === domain));
  // Products and subsidiaries share the company's site: when several items do,
  // only the one labelled with the company's own name counts.
  const named = owners.length > 1
    ? owners.filter((id) => response.entities?.[id]?.labels?.en?.value?.trim().toLowerCase() === name.trim().toLowerCase())
    : owners;
  if (named.length !== 1) return null;
  const qid = named[0]!;
  const years = [...new Set(claimValues(response.entities![qid]!, 'P571').map(yearOf).filter((year): year is number => year !== null))];
  return years.length === 1 ? { year: years[0]!, qid } : null;
}

export function foundedFromWikidata(found: WikidataFoundedYear, capturedAt = new Date().toISOString()): CompanyFounded {
  return { year: found.year, source: 'wikidata', capturedAt,
    citations: [{ title: `Wikidata ${found.qid} (inception)`, url: `https://www.wikidata.org/wiki/${found.qid}`, credibility: 'reputable_secondary' }] };
}

/** Mirrors apps/web dashboard/snapshot.ts foundedYear (the History-tab header fallback). */
export const FOUNDING_EVENT = /\b(?:founded|co-?founded|incorporated|established|launched (?:as|the company)|was (?:started|formed|created)|started operations)\b/i;

/**
 * The founding year a researched History tab states, with the tab's grounded
 * citations as provenance. Null when no dated milestone describes a founding,
 * or when the tab carries no usable citation (an unsourced year is not stored).
 */
export function foundedFromHistory(
  timeline: HistoryContent['timeline'] | undefined,
  citations: readonly Citation[] | undefined,
  capturedAt = new Date().toISOString(),
): CompanyFounded | null {
  const cited = usableCitations([...(citations ?? [])]).slice(0, 5);
  if (cited.length === 0) return null;
  let best: { year: number; evidence: string } | null = null;
  for (const event of timeline ?? []) {
    const words = `${event.title ?? ''} ${event.detail ?? ''}`.trim();
    if (!FOUNDING_EVENT.test(words)) continue;
    const year = /\b(1[6-9]\d{2}|20\d{2})\b/.exec(String(event.date ?? ''))?.[1];
    if (!year) continue;
    if (!best || Number(year) < best.year) best = { year: Number(year), evidence: words.slice(0, 400) };
  }
  if (!best || best.year > new Date(capturedAt).getUTCFullYear()) return null;
  return { year: best.year, source: 'history', citations: cited, evidence: best.evidence, capturedAt };
}
