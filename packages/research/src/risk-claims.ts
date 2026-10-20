/**
 * The one rule a risk (vice) claim must pass before it is stored, however it was found.
 *
 * A risk is a documented controversy about a company, shown with the page that states it. The model's own source number is
 * not evidence of that: it can name a page the search never attached to the sentence, a page about something else, or the
 * company's own website. So a risk is accepted only when
 *   - it is ONE sentence (a second sentence or a clause after a semicolon is a claim no source was looked up for);
 *   - it is about this company: it names the company near its start and no other company of the deck;
 *   - one FIT source stands behind it: a public page that is not the company's own site (nor a rival's), which the search
 *     itself attributed to a sentence that is about this company, reads like the event, and states every event the claim does.
 * A finding that fails any of these is dropped. It is never shown and never downgraded to a note.
 *
 * Both ways a risk can be found go through `acceptedRiskClaim`: the one search over a deck's roster (roster-signals) and
 * the search about one company (the company agent, the ViceAgent). The same functions decide, so the two cannot drift apart.
 * With no search attribution at all (a run whose answer carried no supports), nothing can be traced and every risk is dropped.
 */
import { isJunkSource, type Citation, type Company } from '@mi/contracts';
import { claimSupportCitations, resolveClaimCitations, sourceBacksClaim, type ClaimScope } from './claim-support';
import { aliasSpans, canon, companyAliases } from './company-aliases';
import { companyNameKey } from './market-quote';
import { registrableDomain } from './registries/shared';
import { namesRosterRival } from './reported-metrics';
import type { ProviderGrounding } from './types';

export const SENTENCE_MIN = 30;
export const SENTENCE_MAX = 420;
/** A claim is about its company when the company is named within this many characters of its start. */
const SUBJECT_WITHIN = 30;
/** Most risk claims one company's card carries. */
export const MAX_CLAIMS_PER_COMPANY = 3;

/**
 * What a sentence that backs a RISK reads like. A support about an award or a launch shares a company's name and its
 * product nouns with a sentence about its recall, and must not back it.
 */
export const CONTROVERSY = /\b(?:fine[ds]?|fining|lawsuits?|sued|suing|settle[ds]?|settlements?|recall(?:ed|s)?|breach(?:ed|es)?|hack(?:ed)?|leak(?:ed)?|probe[ds]?|inquir\w*|investigat\w*|penalt\w*|violat\w*|class[- ]action|complaints?|alleg\w*|ruled|convict\w*|indict\w*|arrest\w*|jail\w*|prison\w*|imprison\w*|sentenc\w*|charged (?:with|over)|bankrupt\w*|insolven\w*|chapter\s?11|layoffs?|laid off|unsafe|fraud\w*|misleading|deceptive|injunction|sanction\w*|attorneys? general|fatal\w*|injur\w*|fire hazard|discriminat\w*|harass\w*|whistleblow\w*|scandal|controvers\w*|criticis\w*|criticiz\w*|banned|subpoena\w*|cease[- ]and[- ]desist|shut down|wrongful\w*|negligen\w*)\b/i;

/** A piece that ends in one of these did not end a sentence: initials ("U.S."), titles, company forms. */
const ABBREVIATION_END = /(?:\b(?:[A-Z]\.){1,3}|\b(?:v|vs|Inc|Corp|Co|Ltd|LLC|PLC|Mr|Mrs|Ms|Dr|St|No|Jr|Sr|Mt|Fig|e\.g|i\.e)\.)$/;

