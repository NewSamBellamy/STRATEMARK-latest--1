/**
 * Stratemark Data Store — Firestore and in-memory persistence substrate.
 *
 * Provides persistence for living decks, markets, cards, and saved bookmarks
 * in Cloud Firestore under top-level collections ('decks', 'markets', 'saved_cards').
 * Seamlessly integrates with the Cloud Scheduler autonomous delta refresh worklist.
 */
import { Firestore, FieldValue } from '@google-cloud/firestore';
import type {
  AdkTraceEvent,
  AdkTraceSummary,
  CardWithCompany,
  LivingDeckNodeStatus,
} from '@mi/contracts';
import type { MarketPlan } from '@mi/research';
import type { RefreshWorklistDeck, WorklistStore } from './worklist';
import type { ServiceEnv } from '../env';
import type { OriginalSourceReceipt } from './original-source';

export interface StoredDeckRecord {
  deck: Record<string, unknown>;
  market: Record<string, unknown>;
  cards: CardWithCompany[];
  plan?: MarketPlan | Record<string, unknown>;
  state?: Record<string, unknown>;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
  refreshedAt?: string;
  query?: string;
  watch?: boolean;
  revision?: number;
  schemaVersion?: number;
  /** Bounded diagnostic history, not an immutable full-document vault. */
  originalSourceAttempts?: Array<{
    companyId: string;
    metricType: string;
    capturedAt: string;
    receipts: OriginalSourceReceipt[];
  }>;
  researchTrace?: {
    events: readonly AdkTraceEvent[];
    statuses: readonly LivingDeckNodeStatus[];
    summary: AdkTraceSummary;
  };
}

export const FIRESTORE_MAX_DOCUMENT_BYTES = 1048576;

export function assertPayloadSize(payload: unknown, limit = FIRESTORE_MAX_DOCUMENT_BYTES): void {
  try {
    const serialized = JSON.stringify(payload);
    const size = Buffer.byteLength(serialized, 'utf8');
    if (size > limit) {
      const err = new Error(`Document exceeds the maximum allowed size of ${limit} bytes`) as Error & { status?: number };
      err.status = 413;
      throw err;
    }
  } catch (e: unknown) {
    const err = e as Error & { status?: number };
    if (err.status === 413) throw err;
  }
}

export interface StoredArtifactMetadata {
  id: string;
  deckId: string;
  userId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  revision: number;
  createdAt: string;
}

export interface StoredShareRecord {
  id: string;
  tokenHash: string;
  deckId: string;
  userId: string;
  deckRevision: number;
  deckSnapshot: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string | null;
  revoked: boolean;
}

export interface EntitlementRecord {
  userId: string;
  status: 'active' | 'trialing' | 'canceled' | 'past_due' | 'expired';
  tier: 'free' | 'pro' | 'growth' | 'max';
  canceledAt?: string | null;
  retentionUntil?: string | null;
}

export interface StratemarkDataStore extends WorklistStore {
  saveDeck(deckId: string, record: StoredDeckRecord, expectedRevision?: number): Promise<void>;
  getDeck(deckId: string): Promise<StoredDeckRecord | null>;
  listDecks(userId?: string): Promise<Array<Record<string, unknown>>>;
  deleteDeck(deckId: string): Promise<void>;

  saveMarket(marketId: string, market: Record<string, unknown>, userId?: string, expectedRevision?: number): Promise<void>;
  getMarket(marketId: string): Promise<Record<string, unknown> | null>;
  listMarkets(userId?: string): Promise<Array<Record<string, unknown>>>;

  saveCard(userId: string, cardId: string, options?: { deckId?: string; deckRevision?: number }): Promise<void>;
  unsaveCard(userId: string, cardId: string): Promise<void>;
  listSavedCards(userId: string): Promise<Array<Record<string, unknown>>>;

  // Artifact methods (Issue #57)
  saveArtifactMetadata(meta: StoredArtifactMetadata): Promise<void>;
  getArtifactMetadata(artifactId: string): Promise<StoredArtifactMetadata | null>;
  listArtifactsForDeck(deckId: string): Promise<StoredArtifactMetadata[]>;
  deleteArtifactMetadata(artifactId: string): Promise<void>;
  deleteArtifactsForDeck(deckId: string): Promise<void>;

