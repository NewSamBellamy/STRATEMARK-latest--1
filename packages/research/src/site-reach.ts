/**
 * Own-site reach lane: "Users / Distribution" from the company's own pages.
 *
 * The slot means different things per market profile — customers or users for
 * software, merchants for payments, stockists / stores for consumer brands,
 * units shipped for hardware, clients for services — and companies state it
 * the same way everywhere: a homepage or about-page sentence such as "Trusted
 * by 10,000+ customers", "Available in 30,000 stores", "Used by 50 million
 * people", "Join 4,000 companies". The dated, company-named, unhedged passage
 * gates (metric-support.ts, quoted-estimate.ts) reject these by design: they
 * are undated, name no company ("we", "our"), and are written as floors.
 *
 * This lane reads pages the pipeline ALREADY fetched (the asset lane's
 * homepage receipt, the retained originals ledger) and accepts a figure only
 * when all of these hold:
 *   - the sentence is verbatim visible text of a page on the company's own host
 *     (identity is the host, never a guess; see ownSiteSupport);
 *   - exactly one precise figure sits directly before a population / footprint
 *     noun, with no hedging ("about", "nearly", "will", "by 2030", ...);
 *   - the figure is consistent: two different values for the same wording on
 *     the company's own pages mean the lane stays silent, it never picks one.
 * A figure written "10,000+" / "over 50 million" is stored as written and the
 * row's note labels it a lower bound. Rows land as ESTIMATED with an undated
 * label, never verified, and go through reportedMetricCitations like every
 * other reported claim, so the read path re-judges them identically.
 */
import { usableCitations, type CompanyMetric, type MetricType, type ReportedMetricSupport } from '@mi/contracts';
import { reportedMetricCitations, reportedRowNote } from './reported-metrics';

export interface SitePage { url: string; text: string }

type Definition = NonNullable<ReportedMetricSupport['definition']>;

export interface SiteReachClaim {
  metricType: 'users' | 'distribution';
  definition: Definition;
  value: number;
  /** The figure was written as a floor ("10,000+", "over 50 million"). */
  lowerBound: boolean;
  /** The sentence exactly as the page's visible text states it. */
  quote: string;
  sourceUrl: string;
  /** Distribution only: the place noun the sentence uses ("stores", "countries"). */
  noun?: string;
}

const ENTITIES: Record<string, string> = { amp: '&', nbsp: ' ', plus: '+', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—' };

/**
 * Visible text blocks of a page (HTML or already-plain text). Block-level
 * boundaries become line breaks; when a block is a bare figure ("10,000+") and
 * the next block is its label ("Customers") — the usual homepage stat tile —
 * the two read as one statement, in page order.
 */
export function pageTextBlocks(raw: string): string[] {
  let text = raw;
  const meta: string[] = [];
  if (/<\w+[^>]*>/.test(text)) {
    // The meta / social description is the page's own one-line pitch ("Trusted by 10,000 teams").
    for (const tag of text.matchAll(/<meta\b[^>]*>/gi)) {
      if (!/\b(?:name|property)\s*=\s*["'](?:description|og:description|twitter:description)["']/i.test(tag[0])) continue;
      const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag[0]);
      if (content) meta.push(content[1] ?? content[2] ?? '');
    }
    text = text
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/?(?:p|div|li|ul|ol|h[1-6]|section|article|header|footer|main|nav|tr|td|th|table|br|blockquote|figure|figcaption|dd|dt|span|strong|b|em|a|small|label|button)\b[^>]*>/gi, (tag) =>
        /^<\/?(?:span|strong|b|em|a|small|label)\b/i.test(tag) ? ' ' : '\n')
      .replace(/<[^>]+>/g, ' ');
  }
  text = text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, dec, hex, name) =>
    dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ENTITIES[String(name).toLowerCase()] ?? match);
  const lines = [...meta, ...text.split(/\n+/)].map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1];
    if (next && line.length <= 18 && /^\d[\d,.]*\s*(?:million|billion|thousand|[kmb])?\s*\+?$/i.test(line) && next.length <= 60) {
      blocks.push(`${line} ${next}`);
      i += 1;
    } else blocks.push(line);
  }
  return blocks.flatMap((block) => block.length > 600 ? block.split(/(?<=[.!?])\s+(?=[A-Z])/) : [block]);
}

