import type { StratemarkDataStore } from './firestoreStore';
import type { ArtifactStorageAdapter } from './CloudDeckService';
import { AgentObservabilityLogger } from './observability';

/**
 * Background purge worker: deletes deck data and artifacts for accounts whose
 * 30-day retention period has expired. Should be invoked periodically (e.g.,
 * via Cloud Scheduler or a cron-like mechanism).
 *
 * Issue #57: "Entitlement loss retains data read-only for 30 days after
 * notice, then deletes deck data and artifacts."
 */
export async function purgeExpiredRetention(options: {
  store: StratemarkDataStore;
  artifactStorage: ArtifactStorageAdapter;
  projectId?: string;
}): Promise<{ purged: number; errors: number }> {
  const logger = new AgentObservabilityLogger({
    projectId: options.projectId || process.env.GOOGLE_CLOUD_PROJECT || 'stratemark-agentic',
  });

  let purged = 0;
  let errors = 0;

  try {
    // Find all decks whose entitlement has a retentionUntil in the past
    const allDecks = await options.store.listDecks();
    const now = Date.now();

    for (const deckRecord of allDecks) {
      const userId = deckRecord.userId as string | undefined;
      const deckId = deckRecord.id as string | undefined;
      if (!userId || !deckId) continue;

      const entitlement = await options.store.getEntitlement(userId);
      if (!entitlement) continue;

      // Only purge if status is not active/trialing AND retentionUntil has passed
      const isActive = entitlement.status === 'active' || entitlement.status === 'trialing';
      if (isActive) continue;

      if (!entitlement.retentionUntil) continue;
      const retentionMs = new Date(entitlement.retentionUntil).getTime();
      if (retentionMs > now) continue;

      // Retention expired — purge this deck
      try {
        // Delete physical artifacts
        const artifacts = await options.store.listArtifactsForDeck(deckId);
        for (const art of artifacts) {
          await options.artifactStorage.deleteArtifact(art.storagePath);
        }

        // Delete Firestore records
        await options.store.deleteDeck(deckId);
        purged++;
        logger.logNotice(`Purged expired-retention deck ${deckId} for user ${userId}`);
      } catch (err) {
        errors++;
        logger.logError(`Failed to purge deck ${deckId}`, err);
      }
    }
  } catch (err) {
    errors++;
    logger.logError('Purge worker failed', err);
  }

  logger.logNotice(`Purge worker complete: ${purged} decks purged, ${errors} errors`);
  return { purged, errors };
}
