/**
 * Which SEC registrant a listed company IS, when its everyday name is not its
 * registrant title ("IBM" files as INTERNATIONAL BUSINESS MACHINES CORP).
 *
 * The exact suffix-insensitive name match through the official ticker map
 * stays the first and preferred path. Only when it finds NO registrant (never
 * when it finds several) does the alias path run, and it accepts a CIK only
 * when independent sources agree:
 *
 *   1. Market identity — Yahoo's search for the company name ranks a US-listed
 *      equity first whose symbol the SEC ticker map assigns to exactly one CIK,
 *      and Yahoo's long name for it equals the SEC title (suffix-insensitive).
 *   2. Name relation — the company name is the registrant title, a leading
 *      word-prefix of it ("Dell" -> DELL TECHNOLOGIES), or its initials
 *      ("IBM" -> INTERNATIONAL BUSINESS MACHINES). Never a word from the
 *      middle: "Company Ten" never becomes TEN Holdings.
 *   3. Domain identity — the company's own website is the website the
 *      registrant gives EDGAR, or the official website (P856) of a Wikidata
 *      item that claims this exact CIK (P5531). A parent never speaks for a
 *      subsidiary on another domain: "Google" (google.com) is not Alphabet
 *      (abc.xyz).
 *
 * All reads go through the caller's reader (the original-source relay), so
 * every piece of evidence is a retained, hashed receipt.
 */
import type { OriginalSourceReceipt } from './original-source';
import { companyNameKey, secTickerMapUrl, secTickerSliceUrl, singleIssuer, yahooSearchUrl, type TickerMatch } from './market-quote';
import { secSubmissionsUrl } from './sec-ownership';
import { parseSubmissionsProfile, type SubmissionsProfile } from './sec-profile';

export interface ListedIdentity extends TickerMatch {
  /** 'name': the registrant title is the company name. 'alias': established by agreement. */
  via: 'name' | 'alias';
  /** The name SEC documents for this issuer carry: the title on the alias path. */
  issuerName: string;
}

export type IdentityRead = (url: string) => Promise<OriginalSourceReceipt>;

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
/** More Wikidata items than this claiming one CIK is noise, not identity. */
const MAX_WIKIDATA_ITEMS = 3;
/** Yahoo exchange codes of the US venues whose listings file with the SEC. */
const US_EXCHANGES = new Set(['NYQ', 'NMS', 'NGM', 'NCM', 'ASE', 'PCX', 'BTS']);

const padCik = (cik: string) => cik.replace(/\D/g, '').padStart(10, '0');

/** Wikidata items stating this exact Central Index Key (P5531, zero-padded). */
export function wikidataCikSearchUrl(cik: string): string {
  return `${WIKIDATA_API}?action=query&list=search&srsearch=${encodeURIComponent(`haswbstatement:P5531=${padCik(cik)}`)}&srlimit=${MAX_WIKIDATA_ITEMS + 1}&srprop=&format=json`;
}

/** One item's official-website statements (P856) only. */
export function wikidataWebsiteClaimsUrl(qid: string): string {
  return `${WIKIDATA_API}?action=wbgetclaims&entity=${encodeURIComponent(qid)}&property=P856&format=json`;
}

const readable = (receipt: OriginalSourceReceipt): string | null =>
  receipt.status === 'retrieved' && receipt.text ? receipt.text : null;

function json(text: string | null): unknown {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function host(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return /^https?:$/.test(url.protocol) ? url.hostname.toLowerCase().replace(/^www\./, '') || null : null;
  } catch { return null; }
}

/** The company's domain and a source's stated website are the same site: equal
 * hosts, or the stated one is a subdomain of the company's (about.meta.com). */
export function sameSite(companyWebsite: string | null | undefined, statedWebsite: string | null | undefined): boolean {
  const own = host(companyWebsite);
  const stated = host(statedWebsite);
  return Boolean(own && stated && own.includes('.') && (stated === own || stated.endsWith(`.${own}`)));
}

/** Rows of a retained ticker-map slice (by name or by symbol); null when the
 * text is not a slice at all — unreadable is not the same as "no registrant". */
