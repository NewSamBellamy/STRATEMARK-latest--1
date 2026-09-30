/**
 * The deck-loss guard — write() must never let a shrinking snapshot destroy
 * the only copy of the user's research. (The filmed failure class: "all my
 * decks got erased.")
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoSnapshot } from '@mi/research';
import { createLocalStore } from './localStore';
import { marketCountOf } from './vault';
import type * as VaultModule from './vault';

const { vaultPutMock } = vi.hoisted(() => ({ vaultPutMock: vi.fn() }));

vi.mock('./vault', async (importOriginal) => {
  const actual = await importOriginal<typeof VaultModule>();
  return { ...actual, vaultPut: vaultPutMock };
});

const KEY = 'test.repo.v1';

function snapshotWith(marketCount: number): RepoSnapshot {
  return {
    markets: Array.from({ length: marketCount }, (_, i) => ({ id: `mkt_${i}` })),
    decks: [],
    companies: [],
    metrics: [],
    cards: [],
    viceClaims: [],
    dashboards: {},
    companyMarket: {},
    reports: [],
    briefings: [],
    savedCards: [],
    opportunity: {},
    researchJobs: [],
    threads: [],
  } as unknown as RepoSnapshot;
}

describe('createLocalStore — deck-loss guard', () => {
  beforeEach(() => {
    localStorage.clear();
    vaultPutMock.mockReset();
    vaultPutMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists and mirrors the complete snapshot after a successful local write', () => {
    const store = createLocalStore(KEY);
    const source = {
      ...snapshotWith(2),
      dashboards: { cached: { overview: { markdown: 'Cached research' } } },
      reports: [{ id: 'saved-report', markdown: 'Saved report' }],
    } as unknown as RepoSnapshot;
    const expectedBytes = JSON.stringify(source);

    store.write(source);

    expect(localStorage.getItem(KEY)).toBe(expectedBytes);
    expect(store.read()).toEqual(source);
    expect(vaultPutMock).toHaveBeenCalledTimes(1);
    expect(vaultPutMock).toHaveBeenCalledWith(KEY, expectedBytes);
  });

  it.each([
    ['quota', new DOMException('Synthetic quota limit', 'QuotaExceededError')],
    ['non-quota', new DOMException('Storage access denied', 'SecurityError')],
  ])('throws and preserves the previous snapshot on a %s storage error', (_kind, failure) => {
    const store = createLocalStore(KEY);
    const previous = {
      ...snapshotWith(4),
      dashboards: { prior: { overview: { markdown: 'Prior dashboard' } } },
      reports: [{ id: 'prior-report', markdown: 'Prior report' }],
    } as unknown as RepoSnapshot;
    const source = {
      ...snapshotWith(1),
      dashboards: { next: { overview: { markdown: 'New dashboard' } } },
      reports: [{ id: 'new-report', markdown: 'New report' }],
    } as unknown as RepoSnapshot;
    const previousBytes = JSON.stringify(previous);
    const backupBytes = 'existing backup bytes';
    const sourceBytes = JSON.stringify(source);
    localStorage.setItem(KEY, previousBytes);
    localStorage.setItem(`${KEY}.backup`, backupBytes);
    const nativeSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === KEY) throw failure;
      nativeSetItem.call(this, key, value);
    });

    let thrown: unknown;
    try {
      store.write(source);
    } catch (error) {
      thrown = error;
    }

    expect.soft(thrown).toMatchObject({ name: 'LocalStorePersistenceError' });
    expect.soft(thrown).toBeInstanceOf(Error);
    expect.soft(localStorage.getItem(KEY)).toBe(previousBytes);
    expect.soft(localStorage.getItem(`${KEY}.backup`)).toBe(backupBytes);
    expect.soft(JSON.stringify(source)).toBe(sourceBytes);
    expect.soft(setItem.mock.calls.filter(([key]) => key === KEY)).toEqual([[KEY, sourceBytes]]);
    expect.soft(vaultPutMock).not.toHaveBeenCalled();
  });

  it('consumes a rejected asynchronous vault mirror without an unhandled rejection', async () => {
    const store = createLocalStore(KEY);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mirror = Promise.reject(new Error('Synthetic mirror failure'));
    const mirrorCatch = vi.spyOn(mirror, 'catch');
    vaultPutMock.mockReturnValueOnce(mirror);

    store.write(snapshotWith(2));
    const storeAttachedRejectionHandler = mirrorCatch.mock.calls.length === 1;
    // Attach a test-owned handler too, so the RED implementation cannot leak a rejection
    // into Vitest after the assertion has established whether the store handled it.
    await mirror.catch(() => undefined);

    expect(storeAttachedRejectionHandler).toBe(true);
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('saved to the IndexedDB vault'),
    );
  });

  it('stashes the richer stored copy under .backup after a successful shrinking write', () => {
    const store = createLocalStore(KEY);
    store.write(snapshotWith(3));
    expect(marketCountOf(localStorage.getItem(KEY))).toBe(3);

    // A stale tab / accidental wipe writes an EMPTY snapshot over it…
    store.write(snapshotWith(0));
    expect(marketCountOf(localStorage.getItem(KEY))).toBe(0);
    // …but the 3-deck copy survives, restorable from Settings → Data safety.
    expect(marketCountOf(localStorage.getItem(`${KEY}.backup`))).toBe(3);
  });

  it('does NOT churn the backup on growing or equal writes', () => {
    const store = createLocalStore(KEY);
    store.write(snapshotWith(2));
    store.write(snapshotWith(5));
    expect(localStorage.getItem(`${KEY}.backup`)).toBeNull();
    expect(marketCountOf(localStorage.getItem(KEY))).toBe(5);
  });

  it('round-trips read/write', () => {
    const store = createLocalStore(KEY);
    store.write(snapshotWith(4));
    expect(marketCountOf(JSON.stringify(store.read()))).toBe(4);
  });
});