  // Share methods (Issue #57)
  saveShare(share: StoredShareRecord): Promise<void>;
  getShareByHash(tokenHash: string): Promise<StoredShareRecord | null>;
  listSharesForDeck(deckId: string): Promise<StoredShareRecord[]>;
  revokeShare(shareId: string, userId: string): Promise<boolean>;

  // Entitlement & Purge methods (Issue #57)
  getEntitlement(userId: string): Promise<EntitlementRecord | null>;
  saveEntitlement(entitlement: EntitlementRecord): Promise<void>;
  purgeUserData(userId: string): Promise<{
    deletedDecks: number;
    deletedMarkets: number;
    deletedCards: number;
    deletedShares: number;
    deletedArtifacts: number;
  }>;
}

export class MemoryDataStore implements StratemarkDataStore {
  private decks = new Map<string, StoredDeckRecord>();
  private markets = new Map<string, Record<string, unknown>>();
  private savedCards = new Map<string, { userId: string; cardId: string; data?: Record<string, unknown>; savedAt: string }>();
  private artifacts = new Map<string, StoredArtifactMetadata>();
  private shares = new Map<string, StoredShareRecord>();
  private entitlements = new Map<string, EntitlementRecord>();

  async saveDeck(deckId: string, record: StoredDeckRecord, expectedRevision?: number): Promise<void> {
    assertPayloadSize(record);
    const existing = this.decks.get(deckId);
    const currentRev = existing?.revision ?? 0;
    
    if (existing && existing.userId && record.userId && existing.userId !== record.userId) {
      const err = new Error('Not found') as Error & { status?: number };
      err.status = 404;
      throw err;
    }

    if (expectedRevision !== undefined && expectedRevision !== currentRev) {
      const err = new Error(`Revision mismatch: expected ${expectedRevision}, got ${currentRev}`) as Error & { status?: number };
      err.status = 409;
      throw err;
    }

    const nextRev = currentRev + 1;
    const now = new Date().toISOString();

    const newRecord = { 
      ...record, 
      userId: existing?.userId ?? record.userId,
      revision: nextRev,
      createdAt: existing?.createdAt ?? record.createdAt ?? now,
      updatedAt: now,
      refreshedAt: record.refreshedAt ?? now
    };
    
    this.decks.set(deckId, newRecord);
    if (record.market) {
      const marketId = String(record.market.id || record.market.marketId || deckId);
      await this.saveMarket(marketId, record.market, record.userId, expectedRevision);
    }
  }

  async getDeck(deckId: string): Promise<StoredDeckRecord | null> {
    const d = this.decks.get(deckId);
    return d ? { ...d } : null;
  }

  async listDecks(userId?: string): Promise<Array<Record<string, unknown>>> {
    const list: Array<Record<string, unknown>> = [];
    for (const [key, record] of this.decks.entries()) {
      if (!userId || record.userId === userId) {
        list.push({
          ...record.deck,
          id: record.deck.id ?? key,
          marketId: record.deck.marketId ?? key,
          title: record.deck.title ?? record.query ?? key,
          state: record.state ?? { status: 'ready' },
          query: record.query,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          refreshedAt: record.refreshedAt,
          engine: 'cloud',
        });
      }
    }
    return list;
  }

  async deleteDeck(deckId: string): Promise<void> {
    this.decks.delete(deckId);
    this.markets.delete(deckId);
    await this.deleteArtifactsForDeck(deckId);
    for (const [key, share] of this.shares.entries()) {
      if (share.deckId === deckId) {
        this.shares.delete(key);
      }
    }
  }

  // Artifact methods
  async saveArtifactMetadata(meta: StoredArtifactMetadata): Promise<void> {
    this.artifacts.set(meta.id, { ...meta });
  }

  async getArtifactMetadata(artifactId: string): Promise<StoredArtifactMetadata | null> {
    const meta = this.artifacts.get(artifactId);
    return meta ? { ...meta } : null;
  }

  async listArtifactsForDeck(deckId: string): Promise<StoredArtifactMetadata[]> {
    const list: StoredArtifactMetadata[] = [];
    for (const meta of this.artifacts.values()) {
      if (meta.deckId === deckId) {
        list.push({ ...meta });
      }
    }
    return list;
  }

  async deleteArtifactMetadata(artifactId: string): Promise<void> {
    this.artifacts.delete(artifactId);
  }

  async deleteArtifactsForDeck(deckId: string): Promise<void> {
    for (const [id, meta] of this.artifacts.entries()) {
      if (meta.deckId === deckId) {
        this.artifacts.delete(id);
      }
    }
  }

