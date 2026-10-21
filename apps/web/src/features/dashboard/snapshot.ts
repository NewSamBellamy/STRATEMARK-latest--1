/**
 * Pure derivations behind the Overview's "leadership, funding and signals"
 * strip. Everything here reads what the Team, Governance and Live Intel tabs
 * already retained: nothing is summed, ranked by guesswork or filled in.
 */
import type { CompanyMetric, HistoryContent, LiveIntelItem, MetricType, MissionGovernanceContent, OrgNode } from '@mi/contracts';
import { shownKnown, type PeerEntry } from './dashboardModel';
import { figureCurrency } from './figureCurrency';
import { figureDisplay } from './figureSet';
import { rankRole, sortByRank } from './tabs/orgRank';

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

/**
 * The people a reader would name first: founders and the CEO, then the other
 * chiefs, ordered by rankRole (the same order as the Team tab's leadership
 * strip). Founders count whatever function they were filed under: a co-founder
 * tagged "AI & research" is still leadership.
 */
export function leadershipSnapshot(nodes: readonly OrgNode[], max = 4): OrgNode[] {
  const lead = nodes.filter((node) => node.group === 'exec' || rankRole(node) <= 1);
  const pool = lead.length > 0 ? lead : nodes.filter((node) => node.parentId === null);
  return sortByRank(pool).slice(0, max);
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

export interface PeerCell {
  value: number;
  confidence: CompanyMetric['confidence'];
  /** The figure as reported: compact, in its own currency, never converted. */
  display: string;
  /** Currency code when the figure was reported in something other than US dollars (shown, but not ranked). */
  currency: string | null;
  /** The stored number is a USD conversion the research states it made (the rate date is not recorded). */
  converted: boolean;
}
export interface PeerRow { companyId: string; name: string; logoUrl?: string | null; websiteUrl?: string | null; isSelf: boolean; cells: Array<PeerCell | null> }

/**
 * The deck laid side by side on a few headline figures. Only known, same-basis
 * figures appear (an unknown is a dash, never a zero); a figure reported in
 * another currency is shown as reported but left out of the ordering. Biggest first on the
 * first column that has a value. Null when fewer than two companies have
 * anything to compare.
 */
export function peerTable(selfId: string, entries: readonly PeerEntry[], types: readonly MetricType[]): PeerRow[] | null {
  const rows = entries.map((entry): PeerRow => ({
    companyId: entry.companyId, name: entry.name, logoUrl: entry.logoUrl, websiteUrl: entry.websiteUrl, isSelf: entry.companyId === selfId,
    cells: types.map((type) => {
      const metric = shownKnown(entry, type);
      if (!metric) return null;
      const currency = figureCurrency(metric);
      // A figure in another currency (or one stated as converted) is shown as reported, but takes no place in the ordering.
      return { value: metric.value as number, confidence: metric.confidence, display: figureDisplay(metric), currency: currency?.code ?? null, converted: currency?.converted ?? false };
    }),
  }));
  if (rows.filter((row) => row.cells.some(Boolean)).length < 2) return null;
  // Comparable dollar figures by size, then a figure shown in another currency (placed by no number), then nothing.
  const ranked = (cell: PeerCell | null | undefined) => (!cell ? -1 : cell.currency ? 0 : cell.value);
  const lead = types.findIndex((_, i) => rows.some((row) => row.cells[i] && !row.cells[i]!.currency));
  return rows.sort((a, b) => ranked(b.cells[lead]) - ranked(a.cells[lead]) || a.name.localeCompare(b.name));
}

const FOUNDING = /\b(?:founded|co-?founded|incorporated|established|launched (?:as|the company)|was (?:started|formed|created)|started operations)\b/i;

/**
 * The year the history says the company began: the earliest dated milestone
 * whose own words describe a founding. Null when none does (a first product
 * launch is not a founding), so the header shows nothing rather than a guess.
 */
export function foundedYear(timeline: HistoryContent['timeline'] | undefined): number | null {
  const years = (timeline ?? [])
    .filter((event) => FOUNDING.test(`${event.title} ${event.detail ?? ''}`))
    .map((event) => reportedDateMs(event.date))
    .filter((ms): ms is number => ms !== null)
    .map((ms) => new Date(ms).getUTCFullYear());
  return years.length > 0 ? Math.min(...years) : null;
}

/**
 * Whether the research shows this company reports to the SEC: a figure backed
 * by a filing, or a market cap (which needs a listing). Never inferred from
 * the name or from being large.
 */
export function reportsToSec(metrics: readonly CompanyMetric[]): boolean {
  return metrics.some((metric) => metric.value !== null && (
    metric.passageSupport?.format?.startsWith('sec-') === true ||
    (metric.metricType === 'market_cap' && metric.confidence !== 'unknown')));
}

/** EDGAR's own company search: filings, ownership forms and statements, from the source. */
export function secFilingsUrl(companyName: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(companyName)}&type=&dateb=&owner=include&count=40`;
}
