import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getFirestore, verifyIdToken } = vi.hoisted(() => ({
  getFirestore: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock('firebase-admin/app', () => ({
  getApps: () => ['initialized'],
  initializeApp: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken }),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore,
}));

import { FirebaseAdapter } from '../lib/CloudDeckService';

describe('FirebaseAdapter', () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
    getFirestore.mockReset();
  });

  it('rejects raw bearer strings when Firebase rejects token verification', async () => {
    verifyIdToken.mockRejectedValue(new Error('invalid Firebase token'));
    const adapter = new FirebaseAdapter();

    await expect(adapter.verifyIdToken('valid_token')).resolves.toBeNull();
  });

  it('returns only the UID from a verified Firebase token', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'firebase_uid' });
    const adapter = new FirebaseAdapter();

    await expect(adapter.verifyIdToken('header.payload.signature')).resolves.toBe('firebase_uid');
  });

  it('fails closed when the entitlement store is unavailable', async () => {
    getFirestore.mockReturnValue({
      collection: () => ({
        doc: () => ({ get: vi.fn().mockRejectedValue(new Error('Firestore unavailable')) }),
      }),
    });
    const adapter = new FirebaseAdapter();

    await expect(adapter.hasActiveEntitlement('firebase_uid')).resolves.toBe(false);
  });

  it('requires an explicit entitlement record', async () => {
    getFirestore.mockReturnValue({
      collection: () => ({
        doc: () => ({ get: vi.fn().mockResolvedValue({ exists: false }) }),
      }),
    });
    const adapter = new FirebaseAdapter();

    await expect(adapter.hasActiveEntitlement('firebase_uid')).resolves.toBe(false);
  });
});
