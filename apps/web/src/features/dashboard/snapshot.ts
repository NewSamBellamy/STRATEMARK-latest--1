/**
 * Pure derivations behind the Overview's "leadership, funding and signals"
 * strip. Everything here reads what the Team, Governance and Live Intel tabs
 * already retained: nothing is summed, ranked by guesswork or filled in.
 */
import type { LiveIntelItem, MissionGovernanceContent, OrgNode } from '@mi/contracts';

type Round = NonNullable<MissionGovernanceContent['fundingRounds']>[number];
type Investor = NonNullable<MissionGovernanceContent['investors']>[number];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthIndex = (word: string) => MONTHS.indexOf(word.slice(0, 3).toLowerCase());

/**
 * A reported date as sources write it ("2026 Mar", "March 2026", "2026-03",
 * "Q3 2025", "2024 H2", "2023") to a sortable time, or null when it names no
 * year. Only for ordering: the date shown is always the reported text.
 */
export function reportedDateMs(text: string | null | undefined): number | null {
  const raw = text?.trim();
  if (!raw) return null;
  const at = (year: number, month = 0, day = 1) => Date.UTC(year, month, day);
  const iso = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(raw);
  if (iso) return at(Number(iso[1]), iso[2] ? Number(iso[2]) - 1 : 0, iso[3] ? Number(iso[3]) : 1);
  const span = /\b(?:(Q[1-4]|H[12])\s*(\d{4})|(\d{4})\s*(Q[1-4]|H[12]))\b/i.exec(raw);
  if (span) {
    const label = (span[1] ?? span[4])!.toUpperCase();
    const year = Number(span[2] ?? span[3]);
    return at(year, label.startsWith('Q') ? (Number(label[1]) - 1) * 3 : (Number(label[1]) - 1) * 6);
  }
  const named = /\b([A-Za-z]{3,9})\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})\b/.exec(raw) ?? /\b(\d{4})\s+([A-Za-z]{3,9})\b/.exec(raw);
  if (named) {
    const [word, year, day] = /^\d{4}$/.test(named[1]!) ? [named[2]!, named[1]!, undefined] : [named[1]!, named[3]!, named[2]];
    const month = monthIndex(word);
    if (month >= 0) return at(Number(year), month, day ? Number(day) : 1);
  }
  const year = /\b((?:19|20)\d{2})\b/.exec(raw);
  return year ? at(Number(year[1])) : null;
}

/** A reported amount in compact dollars ("$1.5B"). */
export function formatUsdCompact(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${Math.round(value).toLocaleString()}`;
}

/** Newest first; a round with no readable date keeps its place after the dated ones. */
export function roundsNewestFirst(rounds: readonly Round[]): Round[] {
  return rounds
    .map((round, index) => ({ round, index, t: reportedDateMs(round.date) }))
    .sort((a, b) => (a.t === null ? 1 : 0) - (b.t === null ? 1 : 0) || (b.t ?? 0) - (a.t ?? 0) || a.index - b.index)
    .map((row) => row.round);
}

export interface FundingSnapshot {
  latest: Round;
  roundCount: number;
  /** Investors that led a reported round, most frequent first (at most 4). */
  leads: string[];
}

export function fundingSnapshot(rounds: readonly Round[], investors: readonly Investor[]): FundingSnapshot | null {
  const [latest] = roundsNewestFirst(rounds);
  if (!latest) return null;
  const counts = new Map<string, number>();
  for (const round of rounds) for (const name of round.leadInvestors ?? []) counts.set(name, (counts.get(name) ?? 0) + 1);
  // No round names a lead: fall back to the investors the research listed.
  const leads = counts.size > 0
    ? [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name)
    : investors.map((investor) => investor.name);
  return { latest, roundCount: rounds.length, leads: leads.slice(0, 4) };
}

const ROLE_RANK: Array<[RegExp, number]> = [
  [/\b(?:ceo|chief executive)\b/i, 0],
  [/\b(?:co-?founder|founder)\b/i, 1],
  [/\bpresident\b/i, 2],
  [/\b(?:cto|chief technology|chief scientist|chief research)\b/i, 3],
  [/\b(?:cfo|coo|cpo|cmo|chief)\b/i, 4],
];
const roleRank = (role: string) => ROLE_RANK.find(([pattern]) => pattern.test(role))?.[1] ?? 9;

/** The people a reader would name first: the top of the reported org, by role. */
export function leadershipSnapshot(nodes: readonly OrgNode[], max = 4): OrgNode[] {
  const execs = nodes.filter((node) => node.group === 'exec');
  const pool = execs.length > 0 ? execs : nodes.filter((node) => node.parentId === null);
  return pool
    .map((node, index) => ({ node, index }))
    .sort((a, b) => roleRank(a.node.role) - roleRank(b.node.role) || a.index - b.index)
    .slice(0, max)
    .map((row) => row.node);
}

export interface NewsMood { positive: number; neutral: number; negative: number; total: number }

/** Tone of the current coverage, counted from the stories' own sentiment. */
export function newsMood(items: readonly Pick<LiveIntelItem, 'sentiment' | 'stale'>[]): NewsMood {
  const mood: NewsMood = { positive: 0, neutral: 0, negative: 0, total: 0 };
  for (const item of items) {
    if (item.stale) continue;
    mood[item.sentiment] += 1;
    mood.total += 1;
  }
  return mood;
}
