/**
 * Risk (vice) and culture cards for the companies a deck already holds.
 *
 * Barrier and insight cards come from one market-level search (signal-agents). Vice and culture cards used to
 * come only from discovery tagging a company as "known for a controversy" or "known for its culture", and the
 * passes that look for those were switched off for any market whose words include "infrastructure" or "B2B"
 * (the Meal Kit market's cold-chain theme was enough). Four live decks in a row came out with none, and a deck
 * with no vice or culture card reads as unfinished.
 *
 * This is the second way in: ONE grounded search, asked about the deck's own companies by name, for a documented
 * controversy and for what a company's culture stands for. Nothing is invented and nothing is attributed on a guess:
 *   - the company the answer names must be exactly one company of the deck, by its own name (not a longer name
 *     that merely contains it: "Check Point Software" is not "Check");
 *   - the sentence must name that company near its start, and no other company of the deck in any case or form
 *     (a sentence about a rival is not a claim about this one);
 *   - it must carry a clickable source from the search itself, and that source must be attached to sentences of the
 *     answer that are about this company and say the same thing, or it is dropped.
 * A market with nothing documented gets no card, and says so; it is never padded.
 */
import { z } from 'zod';
import { isJunkSource, type CardWithCompany, type Citation, type Company } from '@mi/contracts';
import { claimSupportCitations, sourceBacksClaim, type ClaimScope } from './claim-support';
import { aliasSpans, canon, companyAliases } from './company-aliases';
import { registrableDomain } from './registries/shared';
import { companyNameKey } from './market-quote';
import { GROUNDED_SYSTEM, STRUCTURE_SYSTEM } from './prompts';
import { namesRosterRival } from './reported-metrics';
import { createCultureCard, createViceCard, extractSourcedViceClaims, resolveClaimCitations, type RawViceClaimInput } from './signal-agents';
import type { LlmClient, MarketPlan } from './types';
import { throwIfAborted } from './util';

const rosterSignalsOutSchema = z.object({
  risks: z.array(z.object({
    company: z.string().min(1),
    text: z.string().min(1),
    sourceIndex: z.number().int().nullable().default(null),
  })).default([]),
  culture: z.array(z.object({
    company: z.string().min(1),
    note: z.string().min(1),
    sourceIndex: z.number().int().nullable().default(null),
  })).default([]),
});

export interface RosterSignalsOptions {
  signal?: AbortSignal;
  /** Which kinds are wanted: a deck that already has enough of one does not pay to search for it. */
  want?: { vice: boolean; culture: boolean };
  /** Companies that already have this kind of card (never a second one for the same company). */
  haveVice?: ReadonlySet<string>;
  haveCulture?: ReadonlySet<string>;
  /** Most cards of each kind one search may add. */
  maxVice?: number;
  maxCulture?: number;
}

/** The most companies one question names; a longer list dilutes the search. */
const ROSTER_LIMIT = 20;
const MAX_CLAIMS_PER_COMPANY = 3;
const SENTENCE_MIN = 30;
const SENTENCE_MAX = 420;
const NOTE_MAX = 320;
/** A claim is about its company when the company is named within this many characters of its start. */
const SUBJECT_WITHIN = 30;
/**
 * What a sentence that backs a RISK reads like. A support about an award or a launch shares a company's name and its
 * product nouns with a sentence about its recall, and must not back it.
 */
const CONTROVERSY = /\b(?:fine[ds]?|fining|lawsuits?|sued|suing|settle[ds]?|settlements?|recall(?:ed|s)?|breach(?:ed|es)?|hack(?:ed)?|leak(?:ed)?|probe[ds]?|inquir\w*|investigat\w*|penalt\w*|violat\w*|class[- ]action|complaints?|alleg\w*|ruled|convict\w*|indict\w*|arrest\w*|jail\w*|prison\w*|imprison\w*|sentenc\w*|charged (?:with|over)|bankrupt\w*|insolven\w*|chapter\s?11|layoffs?|laid off|unsafe|fraud\w*|misleading|deceptive|injunction|sanction\w*|attorneys? general|fatal\w*|injur\w*|fire hazard|discriminat\w*|harass\w*|whistleblow\w*|scandal|controvers\w*|criticis\w*|criticiz\w*|banned|subpoena\w*|cease[- ]and[- ]desist|shut down|wrongful\w*|negligen\w*)\b/i;

