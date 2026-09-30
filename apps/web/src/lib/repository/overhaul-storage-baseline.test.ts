/** G00 unresolved quota loss reproduction. Synthetic report, no user storage. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrateSnapshot } from '@mi/research';
import { createLocalStore } from './localStore';

vi.mock('./vault', () => ({
  marketCountOf: (json: string | null) => (json ? JSON.parse(json).markets.length : 0),
  vaultPut: vi.fn(async () => undefined),
}));

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem('overhaul.synthetic');
});

describe('G00 UNRESOLVED baseline: report retention under quota pressure', () => {
  it('must not turn a successful write into a snapshot with saved reports discarded', () => {
    const source = migrateSnapshot(null).snapshot;
    source.reports = [
      {
        id: 'report_fixture',
        markdown: 'Synthetic saved research',
        title: 'Fixture',
        kind: 'company',
        subjectId: 'co_fixture',
        citations: [],
        createdAt: '2026-09-30T12:00:00.000Z',
      },
    ];
    const set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'overhaul.synthetic' && JSON.parse(value).reports.length > 0) {
        throw new DOMException('Synthetic quota limit', 'QuotaExceededError');
      }
      set.call(this, key, value);
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createLocalStore('overhaul.synthetic');
    store.write(source);
    expect(store.read()?.reports).toEqual(source.reports);
  });
});