  // Share methods
  async saveShare(share: StoredShareRecord): Promise<void> {
    this.shares.set(share.tokenHash, { ...share });
  }

  async getShareByHash(tokenHash: string): Promise<StoredShareRecord | null> {
    const s = this.shares.get(tokenHash);
    return s ? { ...s } : null;
  }

  async listSharesForDeck(deckId: string): Promise<StoredShareRecord[]> {
    const list: StoredShareRecord[] = [];
    for (const s of this.shares.values()) {
      if (s.deckId === deckId) {
        list.push({ ...s });
      }
    }
    return list;
  }

  async revokeShare(shareId: string, userId: string): Promise<boolean> {
    for (const [hash, s] of this.shares.entries()) {
      if ((s.id === shareId || s.tokenHash === shareId) && s.userId === userId) {
        s.revoked = true;
        this.shares.set(hash, s);
        return true;
      }
    }
    return false;
  }

  // Entitlement & Purge methods
  async getEntitlement(userId: string): Promise<EntitlementRecord | null> {
    const ent = this.entitlements.get(userId);
    return ent ? { ...ent } : null;
  }

  async saveEntitlement(entitlement: EntitlementRecord): Promise<void> {
    this.entitlements.set(entitlement.userId, { ...entitlement });
  }

  async purgeUserData(userId: string): Promise<{
    deletedDecks: number;
    deletedMarkets: number;
    deletedCards: number;
    deletedShares: number;
    deletedArtifacts: number;
  }> {
    let deletedDecks = 0;
    let deletedMarkets = 0;
    let deletedCards = 0;
    let deletedShares = 0;
    let deletedArtifacts = 0;

    for (const [id, d] of this.decks.entries()) {
      if (d.userId === userId) {
        this.decks.delete(id);
        deletedDecks++;
      }
    }

    for (const [id, m] of this.markets.entries()) {
      if (m.userId === userId) {
        this.markets.delete(id);
        deletedMarkets++;
      }
    }

    for (const [id, c] of this.savedCards.entries()) {
      if (c.userId === userId) {
        this.savedCards.delete(id);
        deletedCards++;
      }
    }

    for (const [id, s] of this.shares.entries()) {
      if (s.userId === userId) {
        this.shares.delete(id);
        deletedShares++;
      }
    }

    for (const [id, a] of this.artifacts.entries()) {
      if (a.userId === userId) {
        this.artifacts.delete(id);
        deletedArtifacts++;
      }
    }

    this.entitlements.delete(userId);

    return {
      deletedDecks,
      deletedMarkets,
      deletedCards,
      deletedShares,
      deletedArtifacts,
    };
  }

  async saveMarket(marketId: string, market: Record<string, unknown>, userId?: string, expectedRevision?: number): Promise<void> {
    assertPayloadSize(market);
    const existing = this.markets.get(marketId);
    const currentRev = (existing?.revision as number) ?? 0;

    if (existing && existing.userId && userId && existing.userId !== userId) {
      const err = new Error('Not found') as Error & { status?: number };
      err.status = 404;
      throw err;
    }

    if (expectedRevision !== undefined && expectedRevision !== currentRev) {
      const err = new Error(`Revision mismatch: expected ${expectedRevision}, got ${currentRev}`) as Error & { status?: number };
      err.status = 409;
      throw err;
    }

    const nextRev = currentRev + 1;
    this.markets.set(marketId, { 
      ...market, 
      userId: (existing?.userId as string) ?? userId,
      revision: nextRev,
      updatedAt: new Date().toISOString()
    });
  }

  async getMarket(marketId: string): Promise<Record<string, unknown> | null> {
    const m = this.markets.get(marketId);
    return m ? { ...m } : null;
  }

  async listMarkets(userId?: string): Promise<Array<Record<string, unknown>>> {
    const list: Array<Record<string, unknown>> = [];
    for (const m of this.markets.values()) {
      if (!userId || m.userId === userId) {
        list.push(m);
      }
    }
    return list;
  }

  async saveCard(userId: string, cardId: string, options?: { deckId?: string; deckRevision?: number }): Promise<void> {
    const key = `${userId}_${cardId}`;
    this.savedCards.set(key, {
      userId,
      cardId,
      data: options as Record<string, unknown>,
      savedAt: new Date().toISOString(),
    });
  }

