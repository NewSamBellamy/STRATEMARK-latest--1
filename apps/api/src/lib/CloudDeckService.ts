import type {
  StratemarkDataStore,
  StoredDeckRecord,
  StoredArtifactMetadata,
  StoredShareRecord,
} from './firestoreStore';
import type { TasksAdapter, TaskPayload } from './CloudTasksAdapter';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';
import * as crypto from 'node:crypto';
import { coalesceOriginalSources, type OriginalSourceServices } from '@mi/research';
import { retrieveOriginalSource } from './original-source';

export interface AuthAdapter {
  verifyIdToken(token: string): Promise<string | null>;
}

export interface EntitlementAdapter {
  hasActiveEntitlement(uid: string): Promise<boolean>;
}

export interface ArtifactStorageAdapter {
  uploadArtifact(path: string, buffer: Buffer, mimeType: string): Promise<void>;
  downloadArtifact(path: string): Promise<Buffer | null>;
  deleteArtifact(path: string): Promise<void>;
}

export class MemoryArtifactStorage implements ArtifactStorageAdapter {
  private files = new Map<string, { buffer: Buffer; mimeType: string }>();

  async uploadArtifact(path: string, buffer: Buffer, mimeType: string): Promise<void> {
    this.files.set(path, { buffer, mimeType });
  }

  async downloadArtifact(path: string): Promise<Buffer | null> {
    return this.files.get(path)?.buffer ?? null;
  }

  async deleteArtifact(path: string): Promise<void> {
    this.files.delete(path);
  }
}

export class FirebaseAdapter implements AuthAdapter, EntitlementAdapter {
  constructor() {
    if (getApps().length === 0) {
      initializeApp();
    }
  }

  async verifyIdToken(token: string): Promise<string | null> {
    try {
      if (!token || typeof token !== 'string') return null;
      const trimmed = token.trim();
      if (trimmed.length < 5 || trimmed === 'demo-user-token' || trimmed.startsWith('demo-')) {
        return null;
      }
      const decoded = await getAuth().verifyIdToken(trimmed);
      return decoded?.uid?.trim() || null;
    } catch {
      return null;
    }
  }

  async hasActiveEntitlement(uid: string): Promise<boolean> {
    try {
      if (!uid || typeof uid !== 'string') return false;
      const db = getFirestore();
      const doc = await db.collection('entitlements').doc(uid).get();
      if (!doc.exists) return false; // Cloud work requires an explicit entitlement record.
      const data = doc.data();
      const status = data?.status;
      const tier = data?.tier;
      if (status === 'canceled' || status === 'expired' || status === 'suspended') {
        return false;
      }
      if (tier === 'free') {
        return false;
      }
      return true;
    } catch {
      return false; // Paid work must fail closed when entitlement is unknown.
    }
  }
}

export class MockFirebaseAdapter implements AuthAdapter, EntitlementAdapter {
  async verifyIdToken(token: string): Promise<string | null> {
    if (token === 'valid_token') return 'user_123';
    if (token === 'valid_pro_token') return 'user_pro';
    if (token === 'valid_free_token') return 'user_free';
    if (token === 'valid_other_user') return 'user_999';
    return null;
  }

  async hasActiveEntitlement(uid: string): Promise<boolean> {
    if (uid === 'user_123' || uid === 'user_pro') return true;
    return false;
  }
}

export class CloudDeckService {
  private artifactStorage: ArtifactStorageAdapter;

  constructor(
    private readonly store: StratemarkDataStore,
    private readonly auth: AuthAdapter,
    private readonly entitlement: EntitlementAdapter,
    private readonly tasks?: TasksAdapter,
    artifactStorage?: ArtifactStorageAdapter,
  ) {
    this.artifactStorage = artifactStorage ?? new MemoryArtifactStorage();
  }

  async authenticate(token?: string): Promise<string | null> {
    if (!token || typeof token !== 'string') return null;
    const trimmed = token.trim();
    if (!trimmed) return null;
    if (trimmed.includes('@') || trimmed === 'demo-user-token' || trimmed.startsWith('demo-')) {
      return null;
    }
    const uid = await this.auth.verifyIdToken(trimmed);
    if (!uid || typeof uid !== 'string' || uid.includes('@') || uid.trim().length === 0) {
      return null;
    }
    return uid.trim();
  }

