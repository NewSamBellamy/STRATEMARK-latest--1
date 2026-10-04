import { runLivingDeckEngine, expandDeckWithDeltaAgent, type MarketPlan } from '@mi/research';
import type { TaskPayload, RefreshTaskPayload } from './CloudTasksAdapter';
import type { ServiceEnv } from '../env';
import { resolveClient } from './client';
import type { CloudDeckService } from './CloudDeckService';
import type { CardWithCompany } from '@mi/contracts';
import type { HydrateCompanyCardResult } from '@mi/research';
import type { StoredDeckRecord } from './firestoreStore';
import { AgentObservabilityLogger } from './observability';

export interface DeckIdentity {
  userId: string;
  deckId: string;
}

export class CloudDeckWorker {
  constructor(
    private readonly env: ServiceEnv,
    private readonly service: CloudDeckService
  ) {}

  private async updateDeckState(
    id: DeckIdentity, 
    mutator: (deck: StoredDeckRecord) => Partial<StoredDeckRecord>
  ): Promise<void> {
    const fresh = await this.service.getDeck(id.userId, id.deckId);
    if (fresh) {
      const updates = mutator(fresh);
      await this.service.saveDeck(id.userId, id.deckId, {
        ...fresh,
        ...updates
      }, fresh.revision);
    }
  }

  async processDeckCreation(payload: TaskPayload): Promise<void> {
    const { deckId, userId, plan, watch, maxCandidates, traceContext } = payload;
    const id: DeckIdentity = { userId, deckId };
    const logger = new AgentObservabilityLogger({
      projectId: this.env.vertex?.project || process.env.GOOGLE_CLOUD_PROJECT || 'stratemark-agentic',
      traceContext,
      deckId,
      userId,
    });
    
    // Check if deck exists
    const existing = await this.service.getDeck(userId, deckId);
    if (!existing) {
      logger.logWarn(`Deck ${deckId} not found for processing`);
      return;
    }

    // Idempotent no-op if deck is already ready
    if (existing.state?.status === 'ready') {
      logger.logInfo(`Deck ${deckId} is already ready, skipping`);
      return;
    }

    // Check entitlement again
    const isEntitled = await this.service.checkEntitlement(userId);
    if (!isEntitled) {
      logger.logWarn(`User ${userId} lost entitlement during processing`);
      await this.updateDeckState(id, () => ({
        state: { status: 'failed', error: 'Entitlement lost' }
      }));
      return;
    }

    logger.logInfo(`Starting Cloud Deck research for "${plan.marketName}" (${deckId})`, {
      query: payload.query,
      maxCandidates,
    });

    let currentCards = existing.cards ?? [];
    let savePromise = Promise.resolve();
    const abortController = new AbortController();
    const timeoutSignal = AbortSignal.timeout(600_000);
    
    const onAbort = () => abortController.abort();
    timeoutSignal.addEventListener('abort', onAbort);

    let run: Awaited<ReturnType<typeof runLivingDeckEngine>>;
    try {
      const resolved = resolveClient({ env: this.env });
      run = await runLivingDeckEngine({
        originalSources: this.service.getOriginalSources(userId, deckId),
        client: resolved.client,
        plan,
        deckId,
        watch: watch ?? false,
        budgetMs: 550_000,
        ...(maxCandidates === undefined ? {} : { maxCandidates }),
        signal: abortController.signal,
        onTrace: (traceEvent) => {
          logger.logAdkTrace(traceEvent);
        },
        onEvent: (event) => {
          if (event.type === 'boot') {
            logger.logNotice(
              `Market topology discovered: ${event.topology.candidates.length} candidates in ${event.elapsedMs}ms`,
              { candidateCount: event.topology.candidates.length, elapsedMs: event.elapsedMs }
            );
          } else if (event.type === 'card' || event.type === 'growth') {
            const result = event.type === 'card' ? event.result : event.card;

            // event.result is HydrateCompanyCardResult, which has multiple cards in result.cards
            // event.card from 'growth' is a CardWithCompany
            const newCards = event.type === 'card'
              ? (result as HydrateCompanyCardResult).cards
              : [result as CardWithCompany];

            let updated = false;
            for (const card of newCards) {
              const duplicateIndex = currentCards.findIndex(c => c.card.id === card.card.id);
              if (duplicateIndex === -1) {
                currentCards = [...currentCards, card];
                updated = true;
              } else {
                // Overwrite the older shell card with the newly hydrated one that contains metrics and confidence scores
                const next = [...currentCards];
                next[duplicateIndex] = card;
                currentCards = next;
                updated = true;
              }
            }

            if (updated) {
              // Serialize intermediate checkpoints to avoid 409s/conflicts
              savePromise = savePromise.then(async () => {
                const freshDeck = await this.service.getDeck(userId, deckId);
                if (!freshDeck) {
                  abortController.abort(new Error('Deck deleted'));
                  return;
                }
                const stillEntitled = await this.service.checkEntitlement(userId);
                if (!stillEntitled) {
                  abortController.abort(new Error('Entitlement lost'));
                  throw new Error('Entitlement lost during run');
                }
                await this.updateDeckState(id, () => ({
                  cards: currentCards,
                  state: { status: 'partial' }
                }));
              }).catch(err => {
                logger.logError('Checkpoint failed', err);
                if (err instanceof Error && (err.message.includes('Entitlement lost') || err.message.includes('Deck deleted'))) {
                  abortController.abort(err);
                  throw err;
                }
              });
            }
          }
        }
      });
    } catch (err: unknown) {
      timeoutSignal.removeEventListener('abort', onAbort);
      const freshDeck = await this.service.getDeck(userId, deckId);
      if (!freshDeck) return; // Clean exit on deletion

      const message = err instanceof Error ? err.message : String(err);
      await this.updateDeckState(id, () => ({
        cards: currentCards,
        state: { status: 'failed', error: message.slice(0, 500) }
      }));
      logger.logError('Cloud deck creation failed', err, { deckId });
      return;
    }

    timeoutSignal.removeEventListener('abort', onAbort);

    await savePromise.catch(() => {});

    const freshDeck = await this.service.getDeck(userId, deckId);
    if (!freshDeck) return; // Deleted during processing

    const cardMap = new Map<string, CardWithCompany>();
    for (const c of currentCards) {
      if (c?.card?.id) cardMap.set(c.card.id, c);
    }
    for (const h of run.hydrated) {
      for (const c of h.cards) {
        if (c?.card?.id) cardMap.set(c.card.id, c);
      }
    }
    const finalCards = Array.from(cardMap.values());

    // An interrupted run with validated progress remains partial so the next
    // delivery can resume it without presenting incomplete coverage as ready.
    const isPartial =
      run.enrichmentFailures.length > 0 || (run.aborted && finalCards.length > 0);
    const isFailed = !isPartial && (run.aborted || run.state.status === 'failed');
    const finalStatus = isFailed ? 'failed' : isPartial ? 'partial' : 'ready';
    const failedReason = run.aborted
      ? 'Research timed out or was aborted'
      : run.statuses.find((status) => status.state === 'failed')?.error ??
        (isPartial ? 'Some research units failed; coverage is incomplete' : 'Research failed');

    await this.updateDeckState(id, () => ({
      cards: finalCards,
      researchTrace: {
        events: run.trace.slice(-500),
        statuses: run.statuses,
        summary: run.summary,
      },
      state: { status: finalStatus, ...(isFailed || isPartial ? { error: failedReason } : {}) }
    }));

    if (isFailed || isPartial) {
      logger.logWarn(`Cloud Deck research ended in ${finalStatus} status: ${failedReason}`, {
        deckId,
        totalMs: run.totalMs,
      });
    } else {
      logger.logNotice(
        `Cloud Deck research completed successfully: ${finalCards.length} cards saved in ${run.totalMs}ms`,
        { totalCards: finalCards.length, totalMs: run.totalMs }
      );
    }
  }