const SCALE: Record<string, number> = { trillion: 1e12, billion: 1e9, million: 1e6, thousand: 1e3, k: 1e3, m: 1e6, b: 1e9 };
const FIGURE = String.raw`(?<![\w$£€.,/-])((?:over|more than|at least|exceeding|upwards of)\s+)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(million|billion|thousand|[kKmMbB](?![A-Za-z]))?\s*(\+)?`;

const PEOPLE_ADJECTIVE = String.raw`(?:(monthly active|daily active|active|paying)\s+|(?:happy|satisfied|global|loyal)\s+)?`;
const PEOPLE_NOUN = String.raw`(users|customers|clients|merchants|businesses|companies|organi[sz]ations|brands|teams|developers|members|subscribers|sellers|creators|shoppers|households|players|patients|students|riders|drivers|people|professionals)`;
/** "People" is only a customer count when the sentence says who uses, trusts or joins. */
const PEOPLE_NEEDS_VERB = /\b(?:used by|trusted by|loved by|relied on by|chosen by|serving|serves|joined by|join|helping|helps|powering|powers)\b/i;
const PEOPLE = new RegExp(`${FIGURE}\\s*${PEOPLE_ADJECTIVE}${PEOPLE_NOUN}\\b`, 'gi');

const PLACE_NOUN = String.raw`(countries|markets|cities|stores|retailers|retail partners|retail locations|doors|stockists|dealers|restaurants|shops|pharmacies|supermarkets|points of sale|(?:units|devices|vehicles|systems|robots|installations)\s+(?:shipped|sold|delivered|deployed|installed))`;
const PLACES = new RegExp(`${FIGURE}\\s*${PLACE_NOUN}\\b`, 'gi');

/** A number in front of "Fortune 500 customers", "S&P 500 companies", "Inc. 5000 brands" is a ranking, not a count. */
const RANKING_BEFORE = /(?:fortune|s&p|forbes|inc\.?|global|top|nasdaq|ftse|dow)\s*$/i;
/** Staff, offices, investors and tenure are not the people or places the product reaches. */
const NOT_REACH = /\b(?:employees|staff|our team|team members|offices?|hiring|careers?|investors?|shareholders?|alumni|nationalities|remote(?:ly)?|years? of)\b/i;
const SPECULATIVE = /\b(?:will|plans?\s+to|aims?\s+to|aiming|goal|target(?:s|ing)?|expects?|expected|projected|forecasts?|soon|could|may|might|approximately|about|around|nearly|almost|roughly|up to|by\s+20\d\d|not)\b|~|\?/i;
/** A place noun only counts as sales reach next to a verb of selling or serving. */
const SALES_CONTEXT = /\b(?:available|sold|stocked|distribut\w*|ships?|shipping|shipped|deliver\w*|operat\w*|serv\w+|present|launched|across|customers|users|in|at|from|through|via|partner\w*|located)\b/i;

/** Nouns for people who use the product; every other noun counts what the company sells to. */
const USER_NOUNS = new Set(['users', 'people', 'professionals', 'players', 'students', 'riders', 'drivers', 'patients', 'shoppers']);
const PEOPLE_DEFINITION: Record<string, Definition> = {
  'monthly active': 'monthly_active_users', 'daily active': 'daily_active_users', active: 'active_users', paying: 'paying_customers',
};
const PEOPLE_PRIORITY: Definition[] = ['users', 'monthly_active_users', 'daily_active_users', 'active_users', 'customers', 'paying_customers'];
const PLACE_PRIORITY = ['stores', 'doors', 'retailers', 'retail partners', 'retail locations', 'stockists', 'dealers', 'supermarkets', 'pharmacies',
  'restaurants', 'shops', 'points of sale', 'countries', 'markets', 'cities'];

