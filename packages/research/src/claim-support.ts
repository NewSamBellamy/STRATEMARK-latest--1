/**
 * Sources for a claim, from the search engine's own attribution.
 *
 * A grounded answer comes with "supports": a sentence of the answer and the sources the search attributes it to. The
 * structuring step that turns the answer into cards is asked for a source number per card, and on live decks it often
 * answered null for every card (seven barriers, seven nulls), so a market with plenty of sourced material ended with
 * one card or none. The sources the engine itself attached to the answer's sentences were right there.
 *
 * A card's sources are therefore also looked up from those supports: a support counts when most of its distinctive words
 * are in the claim (a claim is built from the answer's own sentences, so its words are theirs), with at least three of
 * them shared. The model never writes a source here, and a claim no support backs still has none and is dropped.
 *
 * A word match alone is not enough for a claim about a company. Found by an adversarial review: a support about a rival
 * ("Beta Capital faced a breach affecting 3 million customers in 2023") backed Acme's own breach claim by its shared
 * words, and a source number the model named was trusted without looking at what it was attached to. So a claim may carry
 * a scope: the support must be about the claim's own subject (and no other company of the deck), the subject's name does
 * not count as a shared word (it matches every sentence about it), at least two shared words must be real words rather
 * than years, and for a one-sentence claim the support must account for most of the claim as well as the other way round.
 * The model's own source number is accepted only if the sentences that source is attached to are about the claim.
 */
import { classifySource, usableCitations, type Citation } from '@mi/contracts';
import type { ProviderGrounding } from './types';

const STOP_WORDS = new Set([
  'about', 'after', 'also', 'among', 'been', 'being', 'between', 'both', 'could', 'during', 'each', 'from', 'have', 'into', 'more',
  'most', 'other', 'over', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
  'under', 'were', 'what', 'when', 'where', 'which', 'while', 'will', 'with', 'would', 'your', 'market', 'markets',
]);

/** What a claim is about, so that a sentence about something else cannot back it. */
export interface ClaimScope {
  /** True when a support's text is about the claim's subject and no other company of the deck. */
  about?: (text: string) => boolean;
  /** Words that name the subject: they match every sentence about it, so they are not evidence of the same claim. */
  ignore?: ReadonlySet<string>;
  /** The claim is one sentence (a risk): the support must account for most of the claim too. */
  oneSentence?: boolean;
  /** The supporting sentence must read like the kind of claim being backed (a risk is backed by a sentence about a dispute, not an award). */
  reads?: RegExp;
}

// Letters and digits of any script count (a claim written in Cyrillic or Greek has words too); accents are removed.
export const wordsOf = (text: string, ignore?: ReadonlySet<string>): Set<string> => new Set(
  text.toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[^\p{L}\p{N}%$.]+/gu, ' ').split(/\s+/)
    .map((word) => word.replace(/^[.$]+|[.]+$/g, ''))
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word) && !ignore?.has(word)),
);

/** Fewest distinctive words a support needs before it can back anything: a short fragment matches by chance. */
const SUPPORT_WORDS_MIN = 5;
const SHARED_WORDS_MIN = 3;
const SHARE_OF_SUPPORT_MIN = 0.6;
/** Of a one-sentence claim, the share its words must have in common with the support. */
const SHARE_OF_CLAIM_MIN = 0.7;
/** A year or a figure is shared by unrelated sentences; real words must carry the match too. */
const REAL_WORDS_MIN = 2;
/** A source the model named must share at least this many real words with a sentence it is attached to. */
const NAMED_REAL_WORDS_MIN = 3;
const isReal = (word: string) => /\p{L}{3}/u.test(word);

/** Stem of an event word, so "fined", "fines" and "fining" are one event and "recall" and "recalled" are one. */
function eventRoot(word: string): string {
  const w = word.toLowerCase().replace(/\p{M}+/gu, '');
  if (/^fin(?:e|es|ed|ing)$/.test(w)) return 'fine';
  if (/^su(?:e|es|ed|ing)$/.test(w) || /^lawsuits?$/.test(w) || /^suits?$/.test(w)) return 'lawsuit';
  return w.slice(0, 5);
}

/**
 * Whether every kind of event a claim states (a fine, a recall, an arrest, a fraud) is stated by the supporting sentence
 * too. A word match alone lets a true sentence about a fine back a claim that also says the chief executive was arrested:
 * the claim's extra event has no support. Only for claims that name events (a risk); other claims are not checked here.
 */
