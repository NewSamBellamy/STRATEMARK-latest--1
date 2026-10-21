/**
 * ONE funding structure for the Mission & governance and History tabs.
 *
 * Funding rounds live in two research outputs: governance `fundingRounds` and
 * funding events on the history timeline. This merges them so both tabs show
 * the same rounds. It only combines what was reported: an amount, investor
 * list or source link comes from a row that states it, never from a guess.
 */
import { statedLeadInvestors, statedRoundAmounts } from '@mi/contracts';
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

const ROUND_LABEL_ALL = new RegExp(ROUND_LABEL.source, 'gi');
const EXTENSION = /\b(extension|extended|follow-?on|second close|bridge)\b/i;

/**
 * The round's name as the event words it ("Series B"), else the event title
 * itself. A title naming two rounds, or an extension of one, keeps its whole
 * wording so it is not mistaken for (and merged with) the plain round.
 */
const roundLabelOf = (title: string) => {
  const labels = new Set([...title.matchAll(ROUND_LABEL_ALL)].map((m) => m[1]!.toLowerCase()));
  if (labels.size === 0 || labels.size > 1 || EXTENSION.test(title)) return title.trim();
  return ROUND_LABEL.exec(title)![1]!;
};

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
const sameYear = (a: string | null | undefined, b: string | null | undefined) => {
  const ya = parseEventYear(a ?? '');
  const yb = parseEventYear(b ?? '');
  return ya === null || yb === null || ya === yb;
};

/** The round a history event describes, when a round names it ("Series B" inside the title, same year). */
export function roundForEvent(rounds: readonly FundingRound[], event: Pick<TimelineEvent, 'title' | 'date'>): FundingRound | undefined {
  const title = norm(event.title);
  // The longest matching name wins: "Series A extension / Series B" is its own round, not "Series B".
  let best: FundingRound | undefined;
  for (const r of rounds) {
    const label = norm(r.round);
    // Whole-word: "seed" must not match inside "pre-seed", "series b" not inside "series bb".
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const inTitle = new RegExp(`(^|[^a-z0-9-])${escaped}($|[^a-z0-9+])`).test(title);
    if (label.length > 0 && inTitle && sameYear(r.date, event.date) && (!best || label.length > norm(best.round).length)) best = r;
  }
  return best;
}

/** What a funding event's own title and description state about its round (see @mi/contracts funding-text). */
export function statedByEvent(event: Pick<TimelineEvent, 'title' | 'detail'>) {
  const text = `${event.title}. ${event.detail ?? ''}`;
  const amounts = statedRoundAmounts(text);
  const single = amounts.length === 1 ? amounts[0]! : null;
  return {
    amountUsd: single?.currency === 'USD' ? single.value : null,
    /** A single round size in a currency other than USD, as written; never converted. */
    amountNote: single && single.currency !== 'USD' ? single.display : undefined,
    /** The description gives a round size, even when it cannot be put in one field (two competing amounts). */
    statesAmount: amounts.length > 0,
    leads: statedLeadInvestors(text),
  };
}

/** One row per (round, date): a round listed twice keeps its first row and gains only what the other states. */
function mergeSameRound(rounds: FundingRound[]): FundingRound[] {
  const out: FundingRound[] = [];
  for (const r of rounds) {
    const key = `${norm(r.round)}|${norm(r.date ?? '')}`;
    const same = r.round.trim() ? out.find((o) => `${norm(o.round)}|${norm(o.date ?? '')}` === key) : undefined;
    if (!same) { out.push(r); continue; }
    if (same.amountUsd == null && r.amountUsd != null) same.amountUsd = r.amountUsd;
    if (same.amountUsd == null && !same.amountNote && r.amountNote) same.amountNote = r.amountNote;
    if ((same.leadInvestors ?? []).length === 0 && (r.leadInvestors ?? []).length > 0) same.leadInvestors = [...r.leadInvestors];
    if (!same.sourceUrl && r.sourceUrl) same.sourceUrl = r.sourceUrl;
  }
  return out;
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
  const rounds: FundingRound[] = mergeSameRound((governance ?? []).map((r) => ({ ...r })));
  for (const event of timeline ?? []) {
    if (!isFundingRoundEvent(event)) continue;
    const match = roundForEvent(rounds, event);
    // The event's own stated fields first, else what its description says (one amount, a "led by" list).
    const stated = statedByEvent(event);
    const amountUsd = event.amountUsd ?? stated.amountUsd;
    const investors = (event.investors ?? []).length > 0 ? event.investors! : stated.leads;
    if (match) {
      if (match.amountUsd == null && amountUsd != null) match.amountUsd = amountUsd;
      if (match.amountUsd == null && !match.amountNote && stated.amountNote) match.amountNote = stated.amountNote;
      if ((match.leadInvestors ?? []).length === 0 && investors.length > 0) match.leadInvestors = [...investors];
      if (!match.date && event.date) match.date = event.date;
      if (!match.sourceUrl && event.sourceUrl) match.sourceUrl = event.sourceUrl;
      continue;
    }
    rounds.push({
      round: roundLabelOf(event.title),
      amountUsd: amountUsd ?? null,
      date: event.date || null,
      leadInvestors: [...investors],
      ...(amountUsd == null && stated.amountNote ? { amountNote: stated.amountNote } : {}),
      ...(event.sourceUrl ? { sourceUrl: event.sourceUrl } : {}),
    });
  }
  return mergeSameRound(rounds);
}
