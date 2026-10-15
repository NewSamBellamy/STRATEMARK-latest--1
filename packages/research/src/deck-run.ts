/**
 * One deck's measured run: when it was asked for, when the first card and the
 * finished deck appeared, when the background warm-up ended, and what the
 * provider calls in between added up to. "Fast and affordable" is only a goal
 * until this exists; then it is a number per deck.
 *
 * Usage is the difference of the client's rolling counters between the
 * deck's submission and each milestone, so it also counts anything else that
 * client did meanwhile. Decks are built one at a time, which makes that the
 * deck's own spend; two decks running at once would each see the other's calls.
 */
import type { CallMetricsAggregate } from './types';

export interface RunUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  searchQueries: number;
  /** Estimated USD at deliberately high list prices (call-cost.ts). */
  estCostUsd: number;
}

export type DeckRunMilestone = 'leadCardAt' | 'deckReadyAt' | 'warmupDoneAt';

export interface DeckRun {
  /** When the brief was submitted. */
  submittedAt: string;
  /** The first company card was fully researched and the user was released to it. */
  leadCardAt?: string;
  /** Discovery and card research finished (the "Deck research completed" moment). */
  deckReadyAt?: string;
  /** Every dashboard tab of the deck was warmed (or had nothing left to try). */
  warmupDoneAt?: string;
  /** Usage up to `deckReadyAt`. */
  usageAtDeckReady?: RunUsage;
  /** Usage up to the latest milestone. */
  usage?: RunUsage;
}

/** Counters now minus counters at submission; undefined when the client keeps no counters (mocks). */
export function usageSince(now: CallMetricsAggregate | undefined, base: CallMetricsAggregate | undefined): RunUsage | undefined {
  if (!now || !base) return undefined;
  const d = (a: number | undefined, b: number | undefined): number => Math.max(0, (a ?? 0) - (b ?? 0));
  return {
    calls: d(now.calls, base.calls),
    inputTokens: d(now.inputTokens, base.inputTokens),
    outputTokens: d(now.outputTokens, base.outputTokens),
    searchQueries: d(now.searchQueries, base.searchQueries),
    estCostUsd: d(now.estCostUsd, base.estCostUsd),
  };
}

/** Record a milestone once: the first time wins, so a resumed warm-up never rewrites history. */
export function applyMilestone(run: DeckRun, milestone: DeckRunMilestone, at: string, usage?: RunUsage): DeckRun {
  if (run[milestone]) return run;
  return {
    ...run,
    [milestone]: at,
    ...(usage ? { usage, ...(milestone === 'deckReadyAt' ? { usageAtDeckReady: usage } : {}) } : {}),
  };
}

const seconds = (from: string, to: string | undefined): number | null => {
  if (!to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null;
};

export interface DeckRunTimes {
  toFirstCardSec: number | null;
  toDeckSec: number | null;
  toWarmupSec: number | null;
}

export function deckRunTimes(run: DeckRun): DeckRunTimes {
  return {
    toFirstCardSec: seconds(run.submittedAt, run.leadCardAt),
    toDeckSec: seconds(run.submittedAt, run.deckReadyAt),
    toWarmupSec: seconds(run.submittedAt, run.warmupDoneAt),
  };
}

const mmss = (sec: number | null): string => (sec == null ? 'n/a' : sec < 90 ? `${sec}s` : `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, '0')}s`);

/** One readable line: "first card 41s · deck 3m10s · warm-up 24m12s · 212 calls · 1.9M in / 0.4M out tokens · 96 searches · est $2.31". */
export function formatDeckRun(run: DeckRun): string {
  const t = deckRunTimes(run);
  const u = run.usage;
  const tok = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  const cost = u
    ? ` · ${u.calls} calls · ${tok(u.inputTokens)} in / ${tok(u.outputTokens)} out tokens · ${u.searchQueries} searches · est $${u.estCostUsd.toFixed(2)}`
    : ' · usage not measured';
  return `first card ${mmss(t.toFirstCardSec)} · deck ${mmss(t.toDeckSec)} · warm-up ${mmss(t.toWarmupSec)}${cost}`;
}
