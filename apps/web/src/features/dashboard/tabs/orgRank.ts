/**
 * Who comes first on a team page, and which column of the board a person
 * belongs in. Pure functions only (no React) so the leadership strip, the
 * Overview leadership card and the board all order people the same way.
 *
 * Nothing here invents a fact: ranks are read from the person's own reported
 * title (and `isFounder` when a source said so); a title that matches nothing
 * is simply rank 6.
 */
import type { OrgNode } from '@mi/contracts';
import { safeHttpUrl } from '@/lib/sourceHref';

export type OrgGroup = OrgNode['group'];

export const GROUP_LABEL: Record<OrgGroup, string> = {
  exec: 'Executive',
  ai: 'AI & research',
  product: 'Product',
  design: 'Design',
  other: 'Board & other',
};

/**
 * One hue per function, at a shade that carries white label text at AA
 * contrast. Same hues as the filter dots (indigo, cyan, emerald, pink, slate).
 */
export const GROUP_COLOR: Record<OrgGroup, string> = {
  exec: '#4f46e5',
  ai: '#0e7490',
  product: '#047857',
  design: '#be185d',
  other: '#475569',
};

const GROUP_ORDER: OrgGroup[] = ['exec', 'ai', 'product', 'design', 'other'];

/** "Chief of Staff to the CEO" is not a CEO: drop the reporting-line phrase before reading the title. */
const REPORTS_TO_CEO = /\b(?:to|for|of)\s+(?:the\s+)?(?:ceo|chief executive(?: officer)?)\b/gi;

const FOUNDER = /\b(?:co-?founder|founder)\b/i;
const CEO = /\bceo\b|\bchief executive\b/i;
const SENIOR_VP = /\b(?:evp|svp)\b|\b(?:executive|senior) vice[ -]president\b/i;
const VP = /\bvp\b|\bvice[ -]president\b/i;
// "President" on its own (not "Vice President").
const PRESIDENT = /(?<!vice[ -])\bpresident\b/i;
const CHIEF = /\bchief\b|\bc[a-z]o\b|\bgeneral counsel\b/i;
const HEAD = /\bhead of\b|\bdirector\b|\blead\b/i;

/**
 * Seniority from the reported role: 0 founder, 1 CEO, 2 other chief or
 * president, 3 EVP/SVP, 4 VP, 5 head of / director / lead, 6 everything else.
 * The smallest matching rank wins ("Co-founder & Chief Scientist" is 0).
 */
export function rankRole(person: Pick<OrgNode, 'role' | 'isFounder'>): number {
  if (person.isFounder) return 0;
  const role = (person.role ?? '').replace(REPORTS_TO_CEO, ' ');
  if (FOUNDER.test(role)) return 0;
  if (CEO.test(role)) return 1;
  if (CHIEF.test(role) || PRESIDENT.test(role)) return 2;
  if (SENIOR_VP.test(role)) return 3;
  if (VP.test(role)) return 4;
  if (HEAD.test(role)) return 5;
  return 6;
}

const isCeoTitle = (person: Pick<OrgNode, 'role'>) => CEO.test((person.role ?? '').replace(REPORTS_TO_CEO, ' '));

/**
 * Role rank, then (among founders) the one who holds the CEO title, then
 * function, then name. Stable and total, so two renders never disagree.
 */
export function compareOrg(a: OrgNode, b: OrgNode): number {
  return (
    rankRole(a) - rankRole(b) ||
    Number(isCeoTitle(b)) - Number(isCeoTitle(a)) ||
    GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
    a.name.localeCompare(b.name)
  );
}

export function sortByRank(nodes: readonly OrgNode[]): OrgNode[] {
  return [...nodes].sort(compareOrg);
}

export type ColumnKey = 'founders' | 'exec' | 'ai' | 'product_design' | 'other';

export interface OrgColumn {
  key: ColumnKey;
  label: string;
  people: OrgNode[];
}

export const COLUMN_LABEL: Record<ColumnKey, string> = {
  founders: 'Founders & CEO',
  exec: 'Executive',
  ai: 'AI & research',
  product_design: 'Product & design',
  other: 'Other',
};

/** Column header dots: the function hue, with founders in their own amber. */
export const COLUMN_COLOR: Record<ColumnKey, string> = {
  founders: '#b45309',
  exec: GROUP_COLOR.exec,
  ai: GROUP_COLOR.ai,
  product_design: GROUP_COLOR.product,
  other: GROUP_COLOR.other,
};