function figureOf(match: RegExpMatchArray, before: string): { value: number; lowerBound: boolean } | null {
  const [, lead, digits, scaleWord, plus] = match;
  const scale = scaleWord ? SCALE[scaleWord.toLowerCase()] ?? 1 : 1;
  const value = Number(digits!.replace(/,/g, '')) * scale;
  if (!Number.isSafeInteger(Math.round(value)) || Math.abs(value - Math.round(value)) > 1e-6) return null;
  // A bare four-digit number is almost always a year ("since 2019 customers").
  if (!scaleWord && !digits!.includes(',') && !plus && !lead && /^(?:19|20)\d{2}$/.test(digits!)) return null;
  if (RANKING_BEFORE.test(before)) return null;
  return { value: Math.round(value), lowerBound: Boolean(lead || plus) };
}

/** Every users/customers and distribution statement in the pages' visible text, in page order. */
export function siteReachClaims(pages: readonly SitePage[]): SiteReachClaim[] {
  const claims: SiteReachClaim[] = [];
  for (const page of pages) {
    for (const block of pageTextBlocks(page.text)) {
      for (const sentence of block.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
        if (sentence.length < 12 || sentence.length > 400 || SPECULATIVE.test(sentence) || NOT_REACH.test(sentence)) continue;
        // One precise figure in the sentence: two reach figures are two claims
        // with unknown scope, and the lane does not choose between them.
        const people = [...sentence.matchAll(PEOPLE)], places = [...sentence.matchAll(PLACES)];
        const found = [...people.map((m) => ({ m, kind: 'people' as const })), ...places.map((m) => ({ m, kind: 'place' as const }))];
        if (found.length !== 1) continue;
        const { m, kind } = found[0]!;
        const figure = figureOf(m, sentence.slice(0, m.index!));
        if (!figure) continue;
        if (kind === 'people') {
          const adjective = (m[5] ?? '').toLowerCase();
          const noun = m[6]!.toLowerCase();
          if (figure.value < 20 || ((noun === 'people' || noun === 'professionals') && !PEOPLE_NEEDS_VERB.test(sentence.slice(0, m.index!)))) continue;
          const definition: Definition = USER_NOUNS.has(noun) ? (PEOPLE_DEFINITION[adjective] && adjective !== 'paying' ? PEOPLE_DEFINITION[adjective]! : 'users')
            : adjective === 'paying' ? 'paying_customers' : 'customers';
          claims.push({ metricType: 'users', definition, ...figure, quote: sentence, sourceUrl: page.url });
        } else {
          const noun = m[5]!.toLowerCase().replace(/\s+/g, ' ');
          const fieldUnits = /^(?:units|devices|vehicles|systems|robots|installations)/.test(noun);
          if (figure.value < 2 || (!fieldUnits && !SALES_CONTEXT.test(sentence.replace(m[0], ' ')))) continue;
          claims.push({ metricType: 'distribution', definition: 'distribution', ...figure, quote: sentence, sourceUrl: page.url, noun });
        }
      }
    }
  }
  return claims;
}

/**
 * The one claim per slot worth storing: the highest-priority wording whose
 * figure is consistent across the company's own pages. Two different figures
 * under one wording are a conflict and are skipped, never resolved.
 */
export function pickReachClaim(claims: readonly SiteReachClaim[], metricType: 'users' | 'distribution'): SiteReachClaim | null {
  const mine = claims.filter((claim) => claim.metricType === metricType);
  const groups = new Map<string, SiteReachClaim[]>();
  for (const claim of mine) {
    const key = metricType === 'users' ? claim.definition
      : (([...claim.quote.matchAll(PLACES)].map((m) => m[5]!.toLowerCase().replace(/\s+/g, ' '))[0]) ?? claim.definition);
    groups.set(key, [...(groups.get(key) ?? []), claim]);
  }
  const order = metricType === 'users' ? PEOPLE_PRIORITY as string[] : PLACE_PRIORITY;
  const keys = [...groups.keys()].sort((a, b) => {
    const rank = (key: string) => { const at = order.indexOf(key); return at >= 0 ? at : order.length; };
    return rank(a) - rank(b);
  });
  for (const key of keys) {
    const group = groups.get(key)!;
    if (new Set(group.map((claim) => claim.value)).size === 1) {
      // Prefer the statement that says it plainly; a floor stays a floor.
      return group.find((claim) => !claim.lowerBound) ?? group[0]!;
    }
  }
  return null;
}

