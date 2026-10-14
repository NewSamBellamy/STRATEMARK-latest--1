/**
 * Ownership lane: has this company been acquired, is a deal pending, or does a
 * registry name a parent?
 *
 * Sources, free first:
 *  - Wikidata (P749 parent organization; P127 owned by, only when it is a sole
 *    controlling owner). Identity by OFFICIAL WEBSITE (P856), never by name
 *    alone. Wikidata alone is at most `estimated`.
 *  - GLEIF LEI relationship records (direct accounting-consolidation parent, or
 *    an explicit "no parent" reporting exception). The LEI comes only from the
 *    domain-matched Wikidata item or a known identity, never a name search.
 *  - SEC EDGAR: when the acquirer is an SEC registrant, its own 8-Ks filed with
 *    Item 2.01 (acquisition completed) or 1.01 (material agreement), read and
 *    accepted only when the filing's text names this company in a deal sentence.
 *  - Text the pipeline already retains (grounded answers, quoted originals) and
 *    original pages found through the free news lane — only a sentence that
 *    states the deal verbatim counts.
 *
 * Rules (data integrity): nothing is invented. `acquired` needs a sentence
 * saying the deal closed from a PRIMARY source (SEC filing, company or acquirer
 * press release, GLEIF parent record), or two independent sources. Otherwise an
 * announced deal is `acquisition_pending`. Hedged reporting ("in talks",
 * "reportedly", "could") is not a deal. A deal reported terminated is no deal.
 * No evidence is no status — never "independent" by absence.
 */
import { acquisitionPriceSentence, enforceOwnershipProvenance, type Citation, type CompanyMetric, type Ownership } from '@mi/contracts';
import { companyAliases } from './company-aliases';
import { findCompanyFilings } from './sec-ownership';
import { nameTokens, registrableDomain, sameRegistrableDomain } from './registries/shared';
import type { OriginalSourceReceipt, OriginalSourceScope } from './original-source';
import type { WebSearchFn } from './web-search';

// ---------------------------------------------------------------------------
// Evidence text → deal statements

/** One piece of text that may state a deal, with where it came from. */
export interface OwnershipEvidenceText {
  url: string;
  title: string;
  text: string;
  /** The source's own date (article/filing/as-of), used only when the sentence has none. */
  date?: string | null;
  /** True for an SEC filing or a company/acquirer press release read verbatim. */
  primary?: boolean;
  /** Publisher host used to count INDEPENDENT sources (a redirect URL's real publisher). */
  publisher?: string | null;
}

export type DealPhase = 'announced' | 'completed' | 'terminated';

export interface AcquisitionStatement {
  phase: DealPhase;
  acquirer: string | null;
  date: string | null;
  price: { value: number; currency: string } | null;
  sentence: string;
  citation: Citation;
  primary: boolean;
  publisher: string;
}

const PRESS_WIRES = ['prnewswire.com', 'businesswire.com', 'globenewswire.com', 'newswire.ca', 'accesswire.com'];
const HEDGE = /\b(?:in talks|talks (?:to|with|about)|in (?:advanced |early )?discussions|considering|consider(?:s|ed)? (?:a |an )?(?:sale|bid|offer)|explor(?:e|es|ed|ing)|weigh(?:s|ed|ing)?|reportedly|rumou?r(?:s|ed)?|speculat\w*|potential(?:ly)? (?:deal|acquisition|sale|buyer|takeover|merger|acquirer)|possible (?:deal|acquisition|sale|buyer|takeover|merger)|possibly|bid for|offer(?:ed|s)? to (?:buy|acquire)|approach(?:ed|es)?|interest in (?:buying|acquiring)|people familiar|sources (?:said|say)|according to (?:people|sources)|nearing a deal|close to a deal|would consider|if (?:the|a) deal|denied)\b|\?/i;
/** Modal hedges, lower case only: "May 27, 2025" is a date, not a hedge. */
const MODAL_HEDGE = /\b(?:may|might|could)\b/;
const TERMINATED = /\b(?:terminat(?:ed|es|ing)|called off|abandon(?:ed|s|ing)|scrapp(?:ed|ing)|walk(?:ed|s) away|blocked|collapsed|fell through)\b[^.]{0,60}\b(?:acquisition|deal|merger|purchase|takeover|agreement)\b|\b(?:acquisition|deal|merger|purchase|takeover|agreement)\b[^.]{0,40}\b(?:was |has been |had been )?(?:terminated|called off|abandoned|scrapped|blocked|collapsed|fell through)\b/i;