const COLUMN_ORDER: ColumnKey[] = ['founders', 'exec', 'ai', 'product_design', 'other'];

export function columnOf(person: OrgNode): ColumnKey {
  if (rankRole(person) <= 1) return 'founders';
  switch (person.group) {
    case 'exec':
      return 'exec';
    case 'ai':
      return 'ai';
    case 'product':
    case 'design':
      return 'product_design';
    default:
      return 'other';
  }
}

/** The board's people columns in their fixed order, each sorted by rank. Empty columns are left out. */
export function groupColumns(nodes: readonly OrgNode[]): OrgColumn[] {
  const buckets = new Map<ColumnKey, OrgNode[]>();
  for (const person of nodes) {
    const key = columnOf(person);
    const list = buckets.get(key) ?? [];
    list.push(person);
    buckets.set(key, list);
  }
  return COLUMN_ORDER.filter((key) => buckets.has(key)).map((key) => ({
    key,
    label: COLUMN_LABEL[key],
    people: sortByRank(buckets.get(key)!),
  }));
}

/** The people a reader would name first: founders, then the chiefs, in rank order. */
export function startingFive(nodes: readonly OrgNode[], max = 5): OrgNode[] {
  return sortByRank(nodes).slice(0, max);
}

// ── Moves ───────────────────────────────────────────────────────────────────

export type MoveKind = NonNullable<OrgNode['move']>['kind'];

export const MOVE_LABEL: Record<MoveKind, string> = {
  joined: 'Joined',
  promoted: 'Promoted',
  role_change: 'New role',
  departed: 'Departed',
};

const DAY_MS = 86_400_000;
export const RECENT_MOVE_DAYS = 365;

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

interface ReadDate {
  /** Start of the period the source named, in UTC milliseconds. */
  ms: number;
  precision: 'year' | 'month' | 'day';
}

/**
 * A reported date: ISO year, month or day, or "Mar 2026" / "2026 March". Anything
 * else (a quarter, "early 2022", free text) is not read, so nothing is guessed.
 */
function readDate(value: string): ReadDate | null {
  const text = value.trim();
  const iso = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:[T ].*)?$/.exec(text);
  if (iso) {
    const month = iso[2] ? Number(iso[2]) : null;
    const day = iso[3] ? Number(iso[3]) : null;
    if ((month !== null && (month < 1 || month > 12)) || (day !== null && (day < 1 || day > 31))) return null;
    return {
      ms: Date.UTC(Number(iso[1]), (month ?? 1) - 1, day ?? 1),
      precision: day !== null ? 'day' : month !== null ? 'month' : 'year',
    };
  }
  const named = /^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(text) ?? /^(\d{4})\s+([A-Za-z]{3,9})\.?$/.exec(text);
  if (named) {
    const [word, year] = /^\d/.test(named[1]!) ? [named[2]!, named[1]!] : [named[1]!, named[2]!];
    const month = MONTH_NAMES.indexOf(word.slice(0, 3).toLowerCase());
    if (month >= 0) return { ms: Date.UTC(Number(year), month, 1), precision: 'month' };
  }
  return null;
}

/** "Mar 2026" in UTC, so a month the source named never slips a day across a timezone. */
export function monthYear(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export interface RecentMove {
  kind: MoveKind;
  /** "JOINED · MAR 2026" */
  label: string;
  sourceUrl: string;
  supportingQuote: string | null;
}

/**
 * The ribbon rule: a move counts only with a web source and a readable date
 * within a year of `now`. An unsourced, undated or old move is not shown.
 */
export function recentMove(person: Pick<OrgNode, 'move'>, now: number = Date.now()): RecentMove | null {
  const move = person.move;
  const url = move ? safeHttpUrl(move.sourceUrl) : undefined;
  if (!move || !url) return null;
  const when = readDate(move.date);
  if (when === null) return null;
  if (Math.abs(now - when.ms) > RECENT_MOVE_DAYS * DAY_MS) return null;
  // A year-only date says only the year: never invent the month.
  const shown = when.precision === 'year' ? String(new Date(when.ms).getUTCFullYear()) : monthYear(when.ms);
  return {
    kind: move.kind,
    label: `${MOVE_LABEL[move.kind]} · ${shown}`.toUpperCase(),
    sourceUrl: url,
    supportingQuote: move.supportingQuote?.trim() || null,
  };
}
