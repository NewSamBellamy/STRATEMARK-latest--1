/**
 * What a team page may say about one person, and where each line came from.
 * Shared by the player card, the list rows and the profile panel so they never
 * disagree: a stat line exists only when its field is non-empty, every stat
 * line points at a numbered source, and a person with no retained source page
 * says so plainly.
 */
import type { OrgNode } from '@mi/contracts';
import { publisherOf } from '@mi/contracts';
import { safeHttpUrl } from '@/lib/sourceHref';
import { MOVE_LABEL, monthYear } from './orgRank';

/** Research sometimes writes the gap itself. That is an empty field, not a fact. */
const PLACEHOLDER = /^(?:unknown|n\/?a|not reported|not available|none|-)$/i;

export function reported(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text && !PLACEHOLDER.test(text) ? text : null;
}

export interface StatLine {
  key: 'tenure' | 'prior' | 'project';
  label: string;
  value: string;
}

/** 0 to 3 lines, only for fields that hold something. Nothing is padded with "Not reported". */
export function statLines(person: Pick<OrgNode, 'tenure' | 'priorCompany' | 'notableProject'>): StatLine[] {
  const lines: StatLine[] = [];
  const tenure = reported(person.tenure);
  const prior = reported(person.priorCompany);
  const project = reported(person.notableProject);
  if (tenure) lines.push({ key: 'tenure', label: 'Tenure', value: tenure });
  if (prior) lines.push({ key: 'prior', label: 'Previously', value: prior });
  if (project) lines.push({ key: 'project', label: 'Known for', value: project });
  return lines;
}

export interface PersonSource {
  n: number;
  /** Web address, only when it is a real http(s) page. */
  url: string | null;
  host: string | null;
  quote: string | null;
  retrieved: string | null;
  /** What this source backs when it is not the person's own profile line. */
  about: string | null;
}

export const NO_SOURCE_NOTE = 'No source link — this person was reported by search, original page not retrieved.';

/** The footnote number as the text of a <sup>. */
export const footnoteMark = (n: number): string => String(n);

/** About 160 characters of the supporting quote, cut at a word. */
export function shortQuote(quote: string | null | undefined, max = 160): string | null {
  const text = quote?.trim();
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 80)).trimEnd()}…`;
}

/**
 * The numbered sources behind a person. Source 1 is always listed (it carries
 * the stat-line footnotes): with its page when one was retained, and without
 * one the list says so. A reported move adds a second source when its page
 * differs.
 */
export function personSources(person: OrgNode): PersonSource[] {
  const url = safeHttpUrl(person.sourceUrl) ?? null;
  const sources: PersonSource[] = [{
    n: 1,
    url,
    host: url ? publisherOf(url, null) : null,
    quote: shortQuote(person.supportingQuote),
    retrieved: person.sourceRetrievedAt?.slice(0, 10) || null,
    about: null,
  }];
  const move = person.move;
  const moveUrl = move ? safeHttpUrl(move.sourceUrl) : undefined;
  if (move && moveUrl && moveUrl !== url) {
    sources.push({
      n: 2,
      url: moveUrl,
      host: publisherOf(moveUrl, null),
      quote: shortQuote(move.supportingQuote),
      retrieved: null,
      about: `${MOVE_LABEL[move.kind]}, ${move.date}`,
    });
  }
  return sources;
}

/**
 * Search-only research writes where a line came from in front of it:
 * `Google Search reports (original page not retrieved): "…"`. The profile keeps
 * that wording (and says there is no source link); a card shows only the line.
 */
const PROVENANCE_PREFIX = /^[^:"“]{1,80}\(original page not retrieved\)\s*:\s*/i;

/** The bio as a card shows it: the reported line without its provenance prefix or wrapping quotes. Null when empty. */
export function cardBio(bio: string | null | undefined): string | null {
  const text = reported(bio);
  if (!text) return null;
  const line = text.replace(PROVENANCE_PREFIX, '').trim().replace(/^["“](.*)["”]\.?$/s, '$1').trim();
  return line || null;
}

export interface GlanceFact {
  key: 'reportsTo' | 'tenure' | 'started' | 'prior' | 'project' | 'move';
  label: string;
  value: string;
  /** The numbered source behind it (see personSources); none for the reporting line. */
  footnote: number | null;
}

/**
 * What a profile can say about a person beyond name and role, in reading order.
 * Only fields that hold something: an empty list means the record is name and role only.
 */
export function glanceFacts(person: OrgNode, reportsTo: string | null = null): GlanceFact[] {
  const facts: GlanceFact[] = [];
  if (reportsTo?.trim()) facts.push({ key: 'reportsTo', label: 'Reports to', value: reportsTo.trim(), footnote: null });
  const sourced: Array<[GlanceFact['key'], string, string | null | undefined]> = [
    ['tenure', 'Tenure', person.tenure],
    ['started', 'Started', person.startedAt],
    ['prior', 'Previously', person.priorCompany],
    ['project', 'Known for', person.notableProject],
  ];
  for (const [key, label, raw] of sourced) {
    const value = reported(raw);
    if (value) facts.push({ key, label, value, footnote: 1 });
  }
  const note = moveNote(person);
  if (note) {
    const moveUrl = person.move ? safeHttpUrl(person.move.sourceUrl) : undefined;
    const separate = moveUrl && moveUrl !== (safeHttpUrl(person.sourceUrl) ?? null);
    facts.push({ key: 'move', label: 'Recent move', value: note, footnote: separate ? 2 : 1 });
  }
  return facts;
}

/** The move as the back of a card words it, whether or not it is recent enough for a ribbon. */
export function moveNote(person: Pick<OrgNode, 'move'>): string | null {
  const move = person.move;
  if (!move || !safeHttpUrl(move.sourceUrl)) return null;
  const parsed = Date.parse(move.date);
  const when = /^\d{4}-\d{2}/.test(move.date) && !Number.isNaN(parsed) ? monthYear(parsed) : move.date;
  return `${MOVE_LABEL[move.kind]} · ${when}`;
}