/** Sentences of a note: a full stop followed by a capital opens the next one, except after an abbreviation ("U.S.", "Inc."). */
export function noteSentences(text: string): string[] {
  const pieces = text.split(/(?<=[.!?])\s+(?=[A-Z“"‘'])/u).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const piece of pieces) {
    const before = out[out.length - 1];
    if (before !== undefined && ABBREVIATION_END.test(before)) out[out.length - 1] = `${before} ${piece}`;
    else out.push(piece);
  }
  return out;
}

/** A company's aliases, in the apostrophe-free, ampersand-free form the signal cards compare. */
export const aliasesOf = (company: Company): string[] => companyAliases(canon(company.name), company.websiteUrl);

/** Words that may follow a company's name without making it a different name ("Acme Robotics Inc."). */
const NAME_TAIL = new Set(['inc', 'corp', 'corporation', 'co', 'ltd', 'limited', 'llc', 'plc', 'gmbh', 'ag', 'sa', 'nv', 'bv', 'pbc', 'company', 'group', 'holdings']);
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether the company's first mention in the text is the front of a longer proper noun that is not its own name: "Check
 * Point Software" for the company Check, "Square Enix" for Square. The capitalised word right after the mention must be a
 * legal form or part of the company's own name, or it is another entity that merely starts with this one.
 */
function followedByOtherName(text: string, company: Company): boolean {
  const aliases = aliasesOf(company);
  const own = new Set(aliases.flatMap((alias) => alias.split(' ')));
  const written = canon(text);
  let first: { start: number; end: number } | null = null;
  for (const alias of aliases) {
    const words = alias.split(' ').filter(Boolean);
    if (words.length === 0) continue;
    const found = new RegExp(`(?<![\\p{L}\\p{N}])${words.map(escapeRegExp).join('[^\\p{L}\\p{N}]+')}(?![\\p{L}\\p{N}])`, 'iu').exec(written);
    if (!found) continue;
    const end = found.index + found[0].length;
    if (!first || found.index < first.start || (found.index === first.start && end > first.end)) first = { start: found.index, end };
  }
  if (!first) return false;
  const next = /^[ \t]+(\p{Lu}[\p{L}\p{N}-]*)/u.exec(written.slice(first.end));
  if (!next) return false;
  const word = next[1]!.toLowerCase();
  return !(NAME_TAIL.has(word) || own.has(word));
}

/**
 * Whether a sentence is about this company: it names the company (by any alias, any case) near its start, as itself and
 * not as the front of a longer name, and names no other company of the deck, unless that other name is only part of a
 * longer mention of this one ("Gusto" inside "Gusto Pro" when the company is Gusto Pro).
 */
export function aboutCompany(rawText: string, company: Company, roster: readonly Company[], early = true): boolean {
  // Names and text are compared with apostrophes dropped and & read as "and": Wendys is Wendy's, Procter and Gamble is Procter & Gamble.
  const text = canon(rawText);
  const own = aliasSpans(text, aliasesOf(company));
  if (own.length === 0) return false;
  if (early && Math.min(...own.map(([start]) => start)) > SUBJECT_WITHIN) return false;
  if (followedByOtherName(text, company)) return false;
  for (const other of roster) {
    if (other.id === company.id) continue;
    for (const [start, end] of aliasSpans(text, aliasesOf(other))) {
      if (!own.some(([ownStart, ownEnd]) => ownStart <= start && end <= ownEnd && ownEnd - ownStart > end - start)) return false;
    }
  }
  return true;
}

/** What a claim about this company may be backed by: sentences about it, with its name not counted as a shared word. */
export function scopeFor(company: Company, roster: readonly Company[], oneSentence: boolean, risk = false): ClaimScope {
  const ignore = new Set(aliasesOf(company).flatMap((alias) => alias.split(' ')));
  return { about: (text) => aboutCompany(text, company, roster, false), ignore, oneSentence, ...(risk ? { reads: CONTROVERSY } : {}) };
}

/** The registrable domain a source sits on: of its address, or, for a redirect, of the publisher name it is titled with. */
function sourceDomain(source: { title: string; url: string }): string | null {
  const direct = registrableDomain(source.url);
  if (direct && !/(^|\.)google\.com$/.test(direct)) return direct;
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(source.title.trim()) ? registrableDomain(`https://${source.title.trim()}`) : null;
}

/**
 * Whether a source can stand behind a claim about this company. A company's own website is not evidence of a controversy about
 * it (and, for either kind of claim, a rival's own website is not evidence about this company).
 */
export function sourceIsFit(source: { title: string; url: string }, company: Company, roster: readonly Company[], risk: boolean): boolean {
  if (isJunkSource(source.url, source.title) || !publicWebAddress(source.url)) return false;
  const domain = sourceDomain(source);
  if (!domain) return true;
  if (risk && (registrableDomain(company.websiteUrl) === domain || looksLikeOwnSite(domain, company))) return false;
  return !roster.some((other) => other.id !== company.id && registrableDomain(other.websiteUrl) === domain);
}

/** A page on the public web: a real host, not localhost, an address, or a name only a private network resolves. */
function publicWebAddress(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes('.') && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && !host.startsWith('[')
      && !/(?:^|\.)(?:localhost|local|internal|lan|home|corp|test|invalid)$/.test(host);
  } catch {
    return false;
  }
}

/** A domain named after the company is its own site, even when no website is recorded for it. */
function looksLikeOwnSite(domain: string, company: Company): boolean {
  const label = (domain.split('.')[0] ?? '').replace(/-/g, '');
  return aliasesOf(company).some((alias) => {
    const compact = alias.replace(/\s+/g, '');
    return compact.length >= 5 && label.includes(compact);
  });
}

/** A claim's identity for de-duplication: case, punctuation and a final full stop do not make a different claim. */
export const claimKey = (text: string): string => text.toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A risk as the structuring step wrote it: a sentence and the number of the source it says supports it. */
export interface ModelRiskFinding {
  text: string;
  sourceIndex?: number | null;
}

/** A risk that passed the rule: its sentence and the one fit source the search attributed it to. */
export interface AcceptedRiskClaim {
  text: string;
  sourceUrl: string;
  sourceTitle: string;
}

export interface RiskEvidence {
  /** The sources of the answer, in the order the structuring step numbered them. */
  citations: readonly Citation[];
  /** What the search attributed to which source; without it nothing can be traced and no risk is accepted. */
  grounding: ProviderGrounding | undefined;
}

/**
 * The accepted form of one risk finding about `company`, or null when it fails the rule. `roster` is every company of the deck
 * (the company included): a sentence about a rival, or a source that is a rival's own site, cannot back it.
 */
export function acceptedRiskClaim(
  finding: ModelRiskFinding,
  company: Company,
  roster: readonly Company[],
  evidence: RiskEvidence,
): AcceptedRiskClaim | null {
  const text = finding.text.replace(/\s+/g, ' ').trim();
  if (text.length < SENTENCE_MIN || text.length > SENTENCE_MAX) return null;
  // One sentence, one claim: a second sentence or a clause after a semicolon is a second claim that no source was
  // looked up for, and would ride on the first one's source.
  if (noteSentences(text).length > 1 || text.includes(';')) return null;
  if (!aboutCompany(text, company, roster)) return null;
  if (namesRosterRival(text, company.name, roster.map((member) => member.name))) return null;
  // The source the structuring step named, if the sentences it is attached to are about this company and say this; else the
  // one the search attached to the sentence itself. A risk is never filed on a source that cannot be checked against it.
  const scope = scopeFor(company, roster, true, true);
  const named = resolveClaimCitations(finding.sourceIndex, null, evidence.citations)
    .filter((c) => sourceIsFit(c, company, roster, true) && sourceBacksClaim(c.url, text, evidence.grounding, scope, true))[0];
  const source = named ?? claimSupportCitations(text, evidence.grounding, 3, scope).filter((c) => sourceIsFit(c, company, roster, true))[0];
  return source ? { text, sourceUrl: source.url, sourceTitle: source.title } : null;
}

/**
 * The accepted risks among the findings of one company's own search (the company agent, the ViceAgent). `others` are the names
 * of the deck's other companies, when known: they are the rivals a sentence must not name. Duplicates collapse and one company
 * carries at most MAX_CLAIMS_PER_COMPANY, as on the roster path.
 */
export function acceptedRiskClaims(
  findings: readonly ModelRiskFinding[],
  company: Company,
  others: readonly string[],
  evidence: RiskEvidence,
): AcceptedRiskClaim[] {
  const own = companyNameKey(company.name);
  const rivals = others.filter((name) => companyNameKey(name) !== own).map((name): Company => ({
    id: `rival:${companyNameKey(name)}`, name, oneLiner: '', logoUrl: null, hqLocation: null, websiteUrl: null, brandTheme: null,
  }));
  const roster = [company, ...rivals];
  const out: AcceptedRiskClaim[] = [];
  for (const finding of findings) {
    if (out.length >= MAX_CLAIMS_PER_COMPANY) break;
    const accepted = acceptedRiskClaim(finding, company, roster, evidence);
    if (accepted && !out.some((claim) => claimKey(claim.text) === claimKey(accepted.text))) out.push(accepted);
  }
  return out;
}
