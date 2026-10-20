/**
 * Deciding how a chat question is answered, and checking an answer written from stored research. Pure functions: no I/O, no model call.
 *
 * - `greeting`: never searches; one cheap ungrounded reply.
 * - `fresh`: a grounded search (the question wants something recent, the user asked to search again, or the card holds too little).
 * - `memory`: one ungrounded call over what the card already knows. Its citations come only from the stored passages it names.
 */
import { usableCitations, type Citation } from '@mi/contracts';
import { allowedFigures, dropUntraceableFigures, sanitizeSectionMarkdown } from './report-topics';

export type ChatRoute = 'greeting' | 'fresh' | 'memory';

/** At least this many relevant stored passages are needed before the card answers from memory. */
export const MIN_MEMORY_PASSAGES = 2;
/** What the memory call may read on top of the existing deck digest. */
export const MEMORY_MAX_CHARS = 6000;

const RECENT_ASK = /\b(?:latest|today|tonight|yesterday|this (?:week|month|morning)|news|breaking|check again|search again|look again|right now|just (?:announce[ds]?|launch(?:ed|es)?|releas(?:ed|es?)|rais(?:ed|es?))|currently|recent(?:ly)?)\b/i;

/** Whether the question asks for something that moves day to day. */
export function asksForRecent(question: string): boolean {
  return RECENT_ASK.test(question);
}

export function routeChat(input: {
  question: string;
  hasFreshFlag?: boolean;
  /** The relevant stored passages found for this question (a list or a count). */
  storedPassages: readonly unknown[] | number;
  isGreeting: boolean;
}): ChatRoute {
  if (input.isGreeting) return 'greeting';
  if (input.hasFreshFlag || asksForRecent(input.question)) return 'fresh';
  const count = typeof input.storedPassages === 'number' ? input.storedPassages : input.storedPassages.length;
  return count >= MIN_MEMORY_PASSAGES ? 'memory' : 'fresh';
}

/** One piece of stored research the memory call may read, with the sources it came from. */
export interface StoredPassage {
  id: string;
  label: string;
  text: string;
  citations: readonly Citation[];
}

const STOP = new Set(['the', 'and', 'for', 'what', 'how', 'this', 'that', 'with', 'are', 'was', 'does', 'about', 'company', 'tell', 'them', 'they', 'their']);
const termsOf = (text: string): string[] => [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 2 && !STOP.has(t)))];

/** A stored passage that shares at least one meaningful word with the question. */
export function passageIsRelevant(question: string, passage: Pick<StoredPassage, 'text' | 'label'>): boolean {
  const q = termsOf(question);
  if (!q.length) return false;
  const hay = `${passage.label} ${passage.text}`.toLowerCase();
  return q.some((t) => hay.includes(t));
}

/** The passages as a prompt block, newest content first as given, within the character budget. Returns the passages that fit. */
export function fitPassages(passages: readonly StoredPassage[], maxChars = MEMORY_MAX_CHARS): { block: string; used: StoredPassage[] } {
  const used: StoredPassage[] = [];
  const lines: string[] = [];
  let size = 0;
  for (const p of passages) {
    const room = maxChars - size - (`[${p.id}] ${p.label}:\n\n`.length);
    if (room < 200) break;
    const text = p.text.length > room ? `${p.text.slice(0, room - 1).trimEnd()}…` : p.text;
    const entry = `[${p.id}] ${p.label}:\n${text}`;
    lines.push(entry);
    used.push({ ...p, text });
    size += entry.length + 2;
  }
  return { block: lines.join('\n\n'), used };
}

export interface MemoryReply {
  answerable?: boolean;
  answer?: string;
  passageIds?: readonly string[];
}

export interface MemoryAnswer {
  text: string;
  citations: Citation[];
  passageIds: string[];
  /** Sentences or lines removed because the named passages do not state their figure. */
  removed: number;
}

/**
 * Turns the model's memory reply into an answer, or null when it cannot stand. Sources come ONLY from the stored passages the
 * model named (ids looked up in our own table); URLs and footnote markers it wrote are stripped; any figure the named passages
 * do not state is removed. An answer that names no stored passage, or that nothing survives, is not an answer.
 */
export function resolveMemoryAnswer(reply: MemoryReply | null | undefined, passages: readonly StoredPassage[]): MemoryAnswer | null {
  if (!reply?.answerable || !reply.answer?.trim()) return null;
  const byId = new Map(passages.map((p) => [p.id, p]));
  const named = [...new Set(reply.passageIds ?? [])].map((id) => byId.get(id)).filter((p): p is StoredPassage => p != null);
  if (!named.length) return null;
  const allowed = allowedFigures(...named.map((p) => p.text));
  // Keep the closing follow-ups line out of the figure guard: it is not a claim.
  const m = /(?:^|\n)\s*Follow-ups:\s*[^\n]*$/i.exec(reply.answer);
  const body = m ? reply.answer.slice(0, m.index) : reply.answer;
  const tail = m ? reply.answer.slice(m.index).trim() : '';
  const guarded = dropUntraceableFigures(sanitizeSectionMarkdown(body), allowed);
  const text = guarded.markdown.trim();
  if (!text) return null;
  const followUps = tail && !/\d/.test(tail) ? sanitizeSectionMarkdown(tail) : '';
  return {
    text: followUps ? `${text}\n\n${followUps}` : text,
    citations: usableCitations(named.flatMap((p) => p.citations.slice(0, 6).map((c) => ({ ...c })))),
    passageIds: named.map((p) => p.id),
    removed: guarded.removed,
  };
}
