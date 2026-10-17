/**
 * Company asset lane — logos and team headshots resolved ONCE at research
 * time from the company's own web presence, each entry carrying the page it
 * was actually found on.
 *
 * Provenance contract: a URL is returned only when a tag on a fetched page
 * declared it, or (for /favicon.ico) the file verifiably exists at the
 * standard location via a read. Honest-not-found beats a wrong image — no
 * guessed hosts, no third-party favicon services, no fabricated URLs. This
 * extends logos.ts (Wikidata/curated/favicon-service) with direct-from-site
 * provenance; it deliberately does not duplicate that module's ladders.
 *
 * Read contract: `read` returns an OriginalSourceReceipt whose `text` holds
 * the RAW HTML of the page. The original-source readers strip tags from
 * receipt text, so callers wire a transport-level read (the node reader's raw
 * layer or a plain fetch) rather than retrieveOriginalSource — a tag-stripped
 * receipt yields honest empty results, never a wrong asset.
 */
import { z } from 'zod';
import type { OriginalSourceReceipt } from './original-source';
import { resolveBrand, type BrandOptions, type ScrapedBrandColors } from './brand';

export const companyLogoSchema = z.object({
  kind: z.literal('logo'),
  url: z.string().url(),
  sourceUrl: z.string().url(),
  retrievedAt: z.string(),
  /** Which ladder rung supplied the logo (json-ld, header-logo, wikidata, ...). */
  via: z.string().optional(),
});
export type CompanyLogo = z.infer<typeof companyLogoSchema>;

export const teamHeadshotSchema = z.object({
  personName: z.string().min(1),
  imageUrl: z.string().url(),
  sourceUrl: z.string().url(),
  retrievedAt: z.string(),
});
export type TeamHeadshot = z.infer<typeof teamHeadshotSchema>;

/** Transport seam for tests; production wiring supplies the raw-page read. */
export type AssetRead = (url: string) => Promise<OriginalSourceReceipt>;