  async unsaveCard(userId: string, cardId: string): Promise<void> {
    const key = `${userId}_${cardId}`;
    this.savedCards.delete(key);
  }

  async listSavedCards(userId: string): Promise<Array<Record<string, unknown>>> {
    const list: Array<Record<string, unknown>> = [];
    for (const item of this.savedCards.values()) {
      if (item.userId === userId) {
        list.push({
          id: item.cardId,
          cardId: item.cardId,
          userId: item.userId,
          savedAt: item.savedAt,
          ...(item.data || {}),
        });
      }
    }
    return list;
  }

  // WorklistStore implementation for autonomous delta refresh
  async getDecks(): Promise<RefreshWorklistDeck[]> {
    const results: RefreshWorklistDeck[] = [];
    for (const [id, record] of this.decks.entries()) {
      if (record.watch !== true) continue;
      const status = (record.state as { status?: string })?.status;
      if (status !== 'ready') continue;
      const planName = typeof record.plan?.marketName === 'string' ? record.plan.marketName : '';
      const marketName = typeof record.market?.name === 'string' ? record.market.name : '';
      const query = record.query || planName || marketName || id;
      results.push({
        deckId: id,
        userId: record.userId || 'unknown',
        query,
        updatedAt: record.updatedAt || record.refreshedAt,
        cards: record.cards,
      });
    }
    return results;
  }

  async saveRefreshedDeck(deckId: string, data: { cards: CardWithCompany[]; refreshedAt: string }): Promise<void> {
    const existing = this.decks.get(deckId);
    if (existing) {
      existing.cards = data.cards;
      existing.refreshedAt = data.refreshedAt;
      existing.updatedAt = data.refreshedAt;
      this.decks.set(deckId, existing);
    }
  }
}

export interface FirestoreStoreOptions {
  projectId?: string;
  decksCollection?: string;
  marketsCollection?: string;
  savedCardsCollection?: string;
  artifactsCollection?: string;
  sharesCollection?: string;
  entitlementsCollection?: string;
  firestore?: Firestore;
}

export class FirestoreDataStore implements StratemarkDataStore {
  private firestore: Firestore;
  private decksCol: string;
  private marketsCol: string;
  private savedCardsCol: string;
  private artifactsCol: string;
  private sharesCol: string;
  private entitlementsCol: string;

  constructor(options?: FirestoreStoreOptions) {
    this.firestore =
      options?.firestore ??
      new Firestore({
        ...(options?.projectId ? { projectId: options.projectId } : {}),
        ignoreUndefinedProperties: true,
      });
    this.decksCol = options?.decksCollection ?? 'decks';
    this.marketsCol = options?.marketsCollection ?? 'markets';
    this.savedCardsCol = options?.savedCardsCollection ?? 'saved_cards';
    this.artifactsCol = options?.artifactsCollection ?? 'artifacts';
    this.sharesCol = options?.sharesCollection ?? 'shares';
    this.entitlementsCol = options?.entitlementsCollection ?? 'entitlements';
  }

