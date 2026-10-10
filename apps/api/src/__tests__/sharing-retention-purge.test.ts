import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryDataStore } from '../lib/firestoreStore';
import { CloudDeckService, MockFirebaseAdapter } from '../lib/CloudDeckService';

describe('Ticket #57 — Cloud Artifacts, Sharing, Retention, and Purge', () => {
  let store: MemoryDataStore;
  let auth: MockFirebaseAdapter;
  let service: CloudDeckService;

  beforeEach(() => {
    store = new MemoryDataStore();
    auth = new MockFirebaseAdapter();
    service = new CloudDeckService(store, auth, auth);
  });

  describe('Explicit Deck Shares with Token Hashing & Expiry', () => {
    it('creates a revocable share with a cryptographically hashed token and frozen ready snapshot', async () => {
      const uid = 'user_123';
      const deckId = 'deck_share_1';

      // Seed a ready deck
      await service.saveDeck(uid, deckId, {
        deck: { id: deckId, title: 'AI Strategy Report', revision: 3 },
        market: { id: deckId, name: 'AI Strategy' },
        cards: [
          {
            card: {
              id: 'c1',
              deckId,
              title: 'OpenAI',
              cardType: 'company',
              tier: 1,
              tierReason: null,
              companyId: 'comp_1',
              summary: 'Leading AI lab',
              keyPoints: [],
              citations: [],
              createdAt: new Date().toISOString(),
            },
            company: {
              id: 'comp_1',
              name: 'OpenAI',
              oneLiner: 'AI research lab',
              logoUrl: null,
              hqLocation: 'San Francisco, CA',
              websiteUrl: 'https://openai.com',
              brandTheme: null,
            },
            metrics: [],
            viceClaims: [],
          },
        ],
        state: { status: 'ready' },
      });

      // Create share
      const share = await service.createShare(uid, deckId, { expiresInDays: 7 });
      expect(share.token).toBeDefined();
      expect(typeof share.token).toBe('string');
      expect(share.token.length).toBeGreaterThanOrEqual(32);
      expect(share.expiresAt).toBeDefined();

      // Database must only store tokenHash, never raw token
      const storedShares = await store.listSharesForDeck(deckId);
      expect(storedShares).toHaveLength(1);
      expect(storedShares[0]?.tokenHash).not.toEqual(share.token);
      expect(storedShares[0]?.revoked).toBe(false);

      // Recipient accesses shared deck via raw token
      const sharedView = await service.getSharedDeck(share.token);
      expect(sharedView).not.toBeNull();
      expect(sharedView?.deck.title).toBe('AI Strategy Report');
      expect(sharedView?.cards).toHaveLength(1);
      // Read-only snapshot does not expose owner internal fields
      expect((sharedView?.deck as Record<string, unknown>).userId).toBeUndefined();
    });

    it('rejects revoked shares and expired shares', async () => {
      const uid = 'user_123';
      const deckId = 'deck_share_exp';

      await service.saveDeck(uid, deckId, {
        deck: { id: deckId, title: 'Expiring Deck' },
        market: { id: deckId, name: 'Expiring Market' },
        cards: [],
        state: { status: 'ready' },
      });

      // 1. Revocation test
      const share = await service.createShare(uid, deckId);
      const viewBefore = await service.getSharedDeck(share.token);
      expect(viewBefore).not.toBeNull();

      const revoked = await service.revokeShare(uid, share.shareId);
      expect(revoked).toBe(true);

      const viewAfter = await service.getSharedDeck(share.token);
      expect(viewAfter).toBeNull();

      // Non-owner cannot revoke
      const share2 = await service.createShare(uid, deckId);
      const otherUserRevoke = await service.revokeShare('user_attacker', share2.shareId);
      expect(otherUserRevoke).toBe(false);

      // 2. Expiry test
      const expiredShare = await service.createShare(uid, deckId, { expiresInDays: -1 });
      const viewExpired = await service.getSharedDeck(expiredShare.token);
      expect(viewExpired).toBeNull();
    });
  });

  describe('Cloud Artifacts Storage & Deck Lifecycle', () => {
    it('stores private artifact metadata and allows owner-scoped access', async () => {
      const uid = 'user_123';
      const deckId = 'deck_art_1';

      await service.saveDeck(uid, deckId, {
        deck: { id: deckId, title: 'Artifact Deck' },
        market: { id: deckId, name: 'Artifact Market' },
        cards: [],
      });

      const artifact = await service.saveArtifact(uid, deckId, {
        filename: 'landscape-chart.png',
        mimeType: 'image/png',
        buffer: Buffer.from('fake-image-bytes'),
      });

      expect(artifact.id).toBeDefined();
      expect(artifact.userId).toBe(uid);
      expect(artifact.deckId).toBe(deckId);
      expect(artifact.sizeBytes).toBe(16);

      // Owner can retrieve artifact
      const fetched = await service.getArtifact(uid, artifact.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.buffer.toString('utf8')).toBe('fake-image-bytes');

      // Cross-owner access returns null (404 anti-enumeration)
      const crossFetch = await service.getArtifact('user_attacker', artifact.id);
      expect(crossFetch).toBeNull();
    });

    it('removes associated artifacts when deck is deleted', async () => {
      const uid = 'user_123';
      const deckId = 'deck_to_del_art';

      await service.saveDeck(uid, deckId, {
        deck: { id: deckId, title: 'Del Deck' },
        market: { id: deckId, name: 'Del Market' },
        cards: [],
      });

      const art = await service.saveArtifact(uid, deckId, {
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('pdf-bytes'),
      });

      await service.deleteDeck(uid, deckId);

      // Artifact should be gone
      const fetched = await service.getArtifact(uid, art.id);
      expect(fetched).toBeNull();
    });
  });

  describe('Entitlement Retention & Account Purge', () => {
    it('enforces 30-day read-only retention upon entitlement loss', async () => {
      const uid = 'user_retention';

      // 1. Entitled active
      await store.saveEntitlement({
        userId: uid,
        status: 'active',
        tier: 'pro',
      });
      const status1 = await service.checkEntitlementStatus(uid);
      expect(status1.isEntitled).toBe(true);
      expect(status1.isReadOnlyRetention).toBe(false);

      // 2. Canceled 5 days ago (within 30 days) -> read-only retention
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      const retentionDate = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString();
      await store.saveEntitlement({
        userId: uid,
        status: 'canceled',
        tier: 'pro',
        canceledAt: fiveDaysAgo,
        retentionUntil: retentionDate,
      });

      const status2 = await service.checkEntitlementStatus(uid);
      expect(status2.isEntitled).toBe(false);
      expect(status2.isReadOnlyRetention).toBe(true);

      // 3. Canceled 35 days ago (retention expired)
      const pastRetention = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      await store.saveEntitlement({
        userId: uid,
        status: 'expired',
        tier: 'free',
        canceledAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
        retentionUntil: pastRetention,
      });

      const status3 = await service.checkEntitlementStatus(uid);
      expect(status3.isEntitled).toBe(false);
      expect(status3.isReadOnlyRetention).toBe(false);
    });

    it('performs full verifiable account purge across all owner collections and artifacts', async () => {
      const uid = 'user_to_purge';

      // Seed decks, bookmarks, shares, artifacts
      const deckId = 'deck_purge_1';
      await service.saveDeck(uid, deckId, {
        deck: { id: deckId, title: 'Purge Deck' },
        market: { id: deckId, name: 'Purge Market' },
        cards: [],
        state: { status: 'ready' },
      });
      await service.saveCard(uid, 'card_123', { deckId });
      const share = await service.createShare(uid, deckId);
      const art = await service.saveArtifact(uid, deckId, {
        filename: 'chart.png',
        mimeType: 'image/png',
        buffer: Buffer.from('bytes'),
      });

      // Run account purge
      const purgeRes = await service.purgeAccount(uid);
      expect(purgeRes.purged).toBe(true);
      expect(purgeRes.details.deletedDecks).toBe(1);
      expect(purgeRes.details.deletedCards).toBe(1);
      expect(purgeRes.details.deletedShares).toBe(1);
      expect(purgeRes.details.deletedArtifacts).toBe(1);

      // Verify no records remain
      const decks = await service.getDecks(uid);
      expect(decks).toHaveLength(0);
      const cards = await service.getSavedCards(uid);
      expect(cards).toHaveLength(0);
      const shareView = await service.getSharedDeck(share.token);
      expect(shareView).toBeNull();
      const artView = await service.getArtifact(uid, art.id);
      expect(artView).toBeNull();
    });
  });
});