export function tickerSliceMatches(text: string | null): TickerMatch[] | null {
  const doc = json(text) as { matches?: unknown } | null;
  if (!Array.isArray(doc?.matches)) return null;
  return doc.matches.flatMap((row: unknown) => {
    const r = row as Partial<Record<'cik' | 'ticker' | 'title', unknown>>;
    return /^\d{1,10}$/.test(String(r?.cik ?? '')) && typeof r.ticker === 'string' && typeof r.title === 'string'
      ? [{ cik: String(r.cik), ticker: r.ticker, title: r.title }] : [];
  });
}

/** Yahoo's top-ranked US-listed equity for a name search, with the name Yahoo gives it. */
export function topListedEquity(searchJson: string | null): { symbol: string; name: string } | null {
  const doc = json(searchJson) as { quotes?: unknown } | null;
  if (!Array.isArray(doc?.quotes)) return null;
  for (const quote of doc.quotes as Array<Record<string, unknown>>) {
    if (quote?.quoteType !== 'EQUITY' || typeof quote.exchange !== 'string' || !US_EXCHANGES.has(quote.exchange)) continue;
    const symbol = typeof quote.symbol === 'string' && /^[A-Z][A-Z0-9.-]{0,9}$/.test(quote.symbol) ? quote.symbol : null;
    const name = typeof quote.longname === 'string' && quote.longname.trim() ? quote.longname
      : typeof quote.shortname === 'string' && quote.shortname.trim() ? quote.shortname : null;
    // The top listed equity decides; a nameless or malformed one is no answer,
    // not a reason to fall through to a lower-ranked company.
    return symbol && name ? { symbol, name } : null;
  }
  return null;
}

/**
 * The company name stands for this registrant title: the title itself, its
 * leading words, or its initials. Never a trailing or middle word.
 */
export function nameRelatesToTitle(companyName: string, title: string): boolean {
  const name = companyNameKey(companyName);
  const registrant = companyNameKey(title);
  if (name.length < 2 || !registrant) return false;
  if (name === registrant) return true;
  if (name.length >= 3 && registrant.startsWith(`${name} `)) return true;
  const words = registrant.split(' ').filter((w) => !['OF', 'AND', 'THE'].includes(w));
  return !name.includes(' ') && name.length >= 2 && words.length >= 2 && /^[A-Z]+$/.test(name) &&
    words.map((w) => w[0]).join('') === name;
}

/** Wikidata item ids in a P5531 search answer; null when more than the cap. */
export function wikidataSearchIds(text: string | null): string[] | null {
  const doc = json(text) as { query?: { searchinfo?: { totalhits?: unknown }; search?: unknown } } | null;
  const hits = doc?.query?.search;
  if (!Array.isArray(hits)) return null;
  const total = typeof doc?.query?.searchinfo?.totalhits === 'number' ? doc.query.searchinfo.totalhits : hits.length;
  if (total > MAX_WIKIDATA_ITEMS) return null;
  return hits.map((h: { title?: unknown }) => h?.title).filter((t): t is string => typeof t === 'string' && /^Q\d{1,12}$/.test(t));
}

/** Non-deprecated official websites in a wbgetclaims P856 answer. */
export function wikidataWebsites(text: string | null): string[] {
  const doc = json(text) as { claims?: { P856?: unknown } } | null;
  const claims = doc?.claims?.P856;
  if (!Array.isArray(claims)) return [];
  return claims.flatMap((c: { rank?: unknown; mainsnak?: { datavalue?: { value?: unknown } } }) =>
    c?.rank !== 'deprecated' && typeof c?.mainsnak?.datavalue?.value === 'string' ? [c.mainsnak.datavalue.value] : []);
}

export interface ListedIdentityResult {
  identity: ListedIdentity | null;
  /** The registrant profile, when the alias path read the submissions feed. */
  profile: SubmissionsProfile | null;
  /** Every read made, for the retained ledger. */
  receipts: OriginalSourceReceipt[];
}

type Decision = { identity: ListedIdentity; profile: SubmissionsProfile | null } | null;

/**
 * The whole decision as a sequence of reads: each `yield` names the next URL
 * and receives its retained text (null when unreadable). Driven live by
 * `resolveListedIdentity`, and replayed over retained receipts by
 * `replayListedIdentity`, so a figure that rests on an alias identity
 * re-derives from the ledger exactly as it was first accepted.
 */