  async processDeckRefresh(payload: RefreshTaskPayload): Promise<void> {
    const { deckId, userId, query, traceContext } = payload;
    const id: DeckIdentity = { userId, deckId };
    const logger = new AgentObservabilityLogger({
      projectId: this.env.vertex?.project || process.env.GOOGLE_CLOUD_PROJECT || 'stratemark-agentic',
      traceContext,
      deckId,
      userId,
    });
    
    const existing = await this.service.getDeck(userId, deckId);
    if (!existing) {
      logger.logWarn(`Deck ${deckId} not found for refresh`);
      return;
    }

    const isEntitled = await this.service.checkEntitlement(userId);
    if (!isEntitled) {
      logger.logWarn(`User ${userId} lost entitlement before refresh`);
      await this.updateDeckState(id, () => ({
        state: { status: 'ready_stale', error: 'Entitlement lost' }
      }));
      return;
    }

    logger.logInfo(`Starting Cloud Deck delta refresh for "${query}" (${deckId})`);
    const resolved = resolveClient({ env: this.env });
    
    try {
      const plan = existing.plan as MarketPlan | undefined;
      const vertical = plan?.vertical ?? 'market-intel';

      const updatedCards = await expandDeckWithDeltaAgent({
        originalSources: this.service.getOriginalSources(userId, deckId),
        deckId,
        client: resolved.client,
        marketName: query,
        vertical: vertical,
        existingCards: existing.cards ?? [],
      });
      
      await this.updateDeckState(id, () => ({
        cards: updatedCards,
        refreshedAt: new Date().toISOString(),
        state: { status: 'ready' }
      }));

      logger.logNotice(
        `Cloud Deck refresh completed: ${updatedCards.length} cards now present`,
        { totalCards: updatedCards.length }
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Use 'ready_stale' to distinguish a failed refresh from a healthy ready deck.
      // The worklist queries on 'ready', so a failed refresh won't be re-enqueued
      // but the deck remains accessible. Only a successful refresh restores 'ready'.
      await this.updateDeckState(id, () => ({
        state: { status: 'ready_stale', error: errMsg }
      }));
      logger.logError(`Cloud Deck refresh failed: ${errMsg}`, err, { deckId });
    }
  }
}