  async checkEntitlement(uid: string): Promise<boolean> {
    if (!uid || typeof uid !== 'string') return false;
    return this.entitlement.hasActiveEntitlement(uid);
  }

  getOriginalSources(uid: string, deckId: string, read: OriginalSourceServices['retrieve'] = (url, scope) => retrieveOriginalSource(url, undefined, scope)): OriginalSourceServices {
    const retrieve = coalesceOriginalSources(read);
    const authorize = async () => {
      if (!await this.getDeck(uid, deckId)) throw new Error('Deck not found');
      if (!await this.checkEntitlement(uid)) throw new Error('Entitlement lost');
    };
    return {
      retrieve: async (url, scope) => { await authorize(); return retrieve(url, scope); },
      save: async (attempt) => { await authorize(); await this.store.saveCompanyOriginal(uid, deckId, attempt); },
      list: async ({ companyId, metricType, limit = 20 }) => {
        const deck = await this.getDeck(uid, deckId);
        if (!deck) return [];
        const count = Number.isFinite(limit) ? Math.max(0, Math.min(100, Math.floor(limit))) : 20;
        if (!count) return [];
        return structuredClone((deck.companySourceAttempts ?? [])
          .filter((entry) => entry.companyId === companyId && (!metricType || entry.metricType === metricType))
          .slice(-count).reverse());
      },
    };
  }

  async checkEntitlementStatus(uid: string): Promise<{
    isEntitled: boolean;
    isReadOnlyRetention: boolean;
    retentionUntil?: string | null;
  }> {
    if (!uid) {
      return { isEntitled: false, isReadOnlyRetention: false };
    }

    const storedEnt = await this.store.getEntitlement(uid);
    if (storedEnt) {
      const isActive = storedEnt.status === 'active' || storedEnt.status === 'trialing';
      const isPro = storedEnt.tier === 'pro' || storedEnt.tier === 'growth' || storedEnt.tier === 'max';
      if (isActive && isPro) {
        return { isEntitled: true, isReadOnlyRetention: false };
      }

      if (storedEnt.retentionUntil) {
        const retentionDate = new Date(storedEnt.retentionUntil).getTime();
        const now = Date.now();
        if (retentionDate > now) {
          return {
            isEntitled: false,
            isReadOnlyRetention: true,
            retentionUntil: storedEnt.retentionUntil,
          };
        }
      }

      return { isEntitled: false, isReadOnlyRetention: false };
    }

    const isEntitled = await this.checkEntitlement(uid);
    return { isEntitled, isReadOnlyRetention: false };
  }

  async getMarkets(uid: string) {
    if (!uid) return [];
    return this.store.listMarkets(uid);
  }

  async getMarket(uid: string, marketId: string) {
    if (!uid || !marketId) return null;
    const market = await this.store.getMarket(marketId);
    if (!market || market.userId !== uid) return null; // 404 anti-enumeration
    return market;
  }

  async getDecks(uid: string) {
    if (!uid) return [];
    return this.store.listDecks(uid);
  }

  async getSavedCards(uid: string) {
    if (!uid) return [];
    return this.store.listSavedCards(uid);
  }

  async saveCard(uid: string, cardId: string, options?: { deckId?: string; deckRevision?: number }) {
    if (!uid || !cardId) throw new Error('Missing parameters');
    await this.store.saveCard(uid, cardId, options);
  }

  async unsaveCard(uid: string, cardId: string) {
    if (!uid || !cardId) return;
    await this.store.unsaveCard(uid, cardId);
  }

  async getDeck(uid: string, deckId: string) {
    if (!uid || !deckId) return null;
    const deck = await this.store.getDeck(deckId);
    if (!deck) return null;
    if (deck.userId !== uid) return null; // cross-owner 404
    return deck;
  }

