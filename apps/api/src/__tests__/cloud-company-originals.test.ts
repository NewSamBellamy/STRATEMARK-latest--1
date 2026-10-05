import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from '@google-cloud/firestore';
import type { OriginalSourceAttempt } from '@mi/research';
import { CloudDeckService, MockFirebaseAdapter } from '../lib/CloudDeckService';
import { FirestoreDataStore, MemoryDataStore } from '../lib/firestoreStore';

const attempt: OriginalSourceAttempt = {
  id: 'src_00000000-0000-4000-8000-000000000001', companyId: 'cmp_acme', metricType: 'company_profile',
  capturedAt: '2026-10-04T00:00:00.000Z', receipts: [{ requestedUrl: 'https://sec.gov/Archives/acme',
    status: 'retrieved', retrievedAt: '2026-10-04T00:00:00.000Z', text: 'Acme reported 45 employees.' }],
};
async function fixture() {
  const store = new MemoryDataStore();
  const auth = new MockFirebaseAdapter();
  const service = new CloudDeckService(store, auth, auth);
  await service.saveDeck('user_pro', 'deck_a', { deck: { id: 'deck_a' }, market: {}, cards: [] });
  const read = vi.fn(async () => attempt.receipts[0]!);
  return { store, auth, service, read };
}
describe('cloud company originals', () => {
  it('keeps concurrent company receipts on reload, separate from published deck updates', async () => {
    const { store, auth, service, read } = await fixture();
    const sources = service.getOriginalSources('user_pro', 'deck_a', read);
    await Promise.all([sources.save(attempt), sources.save({ ...attempt,
      id: 'src_00000000-0000-4000-8000-000000000002', companyId: 'cmp_other' })]);
    await service.saveDeck('user_pro', 'deck_a', { deck: { id: 'deck_a' }, market: {}, cards: [] });
    const reloaded = new CloudDeckService(store, auth, auth).getOriginalSources('user_pro', 'deck_a', read);
    const found = await reloaded.list({ companyId: 'cmp_acme' });
    expect(found).toEqual([attempt]);
    found[0]!.receipts[0]!.text = 'mutated';
    expect(await reloaded.list({ companyId: 'cmp_acme' })).toEqual([attempt]);
    expect(await reloaded.list({ companyId: 'cmp_other' })).toHaveLength(1);
    expect(await reloaded.list({ companyId: 'cmp_acme', metricType: 'arr' })).toEqual([]);
  });
  it('rejects cross-owner, deleted-deck and lost-entitlement writes and reads before network work', async () => {
    const { store, auth, service, read } = await fixture();
    const wrongOwner = service.getOriginalSources('user_123', 'deck_a', read);
    await expect(wrongOwner.save(attempt)).rejects.toThrow();
    await expect(wrongOwner.retrieve('https://sec.gov/Archives/acme')).rejects.toThrow();
    expect(await wrongOwner.list({ companyId: 'cmp_acme' })).toEqual([]);
    const sources = service.getOriginalSources('user_pro', 'deck_a', read);
    vi.spyOn(auth, 'hasActiveEntitlement').mockResolvedValue(false);
    await expect(sources.save(attempt)).rejects.toThrow();
    await expect(sources.retrieve('https://sec.gov/Archives/acme')).rejects.toThrow();
    await store.deleteDeck('deck_a');
    await expect(sources.save(attempt)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it('coalesces public reads without treating them as accepted claims', async () => {
    const { service, read } = await fixture();
    const sources = service.getOriginalSources('user_pro', 'deck_a', read);
    await Promise.all([sources.retrieve('https://sec.gov/Archives/acme'), sources.retrieve('https://sec.gov/Archives/acme')]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(await sources.list({ companyId: 'cmp_acme' })).toEqual([]);
  });
  it('forwards company/metric scope and separates cloud excerpt cache entries', async () => {
    const { service, read } = await fixture();
    const sources = service.getOriginalSources('user_pro', 'deck_a', read);
    const scope = { companyId: 'cmp_acme', companyName: 'Acme Inc.', metricType: 'employees' };
    const url = 'https://sec.gov/Archives/acme';
    await sources.retrieve(url, scope);
    await sources.retrieve(url, { ...scope, metricType: 'arr' });
    expect(read).toHaveBeenCalledWith(url, scope);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('rejects overwrites and oversized receipts without losing saved evidence', async () => {
    const { service, read } = await fixture();
    const sources = service.getOriginalSources('user_pro', 'deck_a', read);
    await sources.save(attempt);
    await sources.save(attempt); // idempotent retry only
    await expect(sources.save({ ...attempt, companyId: 'cmp_wrong' })).rejects.toThrow();
    await expect(sources.save({ ...attempt, id: 'src_00000000-0000-4000-8000-000000000003',
      receipts: [{ ...attempt.receipts[0]!, text: 'x'.repeat(70000) }] })).rejects.toThrow();
    expect(await sources.list({ companyId: 'cmp_acme' })).toEqual([attempt]);
  });
  it('actually serializes legacy verification originals in Firestore deck writes', async () => {
    const set = vi.fn();
    const db = { collection: vi.fn(() => ({ doc: vi.fn(() => ({})) })),
      runTransaction: async (fn: (t: unknown) => Promise<void>) => fn({
        get: async () => ({ exists: false }), set,
      }) } as unknown as Firestore;
    const store = new FirestoreDataStore({ firestore: db });
    await store.saveDeck('deck_a', { deck: {}, market: {}, cards: [], userId: 'user_pro',
      originalSourceAttempts: [{ companyId: 'cmp_acme', metricType: 'arr', capturedAt: attempt.capturedAt, receipts: attempt.receipts }] });
    expect(set.mock.calls[0]![1]).toHaveProperty('originalSourceAttempts');
  });
  it('retains company originals across Firestore adapter reload and rejects another owner in the transaction', async () => {
    let data: Record<string, unknown> = { deck: {}, market: {}, cards: [], userId: 'user_pro' };
    const ref = { get: async () => ({ exists: true, data: () => structuredClone(data) }) };
    const set = vi.fn((_ref: unknown, update: Record<string, unknown>) => { data = { ...data, ...update }; });
    const db = { collection: () => ({ doc: () => ref }), runTransaction: async (fn: (t: unknown) => Promise<void>) =>
      fn({ get: ref.get, set }) } as unknown as Firestore;
    const store = new FirestoreDataStore({ firestore: db });
    await store.saveCompanyOriginal('user_pro', 'deck_a', attempt);
    expect(set).toHaveBeenCalledWith(ref, { companySourceAttempts: [attempt] }, { merge: true });
    const reloaded = new FirestoreDataStore({ firestore: db });
    expect((await reloaded.getDeck('deck_a'))!.companySourceAttempts).toEqual([attempt]);
    await expect(reloaded.saveCompanyOriginal('user_123', 'deck_a', { ...attempt,
      id: 'src_00000000-0000-4000-8000-000000000002' })).rejects.toThrow('Deck not found');
    expect(set).toHaveBeenCalledTimes(1);
  });
  it('fails closed at the document budget instead of evicting sources or publishing unsaved evidence', async () => {
    const { service, read } = await fixture();
    const sources = service.getOriginalSources('user_pro', 'deck_a', read);
    await sources.save(attempt);
    await service.saveDeck('user_pro', 'deck_a', { deck: { note: 'x'.repeat(799000) }, market: {}, cards: [] });
    await expect(sources.save({ ...attempt, id: 'src_00000000-0000-4000-8000-000000000002',
      receipts: [{ ...attempt.receipts[0]!, text: 'x'.repeat(4000) }] })).rejects.toThrow('maximum allowed size');
    expect(await sources.list({ companyId: 'cmp_acme' })).toEqual([attempt]);
  });
  it('removes company receipts with their deck and never recreates a deleted parent', async () => {
    const { service, read } = await fixture();
    const sources = service.getOriginalSources('user_pro', 'deck_a', read);
    await sources.save(attempt);
    await service.deleteDeck('user_pro', 'deck_a');
    expect(await sources.list({ companyId: 'cmp_acme' })).toEqual([]);
    await expect(sources.save(attempt)).rejects.toThrow('Deck not found');
  });
  it('counts preserved originals when checking the size of a later deck replacement', async () => {
    const { service, read } = await fixture();
    const sources = service.getOriginalSources('user_pro', 'deck_a', read);
    const larger = { ...attempt, receipts: [{ ...attempt.receipts[0]!, text: 'x'.repeat(30000) }] };
    await sources.save(larger);
    await expect(service.saveDeck('user_pro', 'deck_a', {
      deck: { note: 'x'.repeat(1030000) }, market: {}, cards: [],
    })).rejects.toThrow('maximum allowed size');
    expect(await sources.list({ companyId: 'cmp_acme' })).toEqual([larger]);
    expect((await service.getDeck('user_pro', 'deck_a'))!.deck).toEqual({ id: 'deck_a' });
  });
});