function pageBase(websiteUrl: string): URL | null {
  try {
    const url = new URL(websiteUrl.includes('://') ? websiteUrl : `https://${websiteUrl}`);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

/** The page a receipt actually delivered — post-redirect finalUrl first. */
function receiptPageUrl(receipt: OriginalSourceReceipt | null, fallback: URL): URL {
  const raw = receipt?.finalUrl ?? receipt?.requestedUrl;
  try { return raw ? new URL(raw) : fallback; } catch { return fallback; }
}

/** Assets resolve against the page that declared them; data: URIs are not
 * storable URLs and non-http(s) schemes are never followed. */
function resolveAssetUrl(raw: string | null, base: URL): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim().replaceAll('&amp;', '&'), base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

/** First attribute value in a single tag; quoted and bare forms both occur. */
function tagAttr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

/** Receipt text that still carries markup — the module's read contract. */
function looksLikeHtml(text: string): boolean {
  return /<(?:!doctype|html|head|body|div|section|main|nav|img|a|p|ul|li|h[1-6])\b/i.test(text);
}

/**
 * Brand resolution (logo + colours) from the homepage the read returns. See
 * ./brand for the ladder: JSON-LD logo, header/nav logo <img>, domain-verified
 * Wikidata P154, apple-touch-icon / og:logo / logo-named og:image, favicon
 * >=64px. Honest null when nothing qualifies; callers keep any existing guess.
 */
export async function resolveCompanyBrand(
  websiteUrl: string,
  read: AssetRead,
  opts: Omit<BrandOptions, 'read'> = {},
): Promise<{ logo: CompanyLogo | null; colors: ScrapedBrandColors | null }> {
  const res = await resolveBrand(websiteUrl, { ...opts, read });
  const logo = res.logo ? companyLogoSchema.safeParse({
    kind: 'logo', url: res.logo.url, sourceUrl: res.logo.sourceUrl, retrievedAt: res.logo.retrievedAt, via: res.logo.via,
  }) : null;
  return { logo: logo?.success ? logo.data : null, colors: res.colors };
}

/** Logo only, no Wikidata network rung (kept for callers that must stay offline). */
export async function resolveCompanyLogo(websiteUrl: string, read: AssetRead): Promise<CompanyLogo | null> {
  return (await resolveCompanyBrand(websiteUrl, read, { skipWikidata: true })).logo;
}

const TEAM_PAGE_PATHS = ['/team', '/about', '/leadership', '/management', '/people'];
// The path ladder is bounded to four reads and stops on the first HTML hit;
// homepage-link discovery then covers sites whose team page lives elsewhere.
const MAX_TEAM_PAGE_ATTEMPTS = 4;
const MAX_HEADSHOTS = 12;

// Group shots and page chrome are not portraits — reject by filename or alt.
const HEADSHOT_REJECT = /logo|sprite|icon|avatar-placeholder|team-photo/i;

// Words that appear around photos but never surname a person; without this,
// adjacent-text matching would happily return "Our Leadership" as a human.
const NON_NAME_WORDS = new Set([
  'team', 'about', 'leadership', 'management', 'people', 'board', 'company',
  'contact', 'careers', 'our', 'the', 'meet', 'read', 'more', 'news', 'press',
  'portrait', 'headshot', 'headshots', 'profile', 'picture', 'image', 'img',
  'chief', 'officer', 'founder', 'cofounder', 'director', 'manager',
  'president', 'partner', 'executive', 'engineer', 'designer', 'scientist',
  'research', 'researcher', 'general', 'counsel', 'operations', 'technology',
  'product', 'marketing', 'finance',
]);

function nameKey(text: string): string {
  return text.toLowerCase().normalize('NFKC').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** A plausible person name: 2-3 words, each capitalized (not an acronym like
 * CEO), none a role/section word, possessives stripped. */
function isNamePhrase(phrase: string): string | null {
  const words = phrase.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 3) return null;
  const kept: string[] = [];
  for (const word of words) {
    const bare = word.replace(/['’]s$/i, '');
    if (!/^[A-Z][A-Za-z'’.-]*$/.test(bare) || !/[a-z]/.test(bare)) return null;
    if (NON_NAME_WORDS.has(bare.toLowerCase().replace(/[.'’-]/g, ''))) return null;
    kept.push(bare);
  }
  return kept.join(' ');
}

/** "Jane Smith", "Jane Smith, Chief Executive Officer", "Jane Smith — CEO". */
function personNameFromAlt(alt: string): string | null {
  return isNamePhrase(alt.split(/\s*[|,—–]\s*|\s+-\s+|,\s*/)[0] ?? '');
}

/** /headshots/jane-smith.jpg → "Jane Smith"; numeric suffixes drop. */
function personNameFromSrc(src: string): string | null {
  let file = src.split(/[?#]/)[0]!.split('/').pop() ?? '';
  try { file = decodeURIComponent(file); } catch { /* keep raw filename */ }
  const words = file.replace(/\.[a-z0-9]{1,5}$/i, '').split(/[-_+]+/)
    .map((word) => word.replace(/\d+/g, ''))
    .filter((word) => /^[A-Za-z]{2,}$/.test(word));
  if (words.length < 2 || words.length > 3) return null;
  if (words.some((word) => NON_NAME_WORDS.has(word.toLowerCase()))) return null;
  return words.map((word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

const ADJACENT_WINDOW = 160;
const NAME_PAIR = /\b[A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*){1,2}\b/g;

/** Names sitting next to an alt-less photo. Cards usually put the name below
 * (after) the image, so search that side first; window bounds keep this local. */
function adjacentName(html: string, index: number, tagLength: number): string | null {
  const after = html.slice(index + tagLength, index + tagLength + ADJACENT_WINDOW).replace(/<[^>]*>/g, ' ');
  const before = html.slice(Math.max(0, index - ADJACENT_WINDOW), index).replace(/<[^>]*>/g, ' ');
  for (const window of [after, before]) {
    for (const match of window.matchAll(NAME_PAIR)) {
      const name = isNamePhrase(match[0]);
      if (name) return name;
    }
  }
  return null;
}

function headshotsFromHtml(html: string, pageUrl: URL, retrievedAt: string, companyName: string): TeamHeadshot[] {
  const out: TeamHeadshot[] = [];
  const seen = new Set<string>();
  const companyKey = nameKey(companyName);
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = tagAttr(tag, 'src');
    if (!src) continue;
    const alt = tagAttr(tag, 'alt') ?? '';
    const imageUrl = resolveAssetUrl(src, pageUrl);
    if (!imageUrl) continue;
    if (HEADSHOT_REJECT.test(src) || HEADSHOT_REJECT.test(alt)) continue;
    // A brand mark naming the company is chrome, never a portrait.
    if (companyKey.length >= 3 &&
      (nameKey(alt).includes(companyKey) || nameKey(src.split('/').pop() ?? '').includes(companyKey))) continue;
    const personName = personNameFromAlt(alt) ?? personNameFromSrc(src) ?? adjacentName(html, match.index ?? 0, tag.length);
    if (!personName) continue;
    const entry = teamHeadshotSchema.safeParse({ personName, imageUrl, sourceUrl: pageUrl.href, retrievedAt });
    if (!entry.success) continue;
    const key = `${entry.data.personName}|${entry.data.imageUrl}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry.data);
    if (out.length >= MAX_HEADSHOTS) break;
  }
  return out;
}

const TEAM_LINK = /team|about|leadership|people/i;

/** First untried same-origin homepage link whose href names a team-ish page. */
function firstTeamLink(html: string, homeUrl: URL, attempted: ReadonlyMap<string, unknown>): string | null {
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = tagAttr(match[0], 'href');
    if (!href || !TEAM_LINK.test(href)) continue;
    const url = resolveAssetUrl(href, homeUrl);
    if (!url || new URL(url).origin !== homeUrl.origin || attempted.has(url)) continue;
    return url;
  }
  return null;
}

/**
 * Team headshots from the company's own pages, every entry with the page it
 * was found on. Strategy: the common path ladder (bounded, stops on the first
 * HTML page), then homepage-link discovery for sites that keep their team
 * page elsewhere. A photo becomes a headshot only when a plausible person
 * name comes from its alt, its filename slug, or adjacent text — group shots
 * and chrome are rejected, and empty results are the honest outcome.
 */
export async function findTeamHeadshots(companyName: string, websiteUrl: string, read: AssetRead): Promise<TeamHeadshot[]> {
  const base = pageBase(websiteUrl);
  if (!base) return [];
  const attempted = new Map<string, OriginalSourceReceipt>();
  const readOnce = async (url: string): Promise<OriginalSourceReceipt> => {
    const known = attempted.get(url);
    if (known) return known;
    const receipt = await read(url).catch(() => null);
    const safe = receipt ?? { requestedUrl: url, status: 'unavailable' as const, retrievedAt: new Date().toISOString() };
    attempted.set(url, safe);
    return safe;
  };
  const parse = (receipt: OriginalSourceReceipt, url: string): TeamHeadshot[] =>
    receipt.status === 'retrieved' && receipt.text && looksLikeHtml(receipt.text)
      ? headshotsFromHtml(receipt.text, receiptPageUrl(receipt, new URL(url)), receipt.retrievedAt, companyName)
      : [];

  let found: TeamHeadshot[] = [];
  for (const path of TEAM_PAGE_PATHS) {
    if (attempted.size >= MAX_TEAM_PAGE_ATTEMPTS) break;
    const url = new URL(path, base).href;
    const receipt = await readOnce(url);
    found = parse(receipt, url);
    // Stop the ladder on the first real HTML page, per the attempt budget.
    if (receipt.status === 'retrieved' && receipt.text && looksLikeHtml(receipt.text)) break;
  }
  if (found.length) return found;

  const home = await readOnce(base.href);
  if (home.status !== 'retrieved' || !home.text || !looksLikeHtml(home.text)) return [];
  const link = firstTeamLink(home.text, receiptPageUrl(home, base), attempted);
  if (!link) return [];
  return parse(await readOnce(link), link);
}
