/**
 * The deck-loss guard — write() must never let a shrinking snapshot destroy
 * the only copy of the user's research. (The filmed failure class: "all my
 * decks got erased.")
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoSnapshot } from '@mi/research';
import { createLocalStore } from './localStore';
import { marketCountOf, vaultPut } from './vault';

vi.mock('./vault', async (original) => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...await original<typeof import('./vault')>(), vaultPut: vi.fn().mockResolvedValue(true),
}));

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
    vi.restoreAllMocks();
    vi.mocked(vaultPut).mockReset().mockResolvedValue(true);
    localStorage.clear();
  });

  it('stashes the richer stored copy under .backup before a shrinking write', () => {
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

  it('never sheds saved reports or researched dashboards to force a quota-limited write', () => {
    const store = createLocalStore(KEY);
    const original = snapshotWith(1);
    store.write(original);
    const prior = localStorage.getItem(KEY);
    const updated = { ...original, dashboards: { company: { overview: { content: 'paid research' } } },
      reports: [{ id: 'saved-report', markdown: 'irreplaceable saved analysis' }] } as unknown as RepoSnapshot;
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === KEY && Object.keys(JSON.parse(value).dashboards).length) throw new DOMException('Full', 'QuotaExceededError');
      return setItem.call(this, key, value);
    });
    expect(() => store.write(updated)).toThrow(/could not save/i);
    expect(localStorage.getItem(KEY)).toBe(prior);
    expect(updated.reports).toHaveLength(1);
    expect(updated.dashboards).toHaveProperty('company');
    expect(vi.mocked(vaultPut).mock.calls.at(-1)?.[1]).toBe(JSON.stringify(updated));
  });

  it('does not pretend an unconfirmed vault attempt made a failed save successful', () => {
    const store = createLocalStore(KEY);
    vi.mocked(vaultPut).mockResolvedValueOnce(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    expect(() => store.write(snapshotWith(1))).toThrow(/could not save/i);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the full snapshot in successful local writes and vault mirrors', () => {
    const data = { ...snapshotWith(1), reports: [{ id: 'saved' }],
      dashboards: { company: { overview: { content: 'saved' } } },
      researchEvidence: [{ id: 'evidence', grounding: { supports: [] } }] } as unknown as RepoSnapshot;
    createLocalStore(KEY).write(data);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(data);
    expect(vi.mocked(vaultPut).mock.calls.at(-1)?.[1]).toBe(JSON.stringify(data));
  });

  it('can retry the complete write after storage becomes available', () => {
    const store = createLocalStore(KEY);
    const previous = snapshotWith(1);
    store.write(previous);
    const next = { ...previous, reports: [{ id: 'new-report' }] } as unknown as RepoSnapshot;
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    expect(() => store.write(next)).toThrow(/could not save/i);
    expect(store.read()).toEqual(previous);
    blocked.mockRestore();
    store.write(next);
    expect(store.read()).toEqual(next);
  });

  it('handles a rejected replica without invalidating an acknowledged local write', async () => {
    vi.mocked(vaultPut).mockRejectedValueOnce(new Error('Replica unavailable'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createLocalStore(KEY);
    const snapshot = snapshotWith(1);
    expect(() => store.write(snapshot)).not.toThrow();
    await Promise.resolve();
    expect(store.read()).toEqual(snapshot);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('no backup success is claimed'));
  });
});
