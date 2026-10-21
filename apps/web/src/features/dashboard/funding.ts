/**
 * ONE funding structure for the Mission & governance and History tabs.
 *
 * Funding rounds live in two research outputs: governance `fundingRounds` and
 * funding events on the history timeline. This merges them so both tabs show
 * the same rounds. It only combines what was reported: an amount, investor
 * list or source link comes from a row that states it, never from a guess.
 */
import type { HistoryContent, MissionGovernanceContent } from '@mi/contracts';
import { classifyEvent, parseEventYear } from './tabs/tabHelpers';

export type FundingRound = NonNullable<MissionGovernanceContent['fundingRounds']>[number];
type TimelineEvent = NonNullable<HistoryContent['timeline']>[number];

const ROUND_WORDS = /\b(pre-?seed|seed|series [a-z]\+?|funding round|round|raises|raised|tender offer)\b/i;
const ROUND_LABEL = /\b(pre-?seed|seed|series [a-z]\+?)\b/i;

/** A timeline event that reports a funding round (a reading aid: ambiguous events are not rounds). */
export function isFundingRoundEvent(event: Pick<TimelineEvent, 'title' | 'detail'>): boolean {
  return classifyEvent(event.title, event.detail) === 'funding' && ROUND_WORDS.test(event.title);
}

/** The round's name as the event words it ("Series B"), else the event title itself. */
const roundLabelOf = (title: string) => ROUND_LABEL.exec(title)?.[1] ?? title;

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
const sameYear = (a: string | null | undefined, b: string | null | undefined) => {
  const ya = parseEventYear(a ?? '');
  const yb = parseEventYear(b ?? '');
  return ya === null || yb === null || ya === yb;
};

/** The round a history event describes, when a round names it ("Series B" inside the title, same year). */
export function roundForEvent(rounds: readonly FundingRound[], event: Pick<TimelineEvent, 'title' | 'date'>): FundingRound | undefined {
  const title = norm(event.title);
  return rounds.find((r) => {
    const label = norm(r.round);
    // Whole-word: "seed" must not match inside "pre-seed", "series b" not inside "series bb".
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const inTitle = new RegExp(`(^|[^a-z0-9-])${escaped}($|[^a-z0-9+])`).test(title);
    return label.length > 0 && inTitle && sameYear(r.date, event.date);
  });
}

/**
 * Governance rounds plus the funding events of the timeline, one row per
 * round. A matched round keeps its own fields and gains only what the event
 * states and the round lacks; an unmatched funding event becomes a round whose
 * amount is null unless the event states it.
 */
export function unifyFunding(
  governance: readonly FundingRound[] | undefined,
  timeline: readonly TimelineEvent[] | undefined,
): FundingRound[] {
  const rounds: FundingRound[] = (governance ?? []).map((r) => ({ ...r }));
  for (const event of timeline ?? []) {
    if (!isFundingRoundEvent(event)) continue;
    const match = roundForEvent(rounds, event);
    const investors = event.investors ?? [];
    if (match) {
      if (match.amountUsd == null && event.amountUsd != null) match.amountUsd = event.amountUsd;
      if ((match.leadInvestors ?? []).length === 0 && investors.length > 0) match.leadInvestors = [...investors];
      if (!match.date && event.date) match.date = event.date;
      if (!match.sourceUrl && event.sourceUrl) match.sourceUrl = event.sourceUrl;
      continue;
    }
    rounds.push({
      round: roundLabelOf(event.title),
      amountUsd: event.amountUsd ?? null,
      date: event.date || null,
      leadInvestors: [...investors],
      ...(event.sourceUrl ? { sourceUrl: event.sourceUrl } : {}),
    });
  }
  return rounds;
}