  async enqueueCreation(payload: TaskPayload): Promise<{ deckId: string }> {
    if (!payload.userId) {
      throw new Error('Unauthorized: Missing userId');
    }
    const isEntitled = await this.checkEntitlement(payload.userId);
    if (!isEntitled) {
      throw new Error('Unauthorized: Active entitlement required for cloud operations');
    }
    if (!this.tasks) {
      throw new Error('Cloud Tasks is not configured');
    }
    
    const requestedDeckId = payload.deckId;
    // A changed plan or Market Scope creates a new deck rather than mutating the old operation
    const existing = await this.getDeck(payload.userId, payload.deckId);
    if (existing) {
      const status = existing.state?.status as string | undefined;
      // Idempotent no-op: skip if already in-progress (running) or complete (ready).
      // Allow partial (interrupted creation) to be re-enqueued for resume.
      if (status === 'running' || status === 'ready') {
        return { deckId: payload.deckId }; // Already being processed or complete
      }
      if (existing.plan) {
        const existingMarket = (existing.plan as { marketName?: string })?.marketName;
        if (existingMarket && payload.plan?.marketName && existingMarket.toLowerCase().trim() !== payload.plan.marketName.toLowerCase().trim()) {
          payload.deckId = `deck_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        }
      }
    }

    const resumeCards =
      existing &&
      payload.deckId === requestedDeckId &&
      existing.state?.status === 'partial'
        ? existing.cards
        : [];

    // Save initial running state
    const now = new Date().toISOString();
    const marketObj = {
      id: payload.deckId,
      marketId: payload.deckId,
      name: payload.plan.marketName,
      scopeDefinition: { vertical: payload.plan.vertical, geography: payload.plan.geography, notes: payload.plan.notes },
      refreshCadence: 'weekly',
      createdAt: now,
      engine: 'cloud',
    };
    const deckObj = {
      id: payload.deckId,
      marketId: payload.deckId,
      createdAt: now,
      lastRefreshedAt: now,
      engine: 'cloud',
    };
    
    await this.saveDeck(payload.userId, payload.deckId, {
      deck: deckObj,
      market: marketObj,
      cards: resumeCards,
      plan: payload.plan,
      state: { status: 'running' },
      userId: payload.userId,
      query: payload.plan.marketName,
      watch: payload.watch,
    });

    try {
      await this.tasks.enqueueDeckCreation(payload);
    } catch (error: unknown) {
      const current = await this.getDeck(payload.userId, payload.deckId);
      if (current) {
        const message = error instanceof Error ? error.message : String(error);
        await this.saveDeck(
          payload.userId,
          payload.deckId,
          {
            ...current,
            state: { status: 'failed', error: message.slice(0, 500) },
          },
          current.revision,
        );
      }
      throw error;
    }
    return { deckId: payload.deckId };
  }

  async deleteDeck(uid: string, deckId: string) {
    const deck = await this.getDeck(uid, deckId);
    if (!deck) return false;
    
    // Remove stored artifacts files
    const artifacts = await this.store.listArtifactsForDeck(deckId);
    for (const art of artifacts) {
      await this.artifactStorage.deleteArtifact(art.storagePath);
    }

    await this.store.deleteDeck(deckId);
    return true;
  }
  
  async saveDeck(uid: string, deckId: string, record: StoredDeckRecord, expectedRevision?: number) {
    if (!uid) throw new Error('Unauthorized');
    const existing = await this.store.getDeck(deckId);
    if (existing && existing.userId && existing.userId !== uid) {
      throw new Error('Not found'); // 404 anti-enumeration
    }
    await this.store.saveDeck(deckId, {
      ...record,
      userId: uid // Immutable owner UID
    }, expectedRevision);
  }

  // Explicit Deck Sharing (Issue #57)
  async createShare(
    uid: string,
    deckId: string,
    options?: { expiresInDays?: number },
  ): Promise<{ token: string; shareId: string; expiresAt?: string | null }> {
    const deck = await this.getDeck(uid, deckId);
    if (!deck) {
      throw new Error('Deck not found');
    }

    const rawToken = `share_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const shareId = `sh_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;

    let expiresAt: string | null = null;
    if (options?.expiresInDays !== undefined) {
      expiresAt = new Date(Date.now() + options.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    }

    const cleanDeckSnapshot: Record<string, unknown> = {
      id: deckId,
      deck: { ...deck.deck, userId: undefined },
      market: { ...deck.market, userId: undefined },
      cards: deck.cards ?? [],
      revision: deck.revision ?? 1,
    };

    const shareRecord: StoredShareRecord = {
      id: shareId,
      tokenHash,
      deckId,
      userId: uid,
      deckRevision: deck.revision ?? 1,
      deckSnapshot: cleanDeckSnapshot,
      createdAt: new Date().toISOString(),
      expiresAt,
      revoked: false,
    };

    await this.store.saveShare(shareRecord);

    return {
      token: rawToken,
      shareId,
      expiresAt,
    };
  }

  async getSharedDeck(rawToken: string): Promise<{
    deck: Record<string, unknown>;
    market: Record<string, unknown>;
    cards: unknown[];
    revision: number;
  } | null> {
    if (!rawToken || typeof rawToken !== 'string') return null;
    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
    const share = await this.store.getShareByHash(tokenHash);
    if (!share || share.revoked) return null;

    if (share.expiresAt) {
      const exp = new Date(share.expiresAt).getTime();
      if (exp < Date.now()) return null;
    }

    const snap = share.deckSnapshot as {
      deck?: Record<string, unknown>;
      market?: Record<string, unknown>;
      cards?: unknown[];
      revision?: number;
    };

    return {
      deck: snap.deck ?? { id: share.deckId },
      market: snap.market ?? { id: share.deckId },
      cards: snap.cards ?? [],
      revision: share.deckRevision ?? 1,
    };
  }

  async revokeShare(uid: string, shareId: string): Promise<boolean> {
    if (!uid || !shareId) return false;
    return this.store.revokeShare(shareId, uid);
  }

  // Cloud Artifacts Storage (Issue #57)
  async saveArtifact(
    uid: string,
    deckId: string,
    file: { filename: string; mimeType: string; buffer: Buffer },
  ): Promise<StoredArtifactMetadata> {
    const deck = await this.getDeck(uid, deckId);
    if (!deck) {
      throw new Error('Deck not found');
    }

    const artifactId = `art_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
    const storagePath = `users/${uid}/decks/${deckId}/artifacts/${artifactId}_${file.filename}`;

    await this.artifactStorage.uploadArtifact(storagePath, file.buffer, file.mimeType);

    const meta: StoredArtifactMetadata = {
      id: artifactId,
      deckId,
      userId: uid,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.buffer.byteLength,
      storagePath,
      revision: deck.revision ?? 1,
      createdAt: new Date().toISOString(),
    };

    await this.store.saveArtifactMetadata(meta);
    return meta;
  }

  async getArtifact(
    uid: string,
    artifactId: string,
  ): Promise<{ metadata: StoredArtifactMetadata; buffer: Buffer } | null> {
    if (!uid || !artifactId) return null;
    const meta = await this.store.getArtifactMetadata(artifactId);
    if (!meta || meta.userId !== uid) {
      return null; // 404 anti-enumeration
    }

    const buffer = await this.artifactStorage.downloadArtifact(meta.storagePath);
    if (!buffer) return null;

    return { metadata: meta, buffer };
  }

  // Account Purge (Issue #57)
  async purgeAccount(uid: string): Promise<{ purged: boolean; details: Record<string, number> }> {
    if (!uid) throw new Error('Unauthorized');
    
    // Purge physical files for all user artifacts
    const userDecks = await this.getDecks(uid);
    for (const d of userDecks) {
      const deckId = String(d.id || d.deckId);
      const artifacts = await this.store.listArtifactsForDeck(deckId);
      for (const art of artifacts) {
        await this.artifactStorage.deleteArtifact(art.storagePath);
      }
    }

    const details = await this.store.purgeUserData(uid);
    return { purged: true, details };
  }
}
