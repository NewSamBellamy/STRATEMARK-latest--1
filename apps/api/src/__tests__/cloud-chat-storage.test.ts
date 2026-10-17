import { describe, expect, it } from 'vitest';
import type { Firestore } from '@google-cloud/firestore';
import type { ResearchThread } from '@mi/contracts';
import { FirestoreDataStore, MemoryDataStore } from '../lib/firestoreStore';

function thread(): ResearchThread {
  return { id: 'thr_test', scope: { kind: 'deck', deckId: 'deck_test' }, title: 'Question', reportId: null,
    messages: [{ id: 'msg_test', role: 'user', text: 'Revenue?', citations: [], at: '2026-10-01' }], createdAt: '2026-10-01', updatedAt: '2026-10-01' };
}

describe('cloud conversation storage', () => {
  it('isolates objects and users, refuses stale saves and requires the owned deck', async () => {
    const store = new MemoryDataStore();
    await store.saveDeck('deck_test', { deck: {}, market: {}, cards: [], userId: 'owner' });
    const input = thread();
    expect(await store.saveResearchThread('owner', input, 0)).toBe(1);
    input.messages[0]!.text = 'External mutation';
    const saved = (await store.getResearchThread('owner', input.id))!;
    expect(saved.thread.messages[0]!.text).toBe('Revenue?');
    saved.thread.messages[0]!.text = 'Second mutation';
    expect((await store.getResearchThread('owner', input.id))!.thread.messages[0]!.text).toBe('Revenue?');
    expect(await store.getResearchThread('stranger', input.id)).toBeNull();
    expect(await store.listResearchThreads('stranger')).toEqual([]);
    await expect(store.saveResearchThread('owner', input, 0)).rejects.toMatchObject({ status: 409 });
    await expect(store.saveResearchThread('stranger', input, 0)).rejects.toMatchObject({ status: 404 });
  });

  it.each(['deck deletion', 'user purge'])('removes conversation data on %s', async action => {
    const store = new MemoryDataStore();
    await store.saveDeck('deck_test', { deck: {}, market: {}, cards: [], userId: 'owner' });
    await store.saveResearchThread('owner', thread(), 0);
    if (action === 'deck deletion') await store.deleteDeck('deck_test');
    else await store.purgeUserData('owner');
    expect(await store.listResearchThreads('owner')).toEqual([]);
  });

  it('Firestore retries only storage work, preserves revision conflicts and checks ownership', async () => {
    const data = new Map<string, unknown>([['decks/deck_test', { userId: 'owner' }]]);
    const db = {
      collection: (collection: string) => ({ doc: (id: string) => ({ path: `${collection}/${id}`,
        get: async () => ({ data: () => structuredClone(data.get(`${collection}/${id}`)), exists: data.has(`${collection}/${id}`) }) }),
      }),
      runTransaction: async (callback: (transaction: unknown) => Promise<unknown>) => {
        const pending: Array<[string, unknown]> = [];
        const transaction = { get: async (ref: { path: string }) => ({ exists: data.has(ref.path), data: () => structuredClone(data.get(ref.path)) }),
          set: (ref: { path: string }, value: unknown) => pending.push([ref.path, structuredClone(value)]) };
        await callback(transaction); // replayed callback, no committed first attempt
        pending.length = 0;
        const result = await callback(transaction);
        for (const [key, value] of pending) data.set(key, value);
        return result;
      },
    } as unknown as Firestore;
    const store = new FirestoreDataStore({ firestore: db });
    expect(await store.saveResearchThread('owner', thread(), 0)).toBe(1);
    expect((await store.getResearchThread('owner', 'thr_test'))!.revision).toBe(1);
    await expect(store.saveResearchThread('owner', thread(), 0)).rejects.toMatchObject({ status: 409 });
    await expect(store.saveResearchThread('stranger', thread(), 0)).rejects.toMatchObject({ status: 404 });
    expect(await store.getResearchThread('stranger', 'thr_test')).toBeNull();
  });
});