function* identitySteps(company: { name: string; websiteUrl?: string | null }): Generator<string, Decision, string | null> {
  const named = tickerSliceMatches(yield `${secTickerMapUrl()}?lookup=${encodeURIComponent(company.name)}`);
  // Unreadable is unknown, not "no registrant"; an exact-name tie stays a tie.
  if (named === null) return null;
  if (named.length > 0) {
    const issuer = singleIssuer(named);
    return issuer ? { identity: { ...issuer, via: 'name', issuerName: company.name }, profile: null } : null;
  }

  // Alias path: only with a website to anchor the company to.
  if (!host(company.websiteUrl)) return null;
  const top = topListedEquity(yield yahooSearchUrl(company.name));
  if (!top) return null;
  const issuer = singleIssuer((tickerSliceMatches(yield secTickerSliceUrl([top.symbol])) ?? [])
    .filter((m) => m.ticker.toUpperCase() === top.symbol));
  if (!issuer || companyNameKey(top.name) !== companyNameKey(issuer.title) || !nameRelatesToTitle(company.name, issuer.title)) return null;

  const submissions = parseSubmissionsProfile((yield secSubmissionsUrl(issuer.cik)) ?? '');
  // The feed must be this CIK's, name this registrant and list this symbol.
  if (!submissions || submissions.cik !== padCik(issuer.cik) || companyNameKey(submissions.name) !== companyNameKey(issuer.title) ||
    !submissions.profile.tickers.includes(top.symbol)) return null;
  const profile = submissions.profile;
  let anchored = [profile.website, profile.investorWebsite].some((site) => sameSite(company.websiteUrl, site));
  if (!anchored) {
    for (const qid of wikidataSearchIds(yield wikidataCikSearchUrl(issuer.cik)) ?? []) {
      if (wikidataWebsites(yield wikidataWebsiteClaimsUrl(qid)).some((site) => sameSite(company.websiteUrl, site))) {
        anchored = true;
        break;
      }
    }
  }
  // A profile is only ever returned with an established identity.
  return anchored ? { identity: { ...issuer, via: 'alias', issuerName: issuer.title }, profile } : null;
}

/**
 * Resolve the company to one SEC registrant, or to none. A wrong match is
 * worse than no match: every failure, ambiguity or disagreement is null.
 */
export async function resolveListedIdentity(
  company: { name: string; websiteUrl?: string | null },
  read: IdentityRead,
): Promise<ListedIdentityResult> {
  const receipts: OriginalSourceReceipt[] = [];
  const steps = identitySteps(company);
  let step = steps.next();
  while (!step.done) {
    const receipt = await read(step.value);
    receipts.push(receipt);
    step = steps.next(readable(receipt));
  }
  return { identity: step.value?.identity ?? null, profile: step.value?.profile ?? null, receipts };
}

/** The same decision over already-retained receipts only: no reads. */
export function replayListedIdentity(company: { name: string; websiteUrl?: string | null }, originals: readonly OriginalSourceReceipt[]): ListedIdentity | null {
  const text = (url: string) => {
    const hit = originals.find((r) => (r.requestedUrl === url || r.finalUrl === url) && readable(r) !== null);
    return hit ? readable(hit) : null;
  };
  const steps = identitySteps(company);
  let step = steps.next();
  while (!step.done) step = steps.next(text(step.value));
  return step.value?.identity ?? null;
}

/**
 * The name SEC documents for this company carry, for re-deriving a retained
 * SEC figure: the registrant title when the retained receipts establish an
 * alias identity for exactly this CIK, else the company's own name.
 */
export function secIssuerName(company: { name: string; websiteUrl?: string | null }, originals: readonly OriginalSourceReceipt[], cik: string | null): string {
  if (!cik) return company.name;
  const identity = replayListedIdentity(company, originals);
  return identity?.via === 'alias' && padCik(identity.cik) === padCik(cik) ? identity.issuerName : company.name;
}

/** The registrant profile of an ESTABLISHED identity's CIK; null unless the
 * feed is that CIK's own. */
export async function readRegistrantProfile(cik: string, read: IdentityRead): Promise<{ profile: SubmissionsProfile | null; receipt: OriginalSourceReceipt }> {
  const receipt = await read(secSubmissionsUrl(cik));
  const parsed = parseSubmissionsProfile(readable(receipt) ?? '');
  return { profile: parsed && parsed.cik === padCik(cik) ? parsed.profile : null, receipt };
}