/**
 * Estimated rows for the open reach slots, built from the company's own pages.
 * Each row's support is the page-quote the gates re-check on every read.
 */
export function ownSiteReachRows(input: {
  companyId: string; companyName: string; website: string | null; pages: readonly SitePage[];
  types: readonly MetricType[]; capturedAt: string; otherCompanies?: readonly string[];
}): CompanyMetric[] {
  if (!input.website) return [];
  const claims = siteReachClaims(input.pages);
  const rows: CompanyMetric[] = [];
  for (const type of ['users', 'distribution'] as const) {
    if (!input.types.includes(type)) continue;
    const claim = pickReachClaim(claims, type);
    if (!claim) continue;
    let hostName = claim.sourceUrl;
    try { hostName = new URL(claim.sourceUrl).hostname.replace(/^www\./, ''); } catch { /* keep the url */ }
    const reportedSupport: ReportedMetricSupport = {
      provider: 'page-quote', companyName: input.companyName, basis: type, value: claim.value, unit: 'count', asOf: null,
      definition: claim.definition,
      support: { supportIndex: 0, text: claim.quote, sources: [{ chunkIndex: 0, url: claim.sourceUrl, title: hostName }] },
    };
    const proposed = { metricType: type, value: claim.value, reportedSupport };
    const citations = reportedMetricCitations(input.companyName, input.website, proposed,
      { answerText: claim.quote, otherCompanies: input.otherCompanies as string[] | undefined });
    if (!citations.length || !usableCitations(citations, input.website).length) continue;
    rows.push({
      id: `met_site_${input.companyId}_${type}`, companyId: input.companyId, metricType: type, value: claim.value,
      confidence: 'estimated', source: citations[0]!.url, citations, methodNote: reportedRowNote(type, reportedSupport),
      capturedAt: input.capturedAt, lastVerifiedAt: null, passageSupport: null, reportedSupport,
    });
  }
  return rows;
}

/** Own-site pages that state what the company is and how far it reaches (not its blog or help centre). */
const REACH_PATH = new RegExp(String.raw`^/?(?:[a-z]{2}(?:-[a-z]{2})?/)?(?:(?:about(?:-us)?|company|customers|who-we-are|our-story|our-company|story|stockists|where-to-buy|store-locator|press|newsroom)/?)?$`, 'i');
export const isReachPage = (url: string): boolean => { try { return REACH_PATH.test(new URL(url).pathname); } catch { return false; } };

/** The company's own about / customers pages linked from its homepage: same
 * origin only, at most `limit`, in link order. A page with no markup (plain extracted
 * text) has no links to follow. */
export function ownSiteLeadUrls(homepage: SitePage, limit = 2): string[] {
  let base: URL;
  try { base = new URL(homepage.url); } catch { return []; }
  const leads: string[] = [];
  const add = (path: string) => {
    try {
      const url = new URL(path, base);
      url.hash = '';
      if (url.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) return;
      if (url.pathname === '/' || url.pathname === base.pathname || leads.includes(url.href)) return;
      leads.push(url.href);
    } catch { /* not a usable link */ }
  };
  for (const match of homepage.text.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"'#]+)["']/gi)) {
    let pathname = '';
    try { pathname = new URL(match[1]!, base).pathname; } catch { continue; }
    if (REACH_PATH.test(pathname) && pathname.replace(/\/+$/, '') !== '') add(match[1]!);
    if (leads.length >= limit) break;
  }
  return leads.slice(0, limit);
}
