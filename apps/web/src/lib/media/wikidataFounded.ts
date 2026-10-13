/**
 * The year a company was founded, from Wikidata, for the dashboard header.
 *
 * Sources disagree on founding years often enough that a name match is not
 * enough: a Wikidata item counts only when its own official website is the
 * company's website, and exactly one item does. Its inception claim must be
 * dated to the year at least. Anything else is "no answer", never a guess.
 */
import { rootDomain } from '@mi/research';
import { LruCache, fetchWithTimeout } from './lookupCache';

const API = 'https://www.wikidata.org/w/api.php';

export interface FoundedYear { year: number; qid: string }

type Claim = { mainsnak?: { datavalue?: { value?: unknown } } };
type Entity = { claims?: Record<string, Claim[]>; labels?: { en?: { value?: string } } };

const cache = new LruCache<string, Promise<FoundedYear | null>>(200);

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

async function lookup(name: string, website: string): Promise<FoundedYear | null> {
  const domain = rootDomain(website);
  if (!domain) return null;
  const search = await (await fetchWithTimeout(`${API}?origin=*&format=json&action=wbsearchentities&language=en&type=item&limit=7&search=${encodeURIComponent(name)}`)).json() as { search?: Array<{ id?: string }> };
  const ids = (search.search ?? []).map((hit) => hit.id).filter((id): id is string => typeof id === 'string' && /^Q\d+$/.test(id)).slice(0, 7);
  if (ids.length === 0) return null;
  const response = await (await fetchWithTimeout(`${API}?origin=*&format=json&action=wbgetentities&props=claims%7Clabels&languages=en&ids=${ids.join('|')}`)).json() as { entities?: Record<string, Entity> };
  const owners = ids.filter((id) => claimValues(response.entities?.[id] ?? {}, 'P856')
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

/** Cached per company; a failed or unanswered lookup resolves to null (and is not retried this session). */
export function lookupFoundedYear(name: string, website: string | null | undefined): Promise<FoundedYear | null> {
  if (!website) return Promise.resolve(null);
  const key = `${name.toLowerCase()}|${website}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = lookup(name, website).catch(() => null);
    cache.set(key, pending);
  }
  return pending;
}
