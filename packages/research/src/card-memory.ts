/**
 * Card memory: which conversations and reports belong to a card. Pure functions over a snapshot; nothing here
 * researches or calls a model. Old data needs no migration: a thread saved with `deckId: null` and no `cardIds`
 * still belongs to its company's cards through `scope.companyId`.
 */
import { isEntityCardType, type CardMemory, type Report, type ReportRequest, type ResearchThread } from '@mi/contracts';
import type { RepoSnapshot } from './repository';

type MemorySnap = Pick<RepoSnapshot, 'cards' | 'threads' | 'reports'>;

/** The cards a conversation belongs to: its explicit `cardIds`, else every entity card of its company, else none. */
export function cardIdsForThread(thread: ResearchThread, snap: Pick<RepoSnapshot, 'cards'>): string[] {
  const explicit = thread.scope.cardIds;
  if (explicit && explicit.length > 0) return [...explicit];
  const companyId = thread.scope.companyId;
  if (!companyId) return [];
  return snap.cards.filter((c) => c.companyId === companyId && isEntityCardType(c.cardType)).map((c) => c.id);
}

/** The thread ids a report request folds in: `threadIds` when given, else the single `threadId`. */
export function requestThreadIds(request: Pick<ReportRequest, 'threadId' | 'threadIds'>): string[] {
  const many = (request.threadIds ?? []).filter(Boolean);
  if (many.length > 0) return [...new Set(many)];
  return request.threadId ? [request.threadId] : [];
}

/** The optional memory fields a new report is stamped with, so it can be listed under its card. */
export function reportStamp(
  request: ReportRequest,
  snap: MemorySnap,
): Pick<Report, 'cardId' | 'deckId' | 'threadIds' | 'focusKind'> {
  const ids = requestThreadIds(request);
  const threads = ids.map((id) => snap.threads.find((t) => t.id === id)).filter((t): t is ResearchThread => Boolean(t));
  let cardId = request.cardId ?? null;
  if (!cardId) {
    const cards = [...new Set(threads.flatMap((t) => cardIdsForThread(t, snap)))];
    if (cards.length === 1) cardId = cards[0]!;
  }
  const card = cardId ? snap.cards.find((c) => c.id === cardId) : undefined;
  const deckId = request.kind === 'deck' ? request.subjectId : (threads.find((t) => t.scope.deckId)?.scope.deckId ?? card?.deckId ?? null);
  const focusKind: 'all' | 'thread' | 'topic' = ids.length > 0 ? 'thread' : request.topics?.length || (request.focus ?? '').trim() ? 'topic' : 'all';
  return { cardId, deckId, threadIds: ids, focusKind };
}

/** Everything the app remembers about one card. `brief` is filled by the signal-brief engine, not here. */
export function cardMemory(snap: MemorySnap, cardId: string): CardMemory {
  const card = snap.cards.find((c) => c.id === cardId);
  const threads = snap.threads
    .filter((t) => cardIdsForThread(t, snap).includes(cardId))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  const threadIds = new Set(threads.map((t) => t.id));
  // Signal cards never inherit a company's reports; only entity cards bring their company.
  const companyId = card && isEntityCardType(card.cardType) ? card.companyId : null;
  const reports = snap.reports
    .filter(
      (r) =>
        r.cardId === cardId ||
        (r.threadIds ?? []).some((id) => threadIds.has(id)) ||
        (!r.cardId && r.kind === 'company' && companyId != null && r.subjectId === companyId),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return { cardId, threads: structuredClone(threads), reports: structuredClone(reports), brief: null };
}
