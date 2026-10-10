/**
 * Autonomous Refresh Engine — Firestore worklist provider.
 *
 * Runs scheduled delta research over active decks stored in Firestore,
 * expanding company cards and updating metrics automatically when Cloud
 * Scheduler calls /tasks/refresh.
 */
import { Firestore } from '@google-cloud/firestore';
import type { CardWithCompany } from '@mi/contracts';
import type { ServiceEnv } from '../env';
import type { CloudDeckService } from './CloudDeckService';
import type { TasksAdapter } from './CloudTasksAdapter';

export interface RefreshWorklistDeck {
  deckId: string;
  userId: string;
  query: string;
  updatedAt?: string;
  cards?: CardWithCompany[];
}

export interface WorklistStore {
  getDecks(): Promise<RefreshWorklistDeck[]>;
  saveRefreshedDeck(deckId: string, data: { cards: CardWithCompany[]; refreshedAt: string }): Promise<void>;
}

export class FirestoreWorklistStore implements WorklistStore {
  private firestore: Firestore;
  private collectionName: string;

  constructor(options?: { projectId?: string; collectionName?: string }) {
    this.firestore = new Firestore({
      ...(options?.projectId ? { projectId: options.projectId } : {}),
    });
    this.collectionName = options?.collectionName ?? 'decks';
  }

  async getDecks(): Promise<RefreshWorklistDeck[]> {
    const snapshot = await this.firestore.collection(this.collectionName)
      .where('watch', '==', true)
      .where('state.status', '==', 'ready')
      .limit(50)
      .get();
    const decks: RefreshWorklistDeck[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data && (data.query || data.title || data.deckId)) {
        decks.push({
          deckId: doc.id,
          userId: data.userId || 'unknown',
          query: data.query ?? data.title ?? '',
          updatedAt: data.updatedAt ?? data.refreshedAt,
          cards: Array.isArray(data.cards) ? data.cards : [],
        });
      }
    });
    return decks;
  }

  async saveRefreshedDeck(deckId: string, data: { cards: CardWithCompany[]; refreshedAt: string }): Promise<void> {
    await this.firestore.collection(this.collectionName).doc(deckId).set(
      {
        cards: data.cards,
        updatedAt: data.refreshedAt,
        refreshedAt: data.refreshedAt,
      },
      { merge: true },
    );
  }
}

export interface RefreshExecutionOptions {
  env: ServiceEnv;
  store?: WorklistStore;
  cloudDeckService?: CloudDeckService;
  tasksAdapter?: TasksAdapter;
}

export interface RefreshExecutionResult {
  ok: boolean;
  ranAt: string;
  refreshed: number;
  totalDecks: number;
  note?: string;
}

export async function executeScheduledRefresh(
  options: RefreshExecutionOptions,
): Promise<RefreshExecutionResult> {
  const store =
    options.store ??
    (options.env.vertex?.project || process.env.FIRESTORE_EMULATOR_HOST || process.env.GOOGLE_CLOUD_PROJECT
      ? new FirestoreWorklistStore({
          projectId: options.env.vertex?.project || process.env.GOOGLE_CLOUD_PROJECT,
        })
      : null);

  const ranAt = new Date().toISOString();

  if (!store) {
    return {
      ok: true,
      ranAt,
      refreshed: 0,
      totalDecks: 0,
      note: 'No persistence layer bound yet — connect Firestore to populate the refresh worklist.',
    };
  }

  let decks: RefreshWorklistDeck[] = [];
  try {
    decks = await store.getDecks();
  } catch (err) {
    return {
      ok: true,
      ranAt,
      refreshed: 0,
      totalDecks: 0,
      note: `Firestore query failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (decks.length === 0) {
    return {
      ok: true,
      ranAt,
      refreshed: 0,
      totalDecks: 0,
      note: 'Worklist connected; 0 active decks found in Firestore.',
    };
  }

  const { cloudDeckService, tasksAdapter } = options;
  if (!cloudDeckService || !tasksAdapter) {
    return {
      ok: false,
      ranAt,
      refreshed: 0,
      totalDecks: decks.length,
      note: 'Refresh fan-out failed: CloudDeckService or TasksAdapter not provided.',
    };
  }

  let enqueuedCount = 0;
  for (const deck of decks) {
    if (!deck.query) continue;
    try {
      const isEntitled = await cloudDeckService.checkEntitlement(deck.userId);
      if (!isEntitled) {
        continue;
      }
      
       const fullDeck = await cloudDeckService.getDeck(deck.userId, deck.deckId);
       if (fullDeck) {
          await cloudDeckService.saveDeck(deck.userId, deck.deckId, {
            ...fullDeck,
            state: { status: 'refreshing' }
          }, fullDeck.revision);
          await tasksAdapter.enqueueDeckRefresh({
           deckId: deck.deckId,
           userId: deck.userId,
           query: deck.query
         });
         enqueuedCount += 1;
      }
    } catch {
      /* isolate single deck failure */
    }
  }

  return {
    ok: true,
    ranAt,
    refreshed: enqueuedCount,
    totalDecks: decks.length,
    note: enqueuedCount > 0 ? `Enqueued ${enqueuedCount} decks for refresh.` : 'No decks eligible for refresh.',
  };
}
