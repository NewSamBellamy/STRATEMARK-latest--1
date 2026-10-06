import { z } from 'zod';
import type { Deck, Market, ResearchThread } from '@mi/contracts';
import { GeminiRepository, isOriginalSourceAttempt, migrateSnapshot, type LlmClient } from '@mi/research';
import type { StratemarkDataStore } from './firestoreStore';

export const researchIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const scopeSchema = z.object({
  kind: z.enum(['deck', 'company', 'cards', 'datapoint']),
  deckId: researchIdSchema,
  companyId: researchIdSchema.nullish(),
  cardIds: z.array(researchIdSchema).max(30).optional(),
  subject: z.string().max(300).nullish(),
}).strict();
export const cloudChatSchema = z.object({
  threadId: researchIdSchema.optional(), scope: scopeSchema.optional(),
  question: z.string().trim().min(1).max(8000),
  attachments: z.object({ reportIds: z.array(researchIdSchema).max(3).optional(), threadIds: z.array(researchIdSchema).max(3).optional() }).strict().optional(),
}).strict().refine(input => input.threadId || input.scope, 'A thread or deck scope is required');

function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }

/** Authorization and snapshot preparation occur before credential/model work.
 * Only thread writes are persisted; source decks remain authoritative, not copied back.
 */
export async function prepareCloudChat(store: StratemarkDataStore, userId: string, input: z.infer<typeof cloudChatSchema>) {
  const stored = input.threadId ? await store.getResearchThread(userId, input.threadId) : null;
  if (input.threadId && !stored) fail(404, 'Research thread not found');
  const scope = stored?.thread.scope ?? input.scope!;
  if (stored && input.scope && JSON.stringify(scopeSchema.parse(scope)) !== JSON.stringify(input.scope)) fail(400, 'Thread scope cannot change');
  if (input.attachments?.reportIds?.length) fail(400, 'Cloud report attachments are not available yet');
  const deckId = scope.deckId;
  if (!deckId) fail(400, 'Cloud research requires a deck scope');
  const record = await store.getDeck(deckId);
  if (!record || record.userId !== userId) fail(404, 'Deck not found');
  const companyIds = new Set(record.cards.flatMap(item => item.company ? [item.company.id] : []));
  const cardIds = new Set(record.cards.map(item => item.card.id));
  if ((scope.companyId && !companyIds.has(scope.companyId)) ||
      ((scope.kind === 'company' || scope.kind === 'datapoint') && !scope.companyId) ||
      (scope.kind === 'cards' && (!scope.cardIds?.length || scope.cardIds.some(id => !cardIds.has(id))))) fail(400, 'Research scope is not in this deck');

  const references: ResearchThread[] = [];
  for (const id of input.attachments?.threadIds ?? []) {
    const reference = await store.getResearchThread(userId, id);
    if (!reference) fail(404, 'Attached research thread not found');
    const referencedDeck = await store.getDeck(reference.deckId);
    if (!referencedDeck || referencedDeck.userId !== userId) fail(404, 'Attached research thread not found');
    if (id !== stored?.thread.id) references.push(reference.thread);
  }
  const snapshot = migrateSnapshot(null).snapshot;
  snapshot.decks = [{ ...record.deck, id: deckId, marketId: String(record.market.id ?? deckId) } as unknown as Deck];
  snapshot.markets = [{ ...record.market, id: String(record.market.id ?? deckId),
    scopeDefinition: record.market.scopeDefinition ?? { vertical: typeof record.plan?.vertical === 'string' ? record.plan.vertical : 'Market', geography: null, notes: null },
  } as unknown as Market];
  snapshot.cards = record.cards.map(item => ({ ...item.card, deckId }));
  snapshot.companies = [...new Map(record.cards.flatMap(item => item.company ? [[item.company.id, item.company] as const] : [])).values()];
  snapshot.metrics = record.cards.flatMap(item => item.metrics ?? []).filter(metric => companyIds.has(metric.companyId));
  snapshot.viceClaims = record.cards.flatMap(item => item.viceClaims ?? []);
  snapshot.threads = [...(stored ? [stored.thread] : []), ...references];
  snapshot.originalSourceAttempts = [
    ...(record.companySourceAttempts ?? []),
    ...(record.originalSourceAttempts ?? []).map((attempt, index) => ({ ...attempt, id: `src_cloud_diagnostic_${index}` })),
  ].filter(isOriginalSourceAttempt);
  let revision = stored?.revision ?? 0;
  return {
    async answer(client: LlmClient) {
      const repository = new GeminiRepository({ apiKey: '', client, store: {
        read: () => structuredClone(snapshot),
        write: async next => {
          const thread = stored ? next.threads.find(entry => entry.id === stored.thread.id)
            : next.threads.find(entry => !references.some(reference => reference.id === entry.id));
          if (!thread) fail(503, 'Research thread persistence failed');
          // No paid calls inside the storage transaction; stale requests fail before answering.
          revision = await store.saveResearchThread(userId, thread, revision);
          Object.assign(snapshot, structuredClone(next));
        },
      } });
      return repository.askResearch({ ...input, scope });
    },
  };
}