  async saveDeck(deckId: string, record: StoredDeckRecord, expectedRevision?: number): Promise<void> {
    try {
      assertPayloadSize(record);
      await this.firestore.runTransaction(async (t) => {
        const deckRef = this.firestore.collection(this.decksCol).doc(deckId);
        const deckDoc = await t.get(deckRef);
        
        const currentRev = deckDoc.exists ? ((deckDoc.data()?.revision as number) ?? 0) : 0;
        
        if (deckDoc.exists && deckDoc.data()?.userId && record.userId && deckDoc.data()?.userId !== record.userId) {
          const err = new Error('Not found') as Error & { status?: number };
          err.status = 404;
          throw err;
        }
        
        if (expectedRevision !== undefined && currentRev !== expectedRevision) {
          throw new Error(`Revision mismatch: expected ${expectedRevision}, got ${currentRev}`);
        }
        
        const nextRev = currentRev + 1;
        const now = FieldValue.serverTimestamp();
        const resolvedUserId = deckDoc.exists ? deckDoc.data()?.userId : record.userId;
        
        const payload = {
          id: deckId,
          deckId,
          deck: record.deck,
          market: record.market,
          cards: record.cards,
          plan: record.plan ?? null,
          state: record.state ?? null,
          ...(record.researchTrace ? { researchTrace: record.researchTrace } : {}),
          query:
            record.query ??
            (typeof record.plan?.marketName === 'string' ? record.plan.marketName : '') ??
            (typeof record.market?.name === 'string' ? record.market.name : ''),
          ...(resolvedUserId ? { userId: resolvedUserId } : {}),
          ...(record.watch !== undefined ? { watch: record.watch } : {}),
          createdAt: deckDoc.exists ? deckDoc.data()?.createdAt : now,
          updatedAt: now,
          refreshedAt: record.refreshedAt ?? now,
          revision: nextRev,
          schemaVersion: 1,
        };
        
        t.set(deckRef, payload, { merge: true });

        if (record.market) {
          const marketId = String(record.market.id || record.market.marketId || deckId);
          const marketRef = this.firestore.collection(this.marketsCol).doc(marketId);
          t.set(marketRef, {
            ...record.market,
            id: marketId,
            marketId,
            ...(resolvedUserId ? { userId: resolvedUserId } : {}),
            updatedAt: now,
            revision: nextRev,
          }, { merge: true });
        }
      });
    } catch (e: unknown) {
      const err = e as Error & { status?: number };
      if (err.status === 404 || err.message === 'Not found') {
        err.status = 404;
        throw err;
      }
      if (err.message?.includes('Revision mismatch')) {
        err.status = 409;
        throw err;
      }
      if (err.message?.includes('exceeds the maximum allowed size')) {
        err.status = 413;
        throw err;
      }
      // "Production persistence failure returns an explicit 503"
      const wrapped = new Error(`Persistence failure: ${err.message}`) as Error & { status?: number };
      wrapped.status = 503;
      throw wrapped;
    }
  }

  async getDeck(deckId: string): Promise<StoredDeckRecord | null> {
    const docRef = this.firestore.collection(this.decksCol).doc(deckId);
    const snap = await docRef.get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (!data) return null;

    const tsToStr = (val: unknown) => {
      if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
        return (val as { toDate: () => Date }).toDate().toISOString();
      }
      return typeof val === 'string' ? val : undefined;
    };

