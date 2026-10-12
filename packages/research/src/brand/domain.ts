/**
 * Official-domain repair for the asset lane.
 *
 * A company that arrives with no website (or with a homepage that is plainly
 * some other company) can never get its real logo from its own site. This
 * module finds the real domain from free, keyless, CORS-open lookups and
 * VERIFIES it by name: a domain is returned only when the homepage's
 * <title>/og:site_name/JSON-LD name carries the company's full name, or (for
 * identity-bearing sources whose homepage is unreadable) the source itself
 * matched the name exactly. Honest null otherwise; nothing here guesses a
 * domain that has not been verified.
 */
import type { OriginalSourceReceipt } from '../original-source';
import { extractOrganizationJsonLd } from '../registries/jsonld';
import { tagAttr } from './logo-candidates';

type Read = (url: string) => Promise<OriginalSourceReceipt>;
type FetchLike = typeof fetch;

export type DomainVia = 'duckduckgo' | 'wikidata' | 'clearbit' | 'slug';

export interface DiscoveredDomain {
  /** https://<host> */
  url: string;
  via: DomainVia;
}

/** lower-case alphanumerics, legal suffixes and parentheticals dropped. */
export function normalizeBrandName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/(?:\s+(?:inc|llc|ltd|limited|pbc|corp|corporation|company|co|gmbh|plc|sa|ag))+$/g, '')
    .trim();
}

const squash = (s: string): string => s.replace(/\s+/g, '');

/** The names a homepage declares for itself. */
function declaredNames(html: string): string[] {
  const names: string[] = [];
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (title) names.push(title);
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (tagAttr(m[0], 'property') ?? tagAttr(m[0], 'name') ?? '').toLowerCase();
    if (key === 'og:site_name' || key === 'application-name' || key === 'og:title') {
      const v = tagAttr(m[0], 'content');
      if (v) names.push(v);
    }
  }
  try {
    const org = extractOrganizationJsonLd(html);
    if (org?.name) names.push(org.name);
  } catch { /* malformed JSON-LD is just absent */ }
  return names;
}

/** True when the page declares the company's full name (spacing-insensitive). */
export function homepageMentionsName(html: string, name: string): boolean {
  const wanted = squash(normalizeBrandName(name));
  if (wanted.length < 3) return false;
  return declaredNames(html).some((n) => squash(normalizeBrandName(n)).includes(wanted));
}

export type NameCheck = 'match' | 'mismatch' | 'unreadable';

export async function checkHomepageName(url: string, name: string, read: Read): Promise<NameCheck> {
  const receipt = await read(url).catch(() => null);
  const html = receipt?.status === 'retrieved' ? receipt.text : null;
  if (!html || !/<(?:html|head|title|body)\b/i.test(html)) return 'unreadable';
  // A page with no declared name at all (client-rendered shell) proves nothing.
  if (declaredNames(html).length === 0) return 'unreadable';
  return homepageMentionsName(html, name) ? 'match' : 'mismatch';
}

function hostOf(raw: string): string | null {
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch { return null; }
}

async function getJson(url: string, doFetch: FetchLike): Promise<unknown | null> {
  try {
    const res = await doFetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok || res.status === 202) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch { return null; }
}

async function fromDuckDuckGo(name: string, doFetch: FetchLike): Promise<string | null> {
  const d = (await getJson(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(name)}&format=json&no_html=1&skip_disambig=1`, doFetch,
  )) as { Heading?: string; Results?: { FirstURL?: string }[]; Infobox?: { content?: { data_type?: string; value?: unknown }[] } } | null;
  if (!d || !d.Heading) return null;
  if (normalizeBrandName(d.Heading) !== normalizeBrandName(name)) return null;
  const official = d.Results?.[0]?.FirstURL
    ?? (d.Infobox?.content ?? []).find((c) => c.data_type === 'official_website' && typeof c.value === 'string')?.value as string | undefined;
  return official ? hostOf(official) : null;
}

async function fromWikidata(name: string, doFetch: FetchLike): Promise<string | null> {
  const search = (await getJson(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&type=item&limit=5&origin=*`, doFetch,
  )) as { search?: { id?: string; label?: string }[] } | null;
  const wanted = normalizeBrandName(name);
  const hits = (search?.search ?? []).filter((i) => i.id && normalizeBrandName(i.label ?? '') === wanted);
  // Several same-named entities (a surname, a car maker) are ambiguous; only
  // an unambiguous single label match may speak for the company.
  if (hits.length !== 1) return null;
  const claims = (await getJson(
    `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${encodeURIComponent(hits[0]!.id!)}&property=P856&format=json&origin=*`, doFetch,
  )) as { claims?: { P856?: { mainsnak?: { datavalue?: { value?: unknown } } }[] } } | null;
  const site = (claims?.claims?.P856 ?? [])
    .map((c) => c.mainsnak?.datavalue?.value)
    .find((v): v is string => typeof v === 'string');
  return site ? hostOf(site) : null;
}

async function fromClearbit(name: string, doFetch: FetchLike): Promise<string[]> {
  const list = (await getJson(
    `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(name)}`, doFetch,
  )) as { name?: string; domain?: string }[] | null;
  const wanted = normalizeBrandName(name);
  return (Array.isArray(list) ? list : [])
    .filter((c) => c.domain && normalizeBrandName(c.name ?? '') === wanted)
    .map((c) => hostOf(c.domain!))
    .filter((h): h is string => !!h)
    .slice(0, 2);
}

const SLUG_TLDS = ['com', 'ai', 'io', 'co', 'org', 'inc', 'dev', 'app'];

/**
 * Find and verify a company's official domain. `exclude` holds hosts already
 * known to be wrong (the mismatching stored website).
 */
export async function discoverOfficialDomain(
  name: string,
  read: Read,
  opts: { fetchImpl?: FetchLike; exclude?: string[] } = {},
): Promise<DiscoveredDomain | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  const exclude = new Set((opts.exclude ?? []).map((h) => h.replace(/^www\./, '').toLowerCase()));
  const tried = new Set<string>();

  const attempt = async (host: string | null, via: DomainVia, trustUnreadable: boolean): Promise<DiscoveredDomain | null> => {
    if (!host || exclude.has(host) || tried.has(host)) return null;
    tried.add(host);
    const url = `https://${host}`;
    const check = await checkHomepageName(url, name, read);
    if (check === 'match' || (check === 'unreadable' && trustUnreadable)) return { url, via };
    return null;
  };

  const ddg = await fromDuckDuckGo(name, doFetch).catch(() => null);
  const a = await attempt(ddg, 'duckduckgo', true);
  if (a) return a;
  const wd = await fromWikidata(name, doFetch).catch(() => null);
  const b = await attempt(wd, 'wikidata', true);
  if (b) return b;
  for (const host of await fromClearbit(name, doFetch).catch(() => [] as string[])) {
    const c = await attempt(host, 'clearbit', false);
    if (c) return c;
  }
  // Last rung: the name's own slug on common TLDs, accepted ONLY when the
  // homepage declares the full name. Needs at least 5 chars to avoid
  // short-word collisions.
  const norm = normalizeBrandName(name);
  const slugs = [...new Set([squash(norm), norm.split(' ')[0] ?? ''])].filter((s) => s.length >= 5);
  for (const slug of slugs) {
    for (const tld of SLUG_TLDS) {
      const d = await attempt(`${slug}.${tld}`, 'slug', false);
      if (d) return d;
    }
  }
  return null;
}
