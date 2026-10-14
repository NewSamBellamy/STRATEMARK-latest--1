/**
 * The year a company was founded, from Wikidata, for the dashboard header.
 *
 * Sources disagree on founding years often enough that a name match is not
 * enough: a Wikidata item counts only when its own official website is the
 * company's website, and exactly one item does. Its inception claim must be
 * dated to the year at least. Anything else is "no answer", never a guess.
 * The matching rules live in @mi/research (founded-year.ts) so the research
 * pipeline stores the same answer at hydration time.
 */
import { wikidataFoundedYear, type WikidataFoundedYear } from '@mi/research';
import { LruCache, fetchWithTimeout } from './lookupCache';

export type FoundedYear = WikidataFoundedYear;

const cache = new LruCache<string, Promise<FoundedYear | null>>(200);

/** Wikidata JSON reader shared with the research repository's founded-year lane. */
export const wikidataJson = async (url: string): Promise<unknown> => (await fetchWithTimeout(url)).json();

/** Cached per company; a failed or unanswered lookup resolves to null (and is not retried this session). */
export function lookupFoundedYear(name: string, website: string | null | undefined): Promise<FoundedYear | null> {
  if (!website) return Promise.resolve(null);
  const key = `${name.toLowerCase()}|${website}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = wikidataFoundedYear(name, website, wikidataJson).catch(() => null);
    cache.set(key, pending);
  }
  return pending;
}