function eventsCovered(claim: string, support: string, reads: RegExp): boolean {
  const events = (text: string) => new Set([...text.matchAll(new RegExp(reads.source, 'giu'))].map((m) => eventRoot(m[0])));
  const wanted = events(claim);
  if (wanted.size === 0) return true;
  const have = events(support);
  return [...wanted].every((root) => have.has(root));
}

/** The sources the search attributed to the answer's sentences that this claim is built from; empty when none fits. */
export function claimSupportCitations(claim: string, grounding: ProviderGrounding | undefined, max = 2, scope?: ClaimScope): Citation[] {
  if (!grounding || grounding.supports.length === 0) return [];
  const claimWords = wordsOf(claim, scope?.ignore);
  if (claimWords.size < SHARED_WORDS_MIN) return [];
  const scored: Array<{ ratio: number; shared: number; citations: Citation[] }> = [];
  for (const support of grounding.supports) {
    if (scope?.about && !scope.about(support.text)) continue;
    if (scope?.reads && !scope.reads.test(support.text)) continue;
    if (scope?.reads && !eventsCovered(claim, support.text, scope.reads)) continue;
    const words = wordsOf(support.text, scope?.ignore);
    if (words.size < SUPPORT_WORDS_MIN) continue;
    const sharedWords = [...words].filter((word) => claimWords.has(word));
    const shared = sharedWords.length;
    const ratio = shared / words.size;
    if (shared < SHARED_WORDS_MIN || ratio < SHARE_OF_SUPPORT_MIN) continue;
    if (scope && sharedWords.filter(isReal).length < REAL_WORDS_MIN) continue;
    if (scope?.oneSentence && shared / claimWords.size < SHARE_OF_CLAIM_MIN) continue;
    scored.push({ ratio, shared, citations: support.sources.map((source) => ({ title: source.title, url: source.url })) });
  }
  scored.sort((a, b) => b.ratio - a.ratio || b.shared - a.shared);
  return usableCitations(scored.slice(0, max).flatMap((entry) => entry.citations));
}

/**
 * Whether a source the structuring step named really stands behind the claim. A source attached to some of the answer's
 * sentences backs the claim only if one of those sentences is about it, shares at least three real words with it, and (for
 * a one-sentence claim, a risk) accounts for most of the claim and states every event the claim states.
 * With no supports at all there is nothing to check against: the model's number stands for a claim that is not an
 * allegation (as it always did), and does not stand for `strict` (a risk), which must be traced to a sentence the search
 * itself attributed. The same for a source the search never attached to any sentence.
 */
export function sourceBacksClaim(url: string, claim: string, grounding: ProviderGrounding | undefined, scope?: ClaimScope, strict = false): boolean {
  if (!grounding || grounding.supports.length === 0) return !strict;
  const holders = grounding.supports.filter((support) => support.sources.some((source) => source.url === url));
  if (holders.length === 0) return !strict;
  const claimWords = wordsOf(claim, scope?.ignore);
  return holders.some((support) => {
    if (scope?.about && !scope.about(support.text)) return false;
    if (scope?.reads && !scope.reads.test(support.text)) return false;
    if (scope?.reads && !eventsCovered(claim, support.text, scope.reads)) return false;
    const shared = [...wordsOf(support.text, scope?.ignore)].filter((word) => claimWords.has(word));
    if (shared.filter(isReal).length < NAMED_REAL_WORDS_MIN) return false;
    return !(scope?.oneSentence && shared.length / Math.max(1, claimWords.size) < SHARE_OF_CLAIM_MIN);
  });
}

/** Resolves all distinct, valid receipts attached to one finding. */
export function resolveClaimCitations(
  sourceIndex: number | null | undefined,
  sourceIndexes: readonly number[] | null | undefined,
  citations: readonly Citation[],
): Citation[] {
  const indices = Array.from(new Set([
    ...(sourceIndex == null ? [] : [sourceIndex]),
    ...(sourceIndexes ?? []),
  ]));
  return usableCitations(indices.flatMap((index) => resolveClaimCitation(index, citations)));
}

/**
 * Resolves and validates citations attached to a claim index.
 */
export function resolveClaimCitation(
  sourceIndex: number | null | undefined,
  citations: readonly Citation[],
): Citation[] {
  if (sourceIndex == null || sourceIndex < 0 || sourceIndex >= citations.length) {
    return [];
  }
  const cite = citations[sourceIndex];
  if (!cite || !cite.url || !/^https?:\/\//i.test(cite.url.trim())) {
    return [];
  }
  return [
    {
      title: cite.title || 'Source',
      url: cite.url.trim(),
      credibility: cite.credibility ?? classifySource(cite.url, cite.title),
    },
  ];
}