export function rosterSignalsPrompt(plan: MarketPlan, roster: readonly Pick<Company, 'name'>[], want: { vice: boolean; culture: boolean }): string {
  const where = plan.geography ? ` in ${plan.geography}` : '';
  const names = roster.slice(0, ROSTER_LIMIT).map((company) => `- ${JSON.stringify(company.name)}`).join('\n');
  const lines = [
    `Using Google Search, look for documented controversies and culture signals about companies in the market "${plan.marketName}" (${plan.vertical})${where}.`,
    '',
    'Companies (use these exact names):',
    names,
    '',
  ];
  if (want.vice) {
    lines.push('RISKS: for as many of these companies as have one (aim for at least 4), find a documented controversy: a lawsuit, regulatory action, fine, recall, data breach, labour dispute, misleading-practice ruling, or investigative report. Write each as one plain sentence that begins with the company, says what happened and when, and names no other company. Skip a company with nothing credible.', '');
  }
  if (want.culture) {
    lines.push('CULTURE: for as many of these companies as have one (aim for at least 4), find what its culture or community stands for according to its sources: stated mission and values, employee-reported culture, customer community, public stands, certified-company status. Write each as one plain sentence that begins with the company and names no other company. Skip a company with nothing credible.', '');
  }
  lines.push('Ground every point in what you actually find. Never speculate, and never pad the list: if a company has nothing credible, leave it out.');
  return lines.join('\n');
}

/** A piece that ends in one of these did not end a sentence: initials ("U.S."), titles, company forms. */
const ABBREVIATION_END = /(?:\b(?:[A-Z]\.){1,3}|\b(?:v|vs|Inc|Corp|Co|Ltd|LLC|PLC|Mr|Mrs|Ms|Dr|St|No|Jr|Sr|Mt|Fig|e\.g|i\.e)\.)$/;

/** Sentences of a note: a full stop followed by a capital opens the next one, except after an abbreviation ("U.S.", "Inc."). */
function noteSentences(text: string): string[] {
  const pieces = text.split(/(?<=[.!?])\s+(?=[A-Z“"‘'])/u).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const piece of pieces) {
    const before = out[out.length - 1];
    if (before !== undefined && ABBREVIATION_END.test(before)) out[out.length - 1] = `${before} ${piece}`;
    else out.push(piece);
  }
  return out;
}

/**
 * The sentences a culture note opens with, cut at a sentence end; null when it is too short or when its first sentence
 * alone does not fit (a decimal or "U.S." is not a sentence end, so a long note is never cut mid-sentence).
 */
function cultureNote(raw: string): string | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length < SENTENCE_MIN) return null;
  if (text.length <= NOTE_MAX) return text;
  let out = '';
  for (const sentence of noteSentences(text)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > NOTE_MAX) break;
    out = next;
  }
  return out.length >= SENTENCE_MIN ? out : null;
}

/**
 * The one deck company a name in the answer means; null when it means none or more than one. A name matches by the
 * company's own name or one of its aliases, exactly: a longer name that merely contains a company's name ("Check Point
 * Software" for "Check", "Merge Labs" for "Merge", "Square Enix" for "Square") is a different company.
 */
export function companyNamed(name: string, roster: readonly Company[]): Company | null {
  const asked = companyNameKey(name.replace(/\([^)]*\)/g, ' '));
  if (!asked) return null;
  const exact = roster.filter((company) => companyNameKey(company.name.replace(/\([^)]*\)/g, ' ')) === asked);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const aliased = roster.filter((company) => companyAliases(company.name, company.websiteUrl).some((alias) => companyNameKey(alias) === asked));
  return aliased.length === 1 ? aliased[0]! : null;
}

