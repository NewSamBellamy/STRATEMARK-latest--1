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
import { extractOrganizationJsonLd } from './registries/jsonld';

/** No company in this product predates it; anything earlier is a parsing accident. */
const MIN_YEAR = 1600;
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

/** Reads a JSON document (the caller owns timeouts and transport). */
export type JsonFetcher = (url: string) => Promise<unknown>;

export interface WikidataFoundedYear { year: number; qid: string }

type Claim = { rank?: string; mainsnak?: { datavalue?: { value?: unknown } } };
type Entity = { claims?: Record<string, Claim[]>; labels?: { en?: { value?: string } }; aliases?: { en?: Array<{ value?: string }> } };

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

const norm = (text: string | undefined): string => (text ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** A human (Q5) is never a company, whatever site it lists. */
const isPerson = (entity: Entity): boolean => claimValues(entity, 'P31')
  .some((v) => (v as { id?: string } | undefined)?.id === 'Q5');

/** The item's website (P856) is the company's own domain, or a sub/parent label of it. */
function ownsDomain(entity: Entity, domain: string): boolean {
  return claimValues(entity, 'P856').some((site) => {
    if (typeof site !== 'string') return false;
    const host = rootDomain(site);
    return host !== null && (host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`));
  });
}

/** One inception year: the preferred-rank claim when marked, else a single distinct year. */
function inceptionYear(entity: Entity): number | null {
  const claims = (entity.claims?.P571 ?? []).filter((c) => c.rank !== 'deprecated');
  const preferred = claims.filter((c) => c.rank === 'preferred');
  const pool = preferred.length > 0 ? preferred : claims;
  const years = [...new Set(pool.map((c) => yearOf(c.mainsnak?.datavalue?.value)).filter((y): y is number => y !== null))];
  return years.length === 1 ? years[0]! : null;
}

/**
 * The company's own Wikidata item and its single inception year, or null.
 * Candidates: the QID the company's own homepage links (sameAs), then name
 * search (labels and aliases), then a search on the domain's brand word —
 * the name search alone misses companies whose item carries a different
 * display name. Identity is always the item's official website (P856).
 */
export async function wikidataFoundedYear(name: string, website: string | null | undefined, getJson: JsonFetcher, hint?: { qid?: string | null }): Promise<WikidataFoundedYear | null> {
  const domain = website ? rootDomain(website) : null;
  if (!domain) return null;
  const search = async (term: string): Promise<string[]> => {
    if (!term.trim()) return [];
    const res = await getJson(`${WIKIDATA_API}?origin=*&format=json&action=wbsearchentities&language=en&type=item&limit=7&search=${encodeURIComponent(term)}`).catch(() => null) as { search?: Array<{ id?: string }> } | null;
    return (res?.search ?? []).map((hit) => hit.id).filter((id): id is string => typeof id === 'string' && /^Q\d+$/.test(id));
  };
  const brand = domain.split('.').slice(0, -1).join(' ').replace(/[-_]+/g, ' ');
  const hinted = hint?.qid && /^Q\d+$/.test(hint.qid) ? [hint.qid] : [];
  const ids = [...new Set([...hinted, ...await search(name), ...(norm(brand) && norm(brand) !== norm(name) ? await search(brand) : [])])].slice(0, 15);
  if (ids.length === 0) return null;
  const response = await getJson(`${WIKIDATA_API}?origin=*&format=json&action=wbgetentities&props=claims%7Clabels%7Caliases&languages=en&ids=${ids.join('|')}`) as { entities?: Record<string, Entity> };
  const entities = response?.entities ?? {};
  const owners = ids.filter((id) => entities[id] && !isPerson(entities[id]!) && ownsDomain(entities[id]!, domain));
  // Products and subsidiaries share the company's site: when several items do,
  // only the one labelled (or aliased) with the company's own name counts.
  const wanted = norm(name);
  const named = owners.length > 1
    ? owners.filter((id) => norm(entities[id]!.labels?.en?.value) === wanted
      || (entities[id]!.aliases?.en ?? []).some((alias) => norm(alias.value) === wanted))
    : owners;
  if (named.length !== 1) return null;
  const qid = named[0]!;
  const year = inceptionYear(entities[qid]!);
  return year !== null && year >= MIN_YEAR && year <= new Date().getUTCFullYear() ? { year, qid } : null;
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

// ---------------------------------------------------------------------------
// The company's own website
// ---------------------------------------------------------------------------

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
/** "Founded in 2015", "founded in March 2015", "Founded: 2015", "established on June 3, 2015", "est. 2015". */
const WEBSITE_FOUNDING = new RegExp(
  `\\b(?:(?:co-?)?founded|established|incorporated)\\b(?:\\s+(?:in|on))?\\s*:?\\s*(?:${MONTH}\\.?\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s+)?)?((?:1[6-9]|20)\\d{2})\\b|\\best\\.\\s*((?:1[6-9]|20)\\d{2})\\b`, 'gi');
/** Weaker: only a phrase about the company itself, never a product ("available since", "launched"). */
const WEBSITE_SINCE = /\b(?:in business|serving [a-z ,]{3,40}|proudly serving[a-z ,]{0,40}|operating|family[- ]owned(?: and operated)?)\s+since\s+((?:1[6-9]|20)\d{2})\b/gi;

function pageText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ').trim();
}

const plausible = (year: number, capturedAt: string): boolean => year >= MIN_YEAR && year <= new Date(capturedAt).getUTCFullYear();

/**
 * The founding year the company's OWN page states: schema.org Organization
 * `foundingDate` first, else an explicit "founded in YYYY" sentence, else
 * (weakest) "serving customers since YYYY". Several different founding years
 * on one page (an acquired brand's history) is ambiguity, so no answer.
 * The citation is the page itself and `evidence` is the exact text read.
 */
export function foundedFromWebsite(html: string | null | undefined, pageUrl: string, capturedAt = new Date().toISOString()): CompanyFounded | null {
  if (!html || !/^https?:\/\//i.test(pageUrl)) return null;
  let host: string;
  try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { return null; }
  const citations: Citation[] = [{ title: `${host} (company website)`, url: pageUrl, credibility: 'primary' }];
  const stamp = (year: number, evidence: string): CompanyFounded => ({ year, source: 'website', citations, evidence: evidence.slice(0, 400), capturedAt });

  const declared = extractOrganizationJsonLd(html)?.foundingDate;
  const declaredYear = declared ? /^\s*((?:1[6-9]|20)\d{2})(?:\b|-)/.exec(declared)?.[1] : undefined;
  if (declaredYear && plausible(Number(declaredYear), capturedAt)) return stamp(Number(declaredYear), `foundingDate: ${declared}`);

  const text = pageText(html);
  const around = (index: number, length: number) => text.slice(Math.max(0, index - 80), index + length + 80).trim();
  const strong = [...text.matchAll(WEBSITE_FOUNDING)]
    .map((m) => ({ year: Number(m[1] ?? m[2]), evidence: around(m.index ?? 0, m[0].length) }))
    .filter((hit) => plausible(hit.year, capturedAt));
  const years = new Set(strong.map((hit) => hit.year));
  if (years.size === 1) return stamp(strong[0]!.year, strong[0]!.evidence);
  if (years.size > 1) return null;
  const weak = [...text.matchAll(WEBSITE_SINCE)]
    .map((m) => ({ year: Number(m[1]), evidence: around(m.index ?? 0, m[0].length) }))
    .filter((hit) => plausible(hit.year, capturedAt));
  return new Set(weak.map((hit) => hit.year)).size === 1 ? stamp(weak[0]!.year, weak[0]!.evidence) : null;
}
