/**
 * Structured dashboard content must be stated by the research it came from.
 *
 * The structuring call is not grounded, so it can pad a funding history or an
 * investor list from memory. Every amount, date and name it returns is checked
 * against the grounded notes it was given: what the notes do not say is
 * removed (an amount or date becomes "not reported", a name is dropped), and a
 * round survives only if the notes mention its name or its amount. Nothing is
 * added or corrected here: this can only withhold.
 */
import type { HistoryContent, MissionGovernanceContent } from '@mi/contracts';
import { amountMatches, sameAmount } from './amounts';

const GENERIC = /^(?:capital|ventures?|partners?|fund|funds|group|holdings?|investments?|management|asset|global|the|and|of|inc|llc|ltd|corp|corporation|company|technologies|technology|labs?|ai)$/i;
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = (text: string, word: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, 'iu').test(text);

/** The distinctive words of a name; generic suffixes ("Capital", "Partners") do not identify anyone. */
function distinctiveWords(name: string): string[] {
  return name.normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3 && !GENERIC.test(word));
}

/** An organisation is named when any distinctive word of it is; a person only when every word is. */
function named(notes: string, name: string, kind: 'organisation' | 'person'): boolean {
  const words = distinctiveWords(name);
  if (words.length === 0) return false;
  return kind === 'person' ? words.every((word) => wholeWord(notes, word)) : words.some((word) => wholeWord(notes, word));
}

export function groundGovernanceInNotes(content: MissionGovernanceContent, notes: string): MissionGovernanceContent {
  const amounts = amountMatches(notes);
  const amountStated = (value: number) => amounts.some((m) => sameAmount(m.value, value));
  const seen = new Set<string>();
  const fundingRounds = (content.fundingRounds ?? []).flatMap((round) => {
    const label = round.round.trim();
    const roundNamed = label.length > 0 && wholeWord(notes, label);
    const amountOk = round.amountUsd != null && Number.isFinite(round.amountUsd) && round.amountUsd > 0 && amountStated(round.amountUsd);
    if (!roundNamed && !amountOk) return [];
    const year = /\b((?:19|20)\d{2})\b/.exec(round.date ?? '')?.[1];
    const dateOk = !round.date?.trim() || (year !== undefined && notes.includes(year));
    const key = `${round.round.trim().toLowerCase()}|${round.date?.trim() ?? ''}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      ...round,
      amountUsd: amountOk ? round.amountUsd : null,
      date: dateOk ? round.date : null,
      leadInvestors: (round.leadInvestors ?? []).filter((lead) => named(notes, lead, 'organisation')),
    }];
  });
  return {
    ...content,
    fundingRounds,
    investors: (content.investors ?? []).filter((investor) => named(notes, investor.name, 'organisation')),
    board: (content.board ?? []).filter((member) => named(notes, member.name, 'person')),
  };
}

/** Letters and digits only, lower-cased: quotes survive whitespace, smart quotes and dashes. */
const flatten = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A quotation is verbatim or it is not shown; "..." joins fragments, each of which must be in the notes. */
function quotedInNotes(quote: string, flatNotes: string): boolean {
  const parts = quote.split(/…|\.{3}/).map(flatten).filter((part) => part.length > 0);
  return parts.length > 0 && parts.every((part) => flatNotes.includes(part));
}

/** Half of a title's distinctive words (four letters or more) must appear in the notes. */
function titleInNotes(title: string, flatNotes: string): boolean {
  const words = flatten(title).split(' ').filter((word) => word.length >= 4 && !GENERIC.test(word));
  if (words.length === 0) return true;
  return words.filter((word) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}`, 'u').test(flatNotes)).length >= Math.ceil(words.length / 2);
}

/**
 * History: a milestone needs its year and the substance of its title in the
 * notes, and a quotation must be verbatim from them. Withholds only.
 */
export function groundHistoryInNotes(content: HistoryContent, notes: string): HistoryContent {
  const flatNotes = flatten(notes);
  return {
    ...content,
    timeline: (content.timeline ?? []).filter((event) => {
      const year = /\b((?:19|20)\d{2})\b/.exec(event.date ?? '')?.[1];
      return year !== undefined && notes.includes(year) && titleInNotes(event.title, flatNotes);
    }),
    quotes: (content.quotes ?? []).filter((quote) => quotedInNotes(quote.text, flatNotes)),
  };
}