/** Words that may follow a company's name without making it a different name ("Acme Robotics Inc."). */
const NAME_TAIL = new Set(['inc', 'corp', 'corporation', 'co', 'ltd', 'limited', 'llc', 'plc', 'gmbh', 'ag', 'sa', 'nv', 'bv', 'pbc', 'company', 'group', 'holdings']);
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether the company's first mention in the text is the front of a longer proper noun that is not its own name: "Check
 * Point Software" for the company Check, "Square Enix" for Square. The capitalised word right after the mention must be a
 * legal form or part of the company's own name, or it is another entity that merely starts with this one.
 */
function followedByOtherName(text: string, company: Company): boolean {
  const aliases = companyAliases(company.name, company.websiteUrl);
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
export function aboutCompany(text: string, company: Company, roster: readonly Company[], early = true): boolean {
  const own = aliasSpans(text, companyAliases(company.name, company.websiteUrl));
  if (own.length === 0) return false;
  if (early && Math.min(...own.map(([start]) => start)) > SUBJECT_WITHIN) return false;
  if (followedByOtherName(text, company)) return false;
  for (const other of roster) {
    if (other.id === company.id) continue;
    for (const [start, end] of aliasSpans(text, companyAliases(other.name, other.websiteUrl))) {
      if (!own.some(([ownStart, ownEnd]) => ownStart <= start && end <= ownEnd && ownEnd - ownStart > end - start)) return false;
    }
  }
  return true;
}

/** What a claim about this company may be backed by: sentences about it, with its name not counted as a shared word. */
function scopeFor(company: Company, roster: readonly Company[], oneSentence: boolean, risk = false): ClaimScope {
  const ignore = new Set(companyAliases(company.name, company.websiteUrl).flatMap((alias) => alias.split(' ')));
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
function sourceIsFit(source: { title: string; url: string }, company: Company, roster: readonly Company[], risk: boolean): boolean {
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
  return companyAliases(company.name, company.websiteUrl).some((alias) => {
    const compact = alias.replace(/\s+/g, '');
    return compact.length >= 5 && label.includes(compact);
  });
}

/** A claim's identity for de-duplication: case, punctuation and a final full stop do not make a different claim. */
const claimKey = (text: string): string => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

export async function researchRosterSignals(
  client: LlmClient,
  plan: MarketPlan,
  deckId: string,
  roster: readonly Company[],
  options: RosterSignalsOptions = {},
): Promise<{ vice: CardWithCompany[]; culture: CardWithCompany[] }> {
  throwIfAborted(options.signal);
  const want = options.want ?? { vice: true, culture: true };
  const empty = { vice: [] as CardWithCompany[], culture: [] as CardWithCompany[] };
  if ((!want.vice && !want.culture) || roster.length === 0) return empty;

  const names = roster.map((company) => company.name);
  const grounded = await client.ground(rosterSignalsPrompt(plan, roster, want), {
    system: GROUNDED_SYSTEM, label: 'signal:roster', signal: options.signal,
  });
  const sources = grounded.citations.map((c, i) => `[${i}] ${c.title} — ${c.url}`).join('\n') || '(none)';
  const out = await client.structure(
    [
      'From the notes, output JSON { "risks": [ { "company", "text", "sourceIndex" } ], "culture": [ { "company", "note", "sourceIndex" } ] }.',
      '"company" is the exact name from the list the notes were asked about. "text" and "note" are one plain sentence taken from the notes that names the company and no other company.',
      '"sourceIndex" is the 0-based index of the source that supports it, or null if none of the listed sources do.',
      'If the notes do not support an item, leave it out rather than inventing it. Return nothing for a company the notes say nothing about.',
      '',
      'SOURCES:',
      sources,
      '',
      'NOTES:',
      grounded.text,
    ].join('\n'),
    rosterSignalsOutSchema,
    { system: STRUCTURE_SYSTEM, signal: options.signal },
  );

  const citations = grounded.citations;
  const vice: CardWithCompany[] = [];
  const culture: CardWithCompany[] = [];

  if (want.vice) {
    const byCompany = new Map<string, { company: Company; raw: RawViceClaimInput[] }>();
    for (const risk of out.risks) {
      const company = companyNamed(risk.company, roster);
      const text = risk.text.replace(/\s+/g, ' ').trim();
      if (!company || options.haveVice?.has(company.id)) continue;
      if (text.length < SENTENCE_MIN || text.length > SENTENCE_MAX) continue;
      // One sentence, one claim: a second sentence or a clause after a semicolon is a second claim that no source was
      // looked up for, and would ride on the first one's source.
      if (noteSentences(text).length > 1 || text.includes(';')) continue;
      if (!aboutCompany(text, company, roster)) continue;
      if (namesRosterRival(text, company.name, names)) continue;
      // The source the structuring step named, if the sentences it is attached to are about this company and say this; else the
      // one the search attached to the sentence itself. A risk is never filed on a source that cannot be checked against it.
      const scope = scopeFor(company, roster, true, true);
      const named = resolveClaimCitations(risk.sourceIndex, null, citations)
        .filter((c) => sourceIsFit(c, company, roster, true) && sourceBacksClaim(c.url, text, grounded.grounding, scope, true))[0];
      const source = named ?? claimSupportCitations(text, grounded.grounding, 3, scope).filter((c) => sourceIsFit(c, company, roster, true))[0];
      if (!source) continue;
      const entry = byCompany.get(company.id) ?? { company, raw: [] };
      if (entry.raw.length < MAX_CLAIMS_PER_COMPANY && !entry.raw.some((r) => claimKey(r.text) === claimKey(text))) entry.raw.push({ text, sourceUrl: source.url, sourceTitle: source.title });
      byCompany.set(company.id, entry);
    }
    for (const { company, raw } of byCompany.values()) {
      if (vice.length >= (options.maxVice ?? 8)) break;
      const claims = extractSourcedViceClaims(raw, citations, company.id);
      if (claims.length > 0) vice.push(createViceCard(company, claims, deckId));
    }
  }

  if (want.culture) {
    const seen = new Set<string>();
    for (const item of out.culture) {
      if (culture.length >= (options.maxCulture ?? 8)) break;
      const company = companyNamed(item.company, roster);
      if (!company || seen.has(company.id) || options.haveCulture?.has(company.id)) continue;
      const whole = cultureNote(item.note);
      if (!whole || !aboutCompany(whole, company, roster)) continue;
      if (namesRosterRival(whole, company.name, names)) continue;
      const scope = scopeFor(company, roster, false);
      // Each sentence of the note needs its own backing: the ones nothing backs are left out, never carried along on the
      // source of the one that is.
      const kept: string[] = [];
      const cited: Citation[] = [];
      for (const part of noteSentences(whole)) {
        const named = resolveClaimCitations(item.sourceIndex, null, citations)
          .filter((c) => sourceIsFit(c, company, roster, false) && sourceBacksClaim(c.url, part, grounded.grounding, scope));
        const found = named.length > 0 ? named : claimSupportCitations(part, grounded.grounding, 2, scope).filter((c) => sourceIsFit(c, company, roster, false));
        if (found.length === 0) continue;
        kept.push(part);
        for (const c of found) if (!cited.some((have) => have.url === c.url)) cited.push(c);
      }
      const note = kept.join(' ');
      if (kept.length === 0 || note.length < SENTENCE_MIN || !aboutCompany(note, company, roster)) continue;
      seen.add(company.id);
      culture.push(createCultureCard(company, note, cited.slice(0, 2), deckId));
    }
  }
  return { vice, culture };
}