/** Acquirer-first verb phrases; the target follows within a short descriptor. */
const ACTIVE: Array<{ phase: Exclude<DealPhase, 'terminated'>; re: RegExp }> = [
  { phase: 'completed', re: /\b(?:has |had |have )?(?:completed|closed|finali[sz]ed|consummated)\s+(?:its|the|their|his)\s+(?:previously[- ]announced\s+)?(?:acquisition|purchase|takeover)\s+of\s+/gi },
  { phase: 'completed', re: /\b(?:has |had )?(?:acquired|bought|purchased|took over)\s+/gi },
  { phase: 'announced', re: /\b(?:has |have |had )?(?:agreed|signed (?:a |an )?(?:definitive |merger |binding )?agreement|entered into (?:a |an )?(?:definitive |merger |binding )?agreement|reached (?:a |an )?(?:definitive )?(?:agreement|deal))\s+to\s+(?:acquire|buy|purchase|take over)\s+/gi },
  { phase: 'announced', re: /\b(?:announced|announces|unveiled)\s+(?:(?:that )?it (?:has agreed to|will|would|plans to|is to|intends to)\s+|(?:a |an |its )?(?:definitive )?(?:agreement|deal|plans?) to\s+|(?:its |an )?(?:intent|intention) to\s+)?(?:acquire|buy|purchase)\s+/gi },
  { phase: 'announced', re: /\b(?:is |was |are )?(?:to|will|set to|poised to|plans to|agrees to|agreed to)\s+(?:acquire|buy|purchase)\s+/gi },
  { phase: 'announced', re: /(?:['’]s)?\s+(?:proposed |pending |planned |announced |agreed )?(?:acquisition|purchase|takeover) of\s+/gi },
];

/** Target-first phrases; the acquirer follows. */
const PASSIVE: Array<{ phase: Exclude<DealPhase, 'terminated'>; re: RegExp }> = [
  { phase: 'announced', re: /^[^.;]{0,80}?\b(?:agreed to be|agrees to be|will be|is being|is set to be|is to be|to be|would be)\s+(?:acquired|bought|purchased)\s+by\s+/i },
  { phase: 'completed', re: /^[^.;]{0,80}?\b(?:has been|had been|was|were|got|is now|now)\s+(?:officially\s+|formally\s+)?(?:acquired|bought|purchased)\s+by\s+/i },
  { phase: 'completed', re: /^[^.;]{0,60}?\b(?:has been|was|is now|now)\s+(?:a\s+)?(?:wholly[- ]owned\s+)?(?:owned by|subsidiary of|unit of)\s+/i },
  { phase: 'completed', re: /^[^.;]{0,40}?\b(?:sold itself to|was sold to|has been sold to)\s+/i },
];

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const LEADING_STOP = new Set([...MONTHS, 'the', 'on', 'today', 'in', 'yesterday', 'earlier', 'last', 'this', 'meanwhile', 'and', 'but', 'after',
  'when', 'as', 'since', 'with', 'by', 'from', 'then', 'now', 'also', 'however', 'separately', 'officially', 'finally', 'that', 'it']);
const LEGAL = /^(?:inc|inc\.|incorporated|corp|corp\.|corporation|co|co\.|company|ltd|ltd\.|limited|llc|plc|ag|se|sa|s\.a\.|nv|n\.v\.|gmbh|holdings?)$/i;
const NOT_A_BUYER = new Set(['it', 'they', 'we', 'company', 'reuters', 'bloomberg', 'cnbc', 'techcrunch', 'report', 'reports', 'sources', 'sec', 'deal', 'news']);
const TOKEN = /^(?:[A-Z][\w&.'’-]*|[A-Z]{2,}|&|of|and)$/;

function cleanAcquirer(tokens: string[]): string | null {
  let t = tokens.map((x) => x.replace(/[,;:]+$/, ''));
  const poss = t.map((x) => /['’]s$/.test(x)).lastIndexOf(true);
  if (poss >= 0) t = t.slice(poss + 1);
  while (t.length && (LEADING_STOP.has(t[0]!.toLowerCase()) || /^(?:of|and|&)$/i.test(t[0]!))) t = t.slice(1);
  while (t.length && (LEGAL.test(t[t.length - 1]!) || /^(?:of|and|&)$/i.test(t[t.length - 1]!))) t = t.slice(0, -1);
  const name = t.join(' ').replace(/[.,]+$/, '').trim();
  if (name.length < 2 || name.length > 80 || NOT_A_BUYER.has(name.toLowerCase()) || !/[A-Za-z]/.test(name)) return null;
  return name;
}

/** The proper-noun run that ends right before `index` ("Beverage giant PepsiCo"). */
function acquirerBefore(sentence: string, index: number): string | null {
  const tokens = sentence.slice(0, index).trimEnd().split(/\s+/).filter(Boolean);
  const run: string[] = [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i]!;
    const bare = tok.replace(/[,;:]+$/, '');
    // A comma ends the run unless what follows it is a legal suffix ("PepsiCo, Inc.").
    if (/[,;:]$/.test(tok) && run.length && !LEGAL.test(run[0]!)) break;
    if (!TOKEN.test(bare) || /^\d/.test(bare)) break;
    run.unshift(tok);
  }
  return cleanAcquirer(run);
}

/** The proper-noun run that starts at `index` ("acquired by PepsiCo, Inc. in 2025"). */
function acquirerAfter(sentence: string, index: number): string | null {
  const tokens = sentence.slice(index).trimStart().split(/\s+/).filter(Boolean);
  const run: string[] = [];
  for (const tok of tokens) {
    const bare = tok.replace(/[,;:.]+$/, '');
    if (!TOKEN.test(bare) || /^\d/.test(bare)) break;
    run.push(bare);
    if (/[,;:]$/.test(tok) || (/\.$/.test(tok) && !LEGAL.test(bare))) break;
  }
  return cleanAcquirer(run);
}

/**
 * "PepsiCo, Inc. (Nasdaq: PEP) today announced that it has completed its
 * acquisition of poppi": the buyer is the sentence's subject, referred back to
 * by "it". Only that construction; never the first capitalised word at large.
 */
function subjectAcquirer(sentence: string, index: number): string | null {
  const prefix = sentence.slice(0, index).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ');
  if (prefix.length > 200) return null;
  // "<Buyer> [today|on Monday] announced|said [that|on Monday] [it|the company]" — and nothing else.
  const m = /\b(announced|announces|said|says|confirmed|confirms)(?: (?:on \w+|that|today|\w+day))*(?: (?:it|the company))?\s*$/i.exec(prefix);
  if (!m) return null;
  const subject = prefix.slice(0, m.index).replace(/(?:\s+(?:today|yesterday|on \w+|\w+day))+\s*$/i, '');
  return acquirerBefore(subject, subject.length);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive whole-word patterns for every name a source uses for the company. */
function brandPattern(companyName: string, website?: string | null): RegExp | null {
  const aliases = companyAliases(companyName, website).filter((a) => a.replace(/\s/g, '').length >= 3);
  if (!aliases.length) return null;
  const forms = aliases.map((a) => a.split(' ').map(escape).join('[\\s\\W]{1,3}'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${forms.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

function monthIndex(name: string): number {
  const n = name.toLowerCase().replace(/\.$/, '');
  return MONTHS.findIndex((m) => m === n || (n.length >= 3 && m.startsWith(n)));
}
function isoDay(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m, d));
  return date.getUTCMonth() === m && date.getUTCDate() === d ? date.toISOString().slice(0, 10) : null;
}

/** The most specific date written in the sentence: a day, else a month, else a year. */
export function dateInSentence(sentence: string): string | null {
  const iso = /\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/.exec(sentence);
  if (iso) return isoDay(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const mdy = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+((?:19|20)\d{2})\b/i.exec(sentence);
  if (mdy) return isoDay(Number(mdy[3]), monthIndex(mdy[1]!), Number(mdy[2]));
  const dmy = /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+((?:19|20)\d{2})\b/i.exec(sentence);
  if (dmy) return isoDay(Number(dmy[3]), monthIndex(dmy[2]!), Number(dmy[1]));
  const my = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+((?:19|20)\d{2})\b/i.exec(sentence);
  if (my) return `${my[2]}-${String(monthIndex(my[1]!) + 1).padStart(2, '0')}`;
  const years = [...sentence.matchAll(/(?<!(?:founded|established|since|launched) in\s)\b((?:19|20)\d{2})\b/gi)].map((m) => m[1]!);
  return years.length === 1 ? years[0]! : null;
}

const SCALE: Record<string, number> = { trillion: 1e12, billion: 1e9, million: 1e6, bn: 1e9, mn: 1e6, b: 1e9, m: 1e6 };
const CURRENCY: Array<[RegExp, string]> = [[/^(?:US\$|\$|USD\s?)$/i, 'USD'], [/^(?:€|EUR\s?)$/i, 'EUR'], [/^(?:£|GBP\s?)$/i, 'GBP']];

/** The deal price the sentence states: a currency amount the valuation rule reads as a price. */
export function dealPriceInSentence(sentence: string): { value: number; currency: string } | null {
  for (const m of sentence.matchAll(/(US\$|\$|USD\s?|€|EUR\s?|£|GBP\s?)(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million|bn|mn|b|m)?\b/gi)) {
    const currency = CURRENCY.find(([re]) => re.test(m[1]!))?.[1];
    const value = Number(m[2]!.replaceAll(',', '')) * (SCALE[m[3]?.toLowerCase() ?? ''] ?? 1);
    if (!currency || !Number.isFinite(value) || value < 1e5) continue;
    // Literal reuse of the metric-gate rule: the figure must read as a price.
    if (acquisitionPriceSentence(sentence, value) !== null) return { value, currency };
  }
  return null;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function sentencesOf(text: string): string[] {
  return text.normalize('NFKC').replace(/\s+/g, ' ')
    // "PepsiCo, Inc. (Nasdaq: PEP)" and "N.Y." are not sentence ends.
    .split(/(?<!\b(?:Inc|Corp|Co|Ltd|Jr|Sr|Mr|Mrs|Ms|Dr|St|No|vs|[A-Z])\.)(?<=[.!?])\s+(?=[A-Z"“‘'(])/u)
    .map((s) => s.trim()).filter((s) => s.length >= 12 && s.length <= 700);
}

/** Only descriptor words may sit between the verb and the target ("acquire Cursor maker Anysphere"). */
function descriptorOnly(between: string): boolean {
  if (between.length > 70 || /[.;:!?]/.test(between)) return false;
  const words = between.trim().split(/\s+/).filter(Boolean);
  return words.every((w, i) => /^[a-z][\w-]*,?$/.test(w) || /^[A-Z]{2,4}$/.test(w) ||
    (/^[A-Z][\w-]*$/.test(w) && /^(?:maker|developer|creator|operator|owner|parent|brand)$/i.test(words[i + 1] ?? '')));
}

/** A company or acquirer press release, a press wire, or an SEC filing. */
export function isPrimaryOwnershipSource(url: string, companyWebsite: string | null | undefined, acquirer: string | null): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (host === 'sec.gov' || host.endsWith('.sec.gov')) return true;
  if (PRESS_WIRES.some((wire) => host === wire || host.endsWith(`.${wire}`))) return true;
  if (companyWebsite && sameRegistrableDomain(url, companyWebsite)) return true;
  const label = registrableDomain(url)?.split('.')[0] ?? '';
  return !!acquirer && label.length >= 3 && label === nameTokens(acquirer).join('');
}

/**
 * Every deal statement `source` makes about the company, one per sentence.
 * The sentence must name the company and an acquirer in a deal construction;
 * hedged or speculative sentences are not statements.
 */
export function acquisitionStatements(companyName: string, source: OwnershipEvidenceText,
  options: { website?: string | null } = {}): AcquisitionStatement[] {
  const brand = brandPattern(companyName, options.website);
  if (!brand || !source.text) return [];
  const own = nameTokens(companyName).join(' ');
  const out: AcquisitionStatement[] = [];
  const publisher = source.publisher?.trim().toLowerCase().replace(/^www\./, '') || hostOf(source.url);
  for (const sentence of sentencesOf(source.text)) {
    const hits = [...sentence.matchAll(new RegExp(brand.source, brand.flags))];
    if (!hits.length) continue;
    let found: { phase: DealPhase; acquirer: string | null } | null = null;
    if (TERMINATED.test(sentence)) found = { phase: 'terminated', acquirer: null };
    else if (HEDGE.test(sentence) || MODAL_HEDGE.test(sentence)) continue;
    else {
      // Target-first: "poppi has been acquired by PepsiCo".
      for (const hit of hits) {
        const rest = sentence.slice(hit.index! + hit[0].length);
        for (const { phase, re } of PASSIVE) {
          const m = re.exec(rest);
          if (!m) continue;
          const acquirer = acquirerAfter(rest, m[0].length);
          if (acquirer) { found = { phase, acquirer }; break; }
        }
        if (found) break;
      }
      // Acquirer-first: "SpaceX agreed to acquire Cursor maker Anysphere".
      if (!found) {
        outer: for (const { phase, re } of ACTIVE) {
          for (const m of sentence.matchAll(new RegExp(re.source, re.flags))) {
            const verbEnd = m.index! + m[0].length;
            const target = hits.find((h) => h.index! >= verbEnd && descriptorOnly(sentence.slice(verbEnd, h.index!)));
            if (!target) continue;
            const acquirer = acquirerBefore(sentence, m.index!) ?? subjectAcquirer(sentence, m.index!);
            if (acquirer) { found = { phase, acquirer }; break outer; }
          }
        }
      }
    }
    if (!found) continue;
    if (found.acquirer) {
      const buyer = nameTokens(found.acquirer).join(' ');
      // The company cannot be its own acquirer; "Anysphere acquired Graphite" is not ownership.
      if (!buyer || buyer === own || new RegExp(brand.source, brand.flags.replace('g', '')).test(found.acquirer)) continue;
    }
    const primary = source.primary ?? isPrimaryOwnershipSource(source.url, options.website, found.acquirer);
    out.push({
      phase: found.phase,
      acquirer: found.acquirer,
      date: dateInSentence(sentence) ?? source.date ?? null,
      price: found.phase === 'terminated' ? null : dealPriceInSentence(sentence),
      sentence,
      citation: { url: source.url, title: source.title || publisher },
      primary,
      publisher,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Registries

export interface RegistryOwnershipFact {
  registry: 'wikidata' | 'gleif';
  kind: 'parent' | 'independent';
  parent?: string;
  since?: string | null;
  citation: Citation;
}

const WD_API = 'https://www.wikidata.org/w/api.php';
type WdClaim = { rank?: string; mainsnak?: { datavalue?: { value?: unknown } }; qualifiers?: Record<string, Array<{ datavalue?: { value?: unknown } }>> };
type WdEntity = { claims?: Record<string, WdClaim[]>; labels?: { en?: { value?: string } }; missing?: string };

async function getJson(url: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<unknown> {
  const res = await fetchImpl(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}

function claimQid(claim: WdClaim): string | null {
  const v = claim.mainsnak?.datavalue?.value as { id?: unknown } | undefined;
  return typeof v?.id === 'string' && /^Q\d+$/.test(v.id) ? v.id : null;
}

function qualifierTime(claim: WdClaim, prop: string): string | null {
  const v = claim.qualifiers?.[prop]?.[0]?.datavalue?.value as { time?: unknown; precision?: unknown } | undefined;
  if (typeof v?.time !== 'string') return null;
  const m = /^[+]?(\d{4})-(\d{2})-(\d{2})/.exec(v.time);
  if (!m) return null;
  const p = typeof v.precision === 'number' ? v.precision : 11;
  return p <= 9 || m[2] === '00' ? m[1]! : p === 10 || m[3] === '00' ? `${m[1]}-${m[2]}` : `${m[1]}-${m[2]}-${m[3]}`;
}

/** Current controlling-parent claims: no end date; an "owned by" stake must be sole or a majority. */
export function wikidataParentClaims(entity: WdEntity): Array<{ qid: string; since: string | null; prop: 'P749' | 'P127' }> {
  const current = (prop: string) => (entity.claims?.[prop] ?? []).filter((c) => c.rank !== 'deprecated' && !c.qualifiers?.P582);
  const parents = current('P749').flatMap((c) => { const qid = claimQid(c); return qid ? [{ qid, since: qualifierTime(c, 'P580'), prop: 'P749' as const }] : []; });
  if (parents.length) return parents.length === 1 ? parents : [];
  const owners = current('P127');
  if (owners.length !== 1) return []; // investors listed as owners are shareholders, not a parent
  const share = owners[0]!.qualifiers?.P1107?.[0]?.datavalue?.value as { amount?: unknown } | undefined;
  if (share && !(Number(share.amount) >= 0.5)) return [];
  const qid = claimQid(owners[0]!);
  return qid ? [{ qid, since: qualifierTime(owners[0]!, 'P580'), prop: 'P127' }] : [];
}

/** The domain-matched Wikidata item's parent (and its LEI for GLEIF), or null. */
export async function wikidataOwnership(input: { name: string; website: string | null | undefined },
  fetchImpl: typeof fetch, signal?: AbortSignal): Promise<{ qid: string; lei: string | null; facts: RegistryOwnershipFact[] } | null> {
  const domain = registrableDomain(input.website);
  if (!domain) return null;
  const search = await getJson(`${WD_API}?origin=*&format=json&action=wbsearchentities&language=en&type=item&limit=7&search=${encodeURIComponent(input.name)}`, fetchImpl, signal) as { search?: Array<{ id?: unknown }> };
  const ids = (search.search ?? []).map((h) => h.id).filter((id): id is string => typeof id === 'string' && /^Q\d+$/.test(id)).slice(0, 7);
  if (!ids.length) return null;
  const got = await getJson(`${WD_API}?origin=*&format=json&action=wbgetentities&props=claims%7Clabels&languages=en&ids=${ids.join('|')}`, fetchImpl, signal) as { entities?: Record<string, WdEntity> };
  const matched = ids.filter((id) => (got.entities?.[id]?.claims?.P856 ?? [])
    .some((c) => c.rank !== 'deprecated' && typeof c.mainsnak?.datavalue?.value === 'string' && sameRegistrableDomain(c.mainsnak.datavalue.value as string, domain)));
  if (matched.length !== 1) return null;
  const qid = matched[0]!;
  const entity = got.entities![qid]!;
  const leiValue = entity.claims?.P1278?.find((c) => c.rank !== 'deprecated')?.mainsnak?.datavalue?.value;
  const lei = typeof leiValue === 'string' && /^[A-Z0-9]{20}$/.test(leiValue) ? leiValue : null;
  const parents = wikidataParentClaims(entity);
  if (!parents.length) return { qid, lei, facts: [] };
  const labels = await getJson(`${WD_API}?origin=*&format=json&action=wbgetentities&props=labels&languages=en&ids=${parents.map((p) => p.qid).join('|')}`, fetchImpl, signal) as { entities?: Record<string, WdEntity> };
  const facts = parents.flatMap((p): RegistryOwnershipFact[] => {
    const parent = labels.entities?.[p.qid]?.labels?.en?.value?.trim();
    return parent ? [{ registry: 'wikidata', kind: 'parent', parent, since: p.since,
      citation: { url: `https://www.wikidata.org/wiki/${qid}`, title: `Wikidata ${qid} (${p.prop === 'P749' ? 'parent organization' : 'owned by'})` } }] : [];
  });
  return { qid, lei, facts };
}

const GLEIF = 'https://api.gleif.org/api/v1/lei-records';
/** Reporting-exception reasons that state there is no consolidating parent. */
const NO_PARENT_REASONS = new Set(['NATURAL_PERSONS', 'NON_CONSOLIDATING', 'NO_KNOWN_PERSON']);

/** GLEIF direct accounting-consolidation parent, or an explicit "no parent" exception. */
export async function gleifOwnership(lei: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<RegistryOwnershipFact | null> {
  if (!/^[A-Z0-9]{20}$/.test(lei)) return null;
  const citation = { url: `https://search.gleif.org/#/record/${lei}`, title: 'GLEIF LEI record (direct parent)' };
  try {
    const parent = await getJson(`${GLEIF}/${lei}/direct-parent`, fetchImpl, signal) as { data?: { attributes?: { entity?: { legalName?: { name?: unknown } } } } };
    const name = parent.data?.attributes?.entity?.legalName?.name;
    if (typeof name === 'string' && name.trim()) return { registry: 'gleif', kind: 'parent', parent: name.trim(), since: null, citation };
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
  }
  try {
    const exception = await getJson(`${GLEIF}/${lei}/direct-parent-reporting-exception`, fetchImpl, signal) as { data?: { attributes?: { reason?: unknown } } };
    const reason = exception.data?.attributes?.reason;
    return typeof reason === 'string' && NO_PARENT_REASONS.has(reason) ? { registry: 'gleif', kind: 'independent', citation } : null;
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// SEC 8-K (acquirer is an SEC registrant)

type Reader = (url: string, scope?: OriginalSourceScope) => Promise<OriginalSourceReceipt>;

/** The acquirer's own 8-Ks for acquisitions/agreements, read for sentences naming the company. */
export async function secAcquisitionStatements(input: { companyId: string; companyName: string; website?: string | null; acquirer: string; since?: string | null },
  read: Reader, maxReads = 3): Promise<{ statements: AcquisitionStatement[]; receipts: OriginalSourceReceipt[] }> {
  const found = await findCompanyFilings(input.acquirer, (url) => read(url));
  if (!found) return { statements: [], receipts: [] };
  const floor = input.since && /^\d{4}/.test(input.since) ? `${Number(input.since.slice(0, 4)) - 1}${input.since.slice(4)}` : '0000';
  const filings = found.filings.filter((f) => (f.form === '8-K' || f.form === '8-K/A') && f.filingDate >= floor &&
    f.events.some((e) => e === 'Acquisition or sale completed' || e === 'Material agreement')).slice(0, maxReads);
  const statements: AcquisitionStatement[] = [];
  const receipts: OriginalSourceReceipt[] = [];
  for (const filing of filings) {
    const receipt = await read(filing.url, { companyId: input.companyId, companyName: input.companyName, metricType: 'ownership' });
    if (receipt.status !== 'retrieved' || !receipt.text) continue;
    const found8k = acquisitionStatements(input.companyName, {
      url: receipt.finalUrl ?? filing.url, title: `SEC Form ${filing.form} (${filing.events.join('; ')}), filed ${filing.filingDate}`,
      text: receipt.text, date: filing.reportDate ?? filing.filingDate, primary: true, publisher: 'sec.gov',
    }, { website: input.website });
    if (found8k.length) receipts.push(receipt);
    statements.push(...found8k);
  }
  return { statements, receipts };
}

// ---------------------------------------------------------------------------
// Evidence the pipeline already retains

/** Deal sentences carried by stored metric evidence — including a valuation the
 * metric gate rejected as an acquisition price, which is how that price is
 * routed here instead of to the valuation slot. */
export function metricOwnershipEvidence(metrics: readonly CompanyMetric[]): OwnershipEvidenceText[] {
  const out: OwnershipEvidenceText[] = [];
  for (const m of metrics) {
    if (m.quotedSupport) {
      out.push({ url: m.quotedSupport.sourceUrl, title: hostOf(m.quotedSupport.sourceUrl), text: m.quotedSupport.quote, date: m.quotedSupport.asOf });
    }
    if (m.passageSupport?.quote) {
      out.push({ url: m.passageSupport.sourceUrl, title: hostOf(m.passageSupport.sourceUrl), text: m.passageSupport.quote, date: m.passageSupport.asOf || null });
    }
    const support = m.reportedSupport?.support;
    const source = support?.sources[0];
    if (support && source) {
      // Grounded provider text: attributed by Google grounding, not read verbatim from the page.
      out.push({ url: source.url, title: source.title, text: support.text, date: m.reportedSupport!.asOf,
        primary: false, publisher: source.title || hostOf(source.url) });
    }
  }
  return out;
}

/** Retained original pages (verbatim text) for this company. */
export function receiptOwnershipEvidence(receipts: readonly OriginalSourceReceipt[]): OwnershipEvidenceText[] {
  return receipts.filter((r) => r.status === 'retrieved' && r.text)
    .map((r) => ({ url: r.finalUrl ?? r.requestedUrl, title: hostOf(r.finalUrl ?? r.requestedUrl), text: r.text! }));
}

// ---------------------------------------------------------------------------
// Decision

function sameBuyer(a: string, b: string): boolean {
  const x = nameTokens(a).join(' '), y = nameTokens(b).join(' ');
  return !!x && !!y && (x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `));
}

function shortestName(names: readonly string[]): string {
  return [...names].sort((a, b) => a.length - b.length)[0]!;
}

const ordered = (dates: Array<string | null>) => dates.filter((d): d is string => !!d).sort();

/**
 * One ownership record from every statement and registry fact, or null when
 * nothing states one. Pure: the unit tests drive this with fixtures.
 */
export function decideOwnership(input: { statements: readonly AcquisitionStatement[]; registry: readonly RegistryOwnershipFact[]; checkedAt?: string }): Ownership | null {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const deals = input.statements.filter((s) => s.phase !== 'terminated' && s.acquirer);
  const terminated = input.statements.some((s) => s.phase === 'terminated');
  const parents = input.registry.filter((f) => f.kind === 'parent' && f.parent);

  // Group deal statements by buyer.
  const groups: AcquisitionStatement[][] = [];
  for (const s of deals) {
    const group = groups.find((g) => sameBuyer(g[0]!.acquirer!, s.acquirer!));
    if (group) group.push(s); else groups.push([s]);
  }
  const closedGroups = groups.filter((g) => g.some((s) => s.phase === 'completed'));
  // Two different buyers both said to have closed: contradictory, so no claim.
  if (closedGroups.length > 1) return null;
  const group = closedGroups[0] ?? (groups.length === 1 ? groups[0] : groups.length > 1
    ? [...groups].sort((a, b) => b.length - a.length || (ordered(b.map((s) => s.date)).at(-1) ?? '').localeCompare(ordered(a.map((s) => s.date)).at(-1) ?? ''))[0]
    : undefined);

  if (group) {
    const acquirer = shortestName(group.map((s) => s.acquirer!));
    const completed = group.filter((s) => s.phase === 'completed');
    const primaryClose = completed.filter((s) => s.primary);
    const gleifParent = parents.find((p) => p.registry === 'gleif' && sameBuyer(p.parent!, acquirer));
    const wikidataParent = parents.find((p) => p.registry === 'wikidata' && sameBuyer(p.parent!, acquirer));
    const closeSources = new Set(completed.map((s) => s.publisher));
    if (wikidataParent) closeSources.add('wikidata.org');
    const closedByPrimary = primaryClose.length > 0 || !!gleifParent;
    const closed = closedByPrimary || (completed.length > 0 && closeSources.size >= 2);
    // A reported termination with no proof of closing: no deal stands.
    if (terminated && !closed) return null;
    const announced = group.filter((s) => s.phase === 'announced');
    const priced = [...group].sort((a, b) => Number(b.primary) - Number(a.primary)).find((s) => s.price);
    const evidence = closed ? [...(primaryClose.length ? primaryClose : completed), ...announced] : group;
    const citations = [...evidence.map((s) => s.citation), ...(closed && gleifParent ? [gleifParent.citation] : []),
      ...(closed && !closedByPrimary && wikidataParent ? [wikidataParent.citation] : [])];
    const closeDate = closed ? (ordered(primaryClose.map((s) => s.date)).at(-1) ?? ordered(completed.map((s) => s.date)).at(-1) ?? null) : null;
    const record: Ownership = {
      status: closed ? 'acquired' : 'acquisition_pending',
      acquirer,
      announcedOn: ordered(announced.map((s) => s.date))[0] ?? null,
      closedOn: closeDate,
      price: priced?.price ?? null,
      citations,
      confidence: closed ? (closedByPrimary ? 'verified' : 'estimated') : (group.some((s) => s.primary) ? 'verified' : 'estimated'),
      methodNote: closed
        ? closedByPrimary
          ? `Closing stated by a primary source (${primaryClose[0]?.publisher ?? 'GLEIF parent record'}).`
          : `Closing stated by ${closeSources.size} independent sources; no primary source read.`
        : completed.length
          ? `Announced; only one non-primary source says it closed, which is not enough to call it closed.`
          : `Announced (${group.length} source${group.length === 1 ? '' : 's'}); no source read shows the deal closed.`,
      checkedAt,
    };
    return enforceOwnershipProvenance(record, true);
  }

  // No deal on file: a registry parent makes it a subsidiary.
  const gleif = parents.find((p) => p.registry === 'gleif');
  const parent = gleif ?? (parents.length === 1 ? parents[0] : undefined);
  if (parent) {
    return enforceOwnershipProvenance({
      status: 'subsidiary', acquirer: parent.parent!, announcedOn: null, closedOn: null, price: null,
      citations: [parent.citation], confidence: parent.registry === 'gleif' ? 'verified' : 'estimated',
      methodNote: parent.registry === 'gleif' ? 'GLEIF records a direct consolidating parent.' : 'Wikidata names a parent organization; not confirmed by a primary source.',
      checkedAt,
    }, true);
  }
  const independent = input.registry.find((f) => f.kind === 'independent');
  if (independent && !terminated) {
    return enforceOwnershipProvenance({
      status: 'independent', announcedOn: null, closedOn: null, price: null, citations: [independent.citation],
      confidence: 'verified', methodNote: 'GLEIF records no consolidating parent.', checkedAt,
    }, true);
  }
  return null;
}

// ---------------------------------------------------------------------------
// The whole lane over injected transports

export interface OwnershipServices {
  /** Direct JSON fetch for CORS-open registries (Wikidata, GLEIF). */
  fetchImpl?: typeof fetch;
  /** The original-source reader (SEC filings, news articles). */
  read?: Reader;
  /** Free news discovery; a result is only a candidate page to read. */
  newsSearch?: WebSearchFn | null;
  signal?: AbortSignal;
  nowMs?: number;
}

export interface OwnershipFinding {
  ownership: Ownership | null;
  statements: AcquisitionStatement[];
  registry: RegistryOwnershipFact[];
  /** Pages read that stated a deal: the caller retains them. */
  receipts: OriginalSourceReceipt[];
}

const ACQ_WORDING = /\b(?:acquir\w*|acquisition|bought|buy|buys|purchase\w*|takeover|merger|deal)\b/i;
const NEWS_READS = 3;

/** Run every lane, never throwing: a failed lane only means less evidence. */
export async function findOwnership(input: { companyId: string; companyName: string; websiteUrl: string | null; texts: readonly OwnershipEvidenceText[]; lei?: string | null },
  services: OwnershipServices): Promise<OwnershipFinding> {
  const website = input.websiteUrl;
  const statements: AcquisitionStatement[] = input.texts.flatMap((t) => acquisitionStatements(input.companyName, t, { website }));
  const registry: RegistryOwnershipFact[] = [];
  const receipts: OriginalSourceReceipt[] = [];
  const fetchImpl = services.fetchImpl;

  const registries = (async () => {
    if (!fetchImpl) return;
    let lei = input.lei ?? null;
    try {
      const wd = await wikidataOwnership({ name: input.companyName, website }, fetchImpl, services.signal);
      if (wd) { registry.push(...wd.facts); lei ??= wd.lei; }
    } catch { /* no Wikidata evidence */ }
    if (lei) {
      try {
        const fact = await gleifOwnership(lei, fetchImpl, services.signal);
        if (fact) registry.push(fact);
      } catch { /* no GLEIF evidence */ }
    }
  })();

  const news = (async () => {
    const search = services.newsSearch;
    const read = services.read;
    if (!search || !read) return;
    const brand = input.companyName.trim();
    let results: Awaited<ReturnType<WebSearchFn>> = [];
    try { results = await search(`"${brand}" acquisition`, { news: true, sinceDays: 730 }); } catch { return; }
    const brandRe = brandPattern(input.companyName, website);
    const candidates = results.filter((r) => brandRe && new RegExp(brandRe.source, 'iu').test(`${r.title} ${r.snippet}`) &&
      ACQ_WORDING.test(`${r.title} ${r.snippet}`)).slice(0, NEWS_READS);
    await Promise.all(candidates.map(async (r) => {
      try {
        const receipt = await read(r.url, { companyId: input.companyId, companyName: input.companyName, metricType: 'ownership' });
        if (receipt.status !== 'retrieved' || !receipt.text) return;
        const found = acquisitionStatements(input.companyName, {
          url: receipt.finalUrl ?? r.url, title: r.publisher || hostOf(receipt.finalUrl ?? r.url), text: receipt.text,
          date: r.published && /^\d{4}-\d{2}-\d{2}$/.test(r.published) ? r.published : null,
        }, { website });
        if (found.length) { statements.push(...found); receipts.push(receipt); }
      } catch { /* an unreadable article is not evidence */ }
    }));
  })();

  await Promise.all([registries, news]);

  // The acquirer's own SEC filing is the primary source for a close.
  const lead = statements.filter((s) => s.acquirer && s.phase !== 'terminated' && !s.primary);
  if (services.read && lead.length && !statements.some((s) => s.primary && s.phase === 'completed')) {
    const acquirer = shortestName(lead.map((s) => s.acquirer!));
    try {
      const sec = await secAcquisitionStatements({ companyId: input.companyId, companyName: input.companyName, website, acquirer,
        since: ordered(lead.map((s) => s.date))[0] ?? null }, services.read);
      statements.push(...sec.statements);
      receipts.push(...sec.receipts);
    } catch { /* not a registrant, or EDGAR unavailable */ }
  }

  return {
    ownership: decideOwnership({ statements, registry, checkedAt: new Date(services.nowMs ?? Date.now()).toISOString() }),
    statements, registry, receipts,
  };
}
