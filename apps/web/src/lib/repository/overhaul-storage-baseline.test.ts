/** G00 quota loss regression. Synthetic report, no user storage. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrateSnapshot } from '@mi/research';
import { createLocalStore } from './localStore';

const { vaultPutMock } = vi.hoisted(() => ({ vaultPutMock: vi.fn() }));

vi.mock('./vault', () => ({
  marketCountOf: (json: string | null) => (json ? JSON.parse(json).markets.length : 0),
  vaultPut: vaultPutMock,
}));

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem('overhaul.synthetic');
  localStorage.removeItem('overhaul.synthetic.backup');
  vaultPutMock.mockReset();
});

describe('G00 quota persistence regression', () => {
  it('fails explicitly without downgrading or changing the previous report-bearing snapshot', () => {
    const key = 'overhaul.synthetic';
    const source = migrateSnapshot(null).snapshot;
    source.dashboards = {
      fixture: {
        overview: {
          content: { markdown: 'Current dashboard' },
          lastRefreshedAt: '2026-09-30T12:00:00.000Z',
        },
      },
    };
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
    const previous = structuredClone(source);
    previous.markets = [
      {
        id: 'prior_market',
        name: 'Synthetic market',
        createdAt: '2026-09-30T12:00:00.000Z',
        refreshCadence: 'daily',
        scopeDefinition: { vertical: 'Synthetic', geography: null, notes: null },
      },
    ];
    previous.reports = [
      { ...source.reports[0]!, id: 'prior_report', markdown: 'Prior saved research' },
    ];
    previous.dashboards = {
      prior: {
        overview: {
          content: { markdown: 'Prior dashboard' },
          lastRefreshedAt: '2026-09-30T12:00:00.000Z',
        },
      },
    };
    const previousBytes = JSON.stringify(previous);
    const previousBackup = 'existing backup bytes';
    const sourceBytes = JSON.stringify(source);
    localStorage.setItem(key, previousBytes);
    localStorage.setItem(`${key}.backup`, previousBackup);

    const set = Storage.prototype.setItem;
    const attempts: string[] = [];
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'overhaul.synthetic') {
        attempts.push(value);
        throw new DOMException('Synthetic quota limit', 'QuotaExceededError');
      }
      set.call(this, key, value);
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = createLocalStore(key);
    let thrown: unknown;
    try {
      store.write(source);
    } catch (error) {
      thrown = error;
    }

    expect.soft(thrown).toMatchObject({ name: 'LocalStorePersistenceError' });
    expect.soft(localStorage.getItem(key)).toBe(previousBytes);
    expect.soft(localStorage.getItem(`${key}.backup`)).toBe(previousBackup);
    expect.soft(JSON.stringify(source)).toBe(sourceBytes);
    expect.soft(attempts).toEqual([sourceBytes]);
    expect.soft(vaultPutMock).not.toHaveBeenCalled();
    expect
      .soft(consoleError)
      .not.toHaveBeenCalledWith(expect.stringContaining('saved to the IndexedDB vault'));
  });
});
