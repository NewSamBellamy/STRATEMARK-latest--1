/**
 * Saving new research back: turn a fresh grounded answer into evidence worth keeping.
 *
 * Only a sentence the search itself attributed to a public source (the provider's
 * `grounding.supports`) is kept. The model's own opinions, questions and hedges are
 * never saved, and neither is any sentence without an attributed source. A sentence
 * is kept for a company only when it names exactly that one company of the roster:
 * a comparison naming two is kept for neither (it would lend one company's facts to
 * the other), and a sentence about no company is dropped (an evidence record with
 * no company cannot be read back by anyone).
 */
import { usableCitations, type Citation } from '@mi/contracts';
import { companyAliases, mentionsCompany } from './company-aliases';
import { SENTENCE_END } from './support-sentences';
import type { ResearchEvidence } from './research-evidence';
import type { ProviderGrounding } from './types';

/** Share of a sentence the attributed clauses must cover for the sentence to count as attributed. */
const COVERAGE = 0.6;
/** Too short to prove which sentence a clause belongs to. */
const MIN_CLAUSE = 12;

/** The model speaking for itself, or unsure: advice, opinion, hedges. Never research. */
const OPINION = /\b(?:i|we)\s+(?:think|believe|recommend|suggest|feel|would|'d|'ll|guess)\b|\bi['’](?:d|ll|m|ve)\b|\bin my (?:view|opinion)\b|\byou (?:should|might|could|may|can)\b|\b(?:it\s+)?(?:seems|appears)\b|\bseemingly\b|\b(?:may|might|could|perhaps|possibly|probably|likely|unlikely|arguably|presumably|should|would)\b|\bsuggests? that\b|\bbest (?:option|choice|bet)\b/i;

export interface AttributedSentence {
  text: string;
  /** Public sources the search attributed to this sentence. */
  sources: Citation[];
}

function sentencesOf(answer: string): string[] {
  return answer.split(SENTENCE_END).map((s) => s.trim()).filter(Boolean);
}

/** True for text the model may only be guessing at or advising on. */
export function isOpinionOrHedge(sentence: string): boolean {
  return sentence.endsWith('?') || OPINION.test(sentence);
}

/**
 * The sentences of an answer the search itself attributed to at least one public
 * source, with those sources. An attributed clause that sits inside a longer
 * sentence only counts when it covers most of that sentence.
 */
export function attributedSentences(grounding: ProviderGrounding | undefined): AttributedSentence[] {
  if (!grounding || !Array.isArray(grounding.supports)) return [];
  const supports = grounding.supports
    .map((support) => ({
      text: typeof support.text === 'string' ? support.text.trim() : '',
      sources: usableCitations((support.sources ?? []).map((s) => ({ url: s.url, title: s.title }))),
    }))
    .filter((support) => support.text.length >= MIN_CLAUSE && support.sources.length > 0);
  if (!supports.length) return [];
  const out: AttributedSentence[] = [];
  for (const sentence of sentencesOf(grounding.answerText ?? '')) {
    if (isOpinionOrHedge(sentence)) continue;
    // A support is about this sentence when one holds the other (a clause inside it, or a span containing it).
    const covering = supports.filter((s) => sentence.includes(s.text) || s.text.includes(sentence));
    if (!covering.length) continue;
    const covered = covering.some((s) => s.text.includes(sentence))
      ? sentence.length
      : covering.reduce((sum, s) => sum + s.text.length, 0);
    if (covered < sentence.length * COVERAGE) continue;
    const sources = usableCitations(covering.flatMap((s) => s.sources));
    if (sources.length) out.push({ text: sentence, sources });
  }
  return out;
}

export interface WritebackCompany {
  id: string;
  name: string;
  websiteUrl?: string | null;
}

/** The roster companies a sentence names. A name inside a longer company's name ("Acme" in "Acme Labs") is not counted. */
export function companiesNamed(sentence: string, roster: readonly WritebackCompany[]): WritebackCompany[] {
  const hits = roster.flatMap((company) => {
    const alias = companyAliases(company.name, company.websiteUrl).find((a) => mentionsCompany(sentence, [a]));
    return alias ? [{ company, alias }] : [];
  });
  return hits.filter(({ company, alias }) => !hits.some((other) =>
    other.company.id !== company.id && other.alias.length > alias.length && ` ${other.alias} `.includes(` ${alias} `)))
    .map(({ company }) => company);
}

export interface ChatEvidenceInput {
  threadId: string;
  answerText: string;
  grounding: ProviderGrounding | undefined;
  companies: readonly WritebackCompany[];
  /** The card a company's evidence belongs to, when there is one. */
  cardIdFor?: (companyId: string) => string | undefined;
  /** The searches the answer ran, kept on each record. */
  queries?: readonly string[];
  now?: Date;
}

/**
 * Evidence records to keep from a fresh grounded chat answer: one per kept
 * sentence, for the one company it is about, topic `chat:<threadId>`.
 */
export function chatEvidenceFromAnswer(input: ChatEvidenceInput): ResearchEvidence[] {
  // The answer text the search attributed against is the authority; a caller's text that differs is not.
  const grounding = input.grounding && input.grounding.answerText === input.answerText ? input.grounding : undefined;
  const capturedAt = (input.now ?? new Date()).toISOString();
  return attributedSentences(grounding).flatMap((sentence) => {
    const named = companiesNamed(sentence.text, input.companies);
    if (named.length !== 1) return [];
    const company = named[0]!;
    const cardId = input.cardIdFor?.(company.id);
    return [{
      id: `ev_${globalThis.crypto.randomUUID()}`,
      companyId: company.id,
      companyName: company.name,
      topic: `chat:${input.threadId}`,
      capturedAt,
      text: sentence.text,
      citations: sentence.sources.map((c) => ({ ...c })),
      queries: [...(input.queries ?? [])],
      ...(cardId ? { cardId } : {}),
    }];
  });
}
