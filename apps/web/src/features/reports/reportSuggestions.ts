/**
 * Suggestions for the report wizard's first step. Pure and free: built only
 * from what the card already remembers, with no model call and no network.
 * A suggestion that has nothing behind it is never offered (no conversation
 * titles when there are no conversations).
 */
import { REPORT_TOPIC_LABELS, type CardMemory, type ReportTopic, type ResearchThread } from '@mi/contracts';

export const TOPIC_HINTS: Record<ReportTopic, string> = {
  overview: 'What the company does and where it stands',
  metrics: 'The figures that are sourced, and the ones that are not',
  live_intel: 'Recent news and what people are saying',
  team_org: 'Who runs it and how it is organised',
  products_roadmap: 'What it sells and what is coming',
  history: 'How it got here',
  mission_governance: 'Mission, board, funding and investors',
  sources: 'Every source behind the report',
};

/** Which sections to offer first when suggesting a topic the card has no research on. */
const TOPIC_ORDER: ReportTopic[] = ['live_intel', 'team_org', 'products_roadmap', 'mission_governance', 'history', 'metrics'];

export type ReportSuggestion =
  | { id: string; kind: 'thread'; label: string; threadId: string }
  | { id: string; kind: 'topic'; label: string; focus: string; topic: ReportTopic }
  | { id: string; kind: 'compare'; label: string; focus: string };

export interface ReportSuggestionContext {
  /** The card's company, used to word the comparison. */
  subjectName?: string | null;
  /** Names of the other companies in the same deck. */
  peerNames?: readonly string[];
}

const MAX_SUGGESTIONS = 3;

function usableThreads(threads: readonly ResearchThread[]): ResearchThread[] {
  return threads.filter((t) => t.title.trim().length > 0 && t.messages.length > 0);
}

export function reportSuggestions(
  memory: Pick<CardMemory, 'threads' | 'reports'> | null | undefined,
  context: ReportSuggestionContext = {},
): ReportSuggestion[] {
  const threads = usableThreads(memory?.threads ?? []);
  const covered = new Set<ReportTopic>((memory?.reports ?? []).flatMap((r) => r.topics ?? []));

  const topic = TOPIC_ORDER.find((t) => !covered.has(t));
  const topicSuggestion: Extract<ReportSuggestion, { kind: 'topic' }> | null = topic
    ? { id: `topic:${topic}`, kind: 'topic', label: `Add research on ${REPORT_TOPIC_LABELS[topic].toLowerCase()}`, focus: TOPIC_HINTS[topic], topic }
    : null;

  const subject = context.subjectName?.trim() || null;
  const peer = (context.peerNames ?? []).map((n) => n.trim()).find((n) => n.length > 0 && n !== subject);
  const compareSuggestion: Extract<ReportSuggestion, { kind: 'compare' }> | null = peer
    ? {
        id: `compare:${peer}`,
        kind: 'compare',
        label: subject ? `Compare ${subject} with ${peer}` : `How it compares with ${peer}`,
        focus: subject ? `How ${subject} compares with ${peer}` : `How it compares with ${peer}`,
      }
    : null;

  const others: ReportSuggestion[] = [];
  if (topicSuggestion) others.push(topicSuggestion);
  if (compareSuggestion) others.push(compareSuggestion);
  const threadSlots = Math.min(2, MAX_SUGGESTIONS - others.length);
  const threadSuggestions: ReportSuggestion[] = threads.slice(0, Math.max(0, threadSlots)).map((t) => ({
    id: `thread:${t.id}`,
    kind: 'thread',
    label: `Turn this conversation into a report: ${t.title.trim()}`,
    threadId: t.id,
  }));

  return [...threadSuggestions, ...others].slice(0, MAX_SUGGESTIONS);
}