    return {
      deck: (data.deck as Record<string, unknown>) ?? { id: deckId, marketId: deckId, engine: 'cloud' },
      market: (data.market as Record<string, unknown>) ?? { id: deckId, name: data.query ?? deckId },
      cards: Array.isArray(data.cards) ? (data.cards as CardWithCompany[]) : [],
      plan: data.plan as Record<string, unknown> | undefined,
      state: data.state as Record<string, unknown> | undefined,
      researchTrace: data.researchTrace as StoredDeckRecord['researchTrace'] | undefined,
      originalSourceAttempts: Array.isArray(data.originalSourceAttempts) ? data.originalSourceAttempts as StoredDeckRecord['originalSourceAttempts'] : undefined,
      userId: typeof data.userId === 'string' ? data.userId : undefined,
      createdAt: tsToStr(data.createdAt),
      updatedAt: tsToStr(data.updatedAt),
      refreshedAt: tsToStr(data.refreshedAt),
      query: typeof data.query === 'string' ? data.query : undefined,
      revision: typeof data.revision === 'number' ? data.revision : undefined,
    };
  }

  async listDecks(userId?: string): Promise<Array<Record<string, unknown>>> {
    let query: FirebaseFirestore.Query = this.firestore.collection(this.decksCol);
    if (userId) {
      query = query.where('userId', '==', userId);
    }
    const snap = await query.limit(100).get();
    const decks: Array<Record<string, unknown>> = [];
    const tsToStr = (val: unknown) => {
      if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
        return (val as { toDate: () => Date }).toDate().toISOString();
      }
      return typeof val === 'string' ? val : undefined;
    };

    snap.forEach((doc) => {
      const data = doc.data();
      if (data?.deck) {
        decks.push({
          ...(data.deck as Record<string, unknown>),
          id: data.deck.id ?? doc.id,
          marketId: data.deck.marketId ?? doc.id,
          title: data.deck.title ?? data.query ?? doc.id,
          state: data.state ?? { status: 'ready' },
          query: data.query,
          createdAt: tsToStr(data.createdAt),
          updatedAt: tsToStr(data.updatedAt),
          refreshedAt: tsToStr(data.refreshedAt),
          engine: 'cloud',
        });
      } else if (data) {
        decks.push({
          id: doc.id,
          marketId: doc.id,
          title: data.query ?? doc.id,
          state: data.state ?? { status: 'ready' },
          query: data.query,
          createdAt: tsToStr(data.createdAt),
          updatedAt: tsToStr(data.updatedAt),
          refreshedAt: tsToStr(data.refreshedAt),
          engine: 'cloud',
        });
      }
    });
    return decks;
  }

  async deleteDeck(deckId: string): Promise<void> {
    // Cascade: delete deck, market, all associated shares, and all associated artifact metadata
    const [sharesSnap, artifactsSnap] = await Promise.all([
      this.firestore.collection(this.sharesCol).where('deckId', '==', deckId).get(),
      this.firestore.collection(this.artifactsCol).where('deckId', '==', deckId).get(),
    ]);

    const batch = this.firestore.batch();
    batch.delete(this.firestore.collection(this.decksCol).doc(deckId));
    batch.delete(this.firestore.collection(this.marketsCol).doc(deckId));
    sharesSnap.forEach((doc) => batch.delete(doc.ref));
    artifactsSnap.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  async saveMarket(marketId: string, market: Record<string, unknown>, userId?: string, expectedRevision?: number): Promise<void> {
    try {
      assertPayloadSize(market);
      await this.firestore.runTransaction(async (t) => {
        const docRef = this.firestore.collection(this.marketsCol).doc(marketId);
        const docSnap = await t.get(docRef);
        const currentRev = docSnap.exists ? ((docSnap.data()?.revision as number) ?? 0) : 0;
        
        if (docSnap.exists && docSnap.data()?.userId && userId && docSnap.data()?.userId !== userId) {
          const err = new Error('Not found') as Error & { status?: number };
          err.status = 404;
          throw err;
        }

        if (expectedRevision !== undefined && currentRev !== expectedRevision) {
          throw new Error(`Revision mismatch: expected ${expectedRevision}, got ${currentRev}`);
        }
        
        const nextRev = currentRev + 1;
        const resolvedUserId = docSnap.exists ? docSnap.data()?.userId : userId;
        t.set(
          docRef,
          {
            ...market,
            id: marketId,
            marketId,
            ...(resolvedUserId ? { userId: resolvedUserId } : {}),
            updatedAt: FieldValue.serverTimestamp(),
            revision: nextRev,
          },
          { merge: true },
        );
      });
    } catch (e: unknown) {
      const err = e as Error & { status?: number };
      if (err.status === 404 || err.message === 'Not found') {
        err.status = 404;
        throw err;
      }
      if (err.message?.includes('Revision mismatch')) {
        err.status = 409;
        throw err;
      }
      const wrapped = new Error(`Persistence failure: ${err.message}`) as Error & { status?: number };
      wrapped.status = 503;
      throw wrapped;
    }
  }

  async getMarket(marketId: string): Promise<Record<string, unknown> | null> {
    const snap = await this.firestore.collection(this.marketsCol).doc(marketId).get();
    if (!snap.exists) return null;
    return (snap.data() as Record<string, unknown>) ?? null;
  }

  async listMarkets(userId?: string): Promise<Array<Record<string, unknown>>> {
    let query: FirebaseFirestore.Query = this.firestore.collection(this.marketsCol);
    if (userId) {
      query = query.where('userId', '==', userId);
    }
    const snap = await query.limit(100).get();
    const markets: Array<Record<string, unknown>> = [];
    snap.forEach((doc) => {
      const data = doc.data();
      if (data) {
        markets.push(data as Record<string, unknown>);
      }
    });
    return markets;
  }

  async saveCard(userId: string, cardId: string, options?: { deckId?: string; deckRevision?: number }): Promise<void> {
    const docId = `${userId}_${cardId}`;
    const docRef = this.firestore.collection(this.savedCardsCol).doc(docId);
    await docRef.set(
      {
        userId,
        cardId,
        savedAt: FieldValue.serverTimestamp(),
        ...(options?.deckId ? { deckId: options.deckId } : {}),
        ...(options?.deckRevision !== undefined ? { deckRevision: options.deckRevision } : {}),
      },
      { merge: true },
    );
  }

  async unsaveCard(userId: string, cardId: string): Promise<void> {
    const docId = `${userId}_${cardId}`;
    await this.firestore.collection(this.savedCardsCol).doc(docId).delete();
  }

  async listSavedCards(userId: string): Promise<Array<Record<string, unknown>>> {
    const query = this.firestore
      .collection(this.savedCardsCol)
      .where('userId', '==', userId)
      .limit(200);
    const snap = await query.get();
    const cards: Array<Record<string, unknown>> = [];
    snap.forEach((doc) => {
      const data = doc.data();
      if (data) {
        cards.push({
          id: data.cardId,
          cardId: data.cardId,
          userId: data.userId,
          savedAt: data.savedAt,
          ...data,
        });
      }
    });
    return cards;
  }

  // WorklistStore implementation
  async getDecks(): Promise<RefreshWorklistDeck[]> {
    const snap = await this.firestore
      .collection(this.decksCol)
      .where('watch', '==', true)
      .limit(50)
      .get();
    const decks: RefreshWorklistDeck[] = [];
    const tsToStr = (val: unknown) => {
      if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
        return (val as { toDate: () => Date }).toDate().toISOString();
      }
      return typeof val === 'string' ? val : undefined;
    };

    snap.forEach((doc) => {
      const data = doc.data();
      const status = (data?.state as { status?: string } | undefined)?.status ?? (data?.deck as { status?: string } | undefined)?.status;
      if (status !== 'ready') return;
      if (data && (data.query || data.title || data.deckId || data.id)) {
        decks.push({
          deckId: String(data.deckId || doc.id),
          userId: String(data.userId || 'unknown'),
          query: String(data.query || data.title || doc.id),
          updatedAt: tsToStr(data.updatedAt) ?? tsToStr(data.refreshedAt),
          cards: Array.isArray(data.cards) ? data.cards : [],
        });
      }
    });
    return decks;
  }

  async saveRefreshedDeck(deckId: string, data: { cards: CardWithCompany[]; refreshedAt: string }): Promise<void> {
    await this.firestore.runTransaction(async (t) => {
      const deckRef = this.firestore.collection(this.decksCol).doc(deckId);
      const deckDoc = await t.get(deckRef);
      if (!deckDoc.exists) return; // or throw
      const now = FieldValue.serverTimestamp();
      
      const currentRev = (deckDoc.data()?.revision as number) ?? 0;
      t.set(
        deckRef,
        {
          cards: data.cards,
          updatedAt: now,
          refreshedAt: now,
          revision: currentRev + 1,
        },
        { merge: true },
      );
    });
  }

  // Artifact methods (Issue #57)
  async saveArtifactMetadata(meta: StoredArtifactMetadata): Promise<void> {
    const docRef = this.firestore.collection(this.artifactsCol).doc(meta.id);
    await docRef.set({
      ...meta,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async getArtifactMetadata(artifactId: string): Promise<StoredArtifactMetadata | null> {
    const snap = await this.firestore.collection(this.artifactsCol).doc(artifactId).get();
    if (!snap.exists) return null;
    return (snap.data() as StoredArtifactMetadata) ?? null;
  }

  async listArtifactsForDeck(deckId: string): Promise<StoredArtifactMetadata[]> {
    const snap = await this.firestore
      .collection(this.artifactsCol)
      .where('deckId', '==', deckId)
      .limit(100)
      .get();
    const list: StoredArtifactMetadata[] = [];
    snap.forEach((doc) => {
      const data = doc.data();
      if (data) list.push(data as StoredArtifactMetadata);
    });
    return list;
  }

  async deleteArtifactMetadata(artifactId: string): Promise<void> {
    await this.firestore.collection(this.artifactsCol).doc(artifactId).delete();
  }

  async deleteArtifactsForDeck(deckId: string): Promise<void> {
    const snap = await this.firestore
      .collection(this.artifactsCol)
      .where('deckId', '==', deckId)
      .get();
    const batch = this.firestore.batch();
    snap.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  // Share methods (Issue #57)
  async saveShare(share: StoredShareRecord): Promise<void> {
    const docRef = this.firestore.collection(this.sharesCol).doc(share.tokenHash);
    await docRef.set({
      ...share,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async getShareByHash(tokenHash: string): Promise<StoredShareRecord | null> {
    const snap = await this.firestore.collection(this.sharesCol).doc(tokenHash).get();
    if (!snap.exists) return null;
    return (snap.data() as StoredShareRecord) ?? null;
  }

  async listSharesForDeck(deckId: string): Promise<StoredShareRecord[]> {
    const snap = await this.firestore
      .collection(this.sharesCol)
      .where('deckId', '==', deckId)
      .limit(50)
      .get();
    const list: StoredShareRecord[] = [];
    snap.forEach((doc) => {
      const data = doc.data();
      if (data) list.push(data as StoredShareRecord);
    });
    return list;
  }

  async revokeShare(shareId: string, userId: string): Promise<boolean> {
    // Search by document ID (hash) or id field
    let docRef = this.firestore.collection(this.sharesCol).doc(shareId);
    let docSnap = await docRef.get();
    if (!docSnap.exists) {
      const querySnap = await this.firestore
        .collection(this.sharesCol)
        .where('id', '==', shareId)
        .where('userId', '==', userId)
        .limit(1)
        .get();
      if (querySnap.empty || !querySnap.docs[0]) return false;
      docRef = querySnap.docs[0].ref;
      docSnap = querySnap.docs[0];
    }
    const data = docSnap.data();
    if (!data || data.userId !== userId) return false;
    await docRef.set({ revoked: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  }

  // Entitlement & Purge methods (Issue #57)
  async getEntitlement(userId: string): Promise<EntitlementRecord | null> {
    const snap = await this.firestore.collection(this.entitlementsCol).doc(userId).get();
    if (!snap.exists) return null;
    return (snap.data() as EntitlementRecord) ?? null;
  }

  async saveEntitlement(entitlement: EntitlementRecord): Promise<void> {
    const docRef = this.firestore.collection(this.entitlementsCol).doc(entitlement.userId);
    await docRef.set({
      ...entitlement,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async purgeUserData(userId: string): Promise<{
    deletedDecks: number;
    deletedMarkets: number;
    deletedCards: number;
    deletedShares: number;
    deletedArtifacts: number;
  }> {
    const batch = this.firestore.batch();
    let deletedDecks = 0;
    let deletedMarkets = 0;
    let deletedCards = 0;
    let deletedShares = 0;
    let deletedArtifacts = 0;

    const [decksSnap, marketsSnap, cardsSnap, sharesSnap, artifactsSnap] = await Promise.all([
      this.firestore.collection(this.decksCol).where('userId', '==', userId).get(),
      this.firestore.collection(this.marketsCol).where('userId', '==', userId).get(),
      this.firestore.collection(this.savedCardsCol).where('userId', '==', userId).get(),
      this.firestore.collection(this.sharesCol).where('userId', '==', userId).get(),
      this.firestore.collection(this.artifactsCol).where('userId', '==', userId).get(),
    ]);

    decksSnap.forEach((doc) => {
      batch.delete(doc.ref);
      deletedDecks++;
    });
    marketsSnap.forEach((doc) => {
      batch.delete(doc.ref);
      deletedMarkets++;
    });
    cardsSnap.forEach((doc) => {
      batch.delete(doc.ref);
      deletedCards++;
    });
    sharesSnap.forEach((doc) => {
      batch.delete(doc.ref);
      deletedShares++;
    });
    artifactsSnap.forEach((doc) => {
      batch.delete(doc.ref);
      deletedArtifacts++;
    });

    const entRef = this.firestore.collection(this.entitlementsCol).doc(userId);
    batch.delete(entRef);

    await batch.commit();

    return {
      deletedDecks,
      deletedMarkets,
      deletedCards,
      deletedShares,
      deletedArtifacts,
    };
  }
}

/**
 * Creates the appropriate Stratemark data store based on environment and options.
 */
export function createDataStore(
  env: ServiceEnv,
  options?: {
    store?: StratemarkDataStore;
    firestore?: Firestore;
    forceMemory?: boolean;
    allowMemoryFallback?: boolean;
  },
): StratemarkDataStore {
  if (options?.store) {
    return options.store;
  }

  if (options?.forceMemory) {
    return new MemoryDataStore();
  }

  const projectId =
    env.vertex?.project ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.FIRESTORE_PROJECT_ID;

  const hasFirestoreEnv = Boolean(projectId || process.env.FIRESTORE_EMULATOR_HOST);

  if (hasFirestoreEnv || options?.firestore) {
    return new FirestoreDataStore({
      projectId,
      firestore: options?.firestore,
    });
  }

  // In production (Cloud Run), never silently fall back to memory — data would
  // vanish on restart. Only allow memory fallback with explicit opt-in.
  if (!options?.allowMemoryFallback) {
    throw new Error(
      'No Firestore configuration found. Set GOOGLE_CLOUD_PROJECT or pass forceMemory=true for development.',
    );
  }

  return new MemoryDataStore();
}
