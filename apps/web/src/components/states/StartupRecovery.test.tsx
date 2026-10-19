import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { migrateSnapshot, type RepoSnapshot } from '@mi/research';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { openBrowserResearchStore, readBrowserResearchData } from '@/lib/repository/browserResearchStore';
import { useApiKey } from '@/lib/settings/apiKey';
import { ErrorBoundary } from './ErrorBoundary';
import { StartupFailure } from './StartupRecovery';

const market = (id: string, name: unknown) => ({ id, name, scopeDefinition: { vertical: 'Test', geography: null, notes: null }, refreshCadence: 'weekly', createdAt: '2026-01-01T00:00:00Z' });
function workspace(...markets: unknown[]): RepoSnapshot {
  const snapshot = migrateSnapshot(null).snapshot as unknown as Record<string, unknown>;
  snapshot.markets = markets;
  snapshot.decks = markets.map((m) => ({ id: `d_${(m as { id: string }).id}`, marketId: (m as { id: string }).id, createdAt: '2026-01-01T00:00:00Z', lastRefreshedAt: null }));
  return snapshot as unknown as RepoSnapshot;
}

/** Writes a saved record straight into the vault, as an older or damaged build would have left it. */
async function putRaw(key: string, value: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('stratemark.vault', 2);
    request.onupgradeneeded = () => { request.result.createObjectStore('snapshots'); request.result.createObjectStore('images'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve) => {
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
  });
}
const COMMITTED = 'mi.repo.v1.committed';

const reload = vi.fn();
function Bomb(): never { throw new Error('Objects are not valid as a React child'); }
/** The app's own top-level boundary, as main.tsx sets it up, around a child that cannot start. */
function failedStart() {
  return render(
    <ErrorBoundary fallbackTitle="The app failed to start" fallback={({ error, reset }) => <StartupFailure error={error} onRetry={reset} />}>
      <Bomb />
    </ErrorBoundary>,
  );
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
  reload.mockReset();
  vi.stubGlobal('location', { ...window.location, reload });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('when the app fails to start', () => {
  /** Saved research whose current workspace is the poisoned one and whose backup is the good one before it. */
  async function poisonedWithBackup() {
    const store = await openBrowserResearchStore();
    await store.write(workspace(market('m_good', 'Good market')));
    await store.write(workspace(market('m_bad', { a: 1 })));
  }

  it('keeps the plain error and offers all three ways out', async () => {
    await poisonedWithBackup();
    failedStart();
    expect(screen.getByText('The app failed to start')).toBeInTheDocument();
    expect(screen.getByText('Objects are not valid as a React child')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /download my research/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore the last backup/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start fresh/i })).toBeInTheDocument();
  });

  it('downloads what is stored, exactly as stored, without the app having started', async () => {
    await poisonedWithBackup();
    const stored = (await readBrowserResearchData()).current!;
    let blob: Blob | undefined;
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => { blob = b; return 'blob:test'; }, revokeObjectURL: () => undefined }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const user = userEvent.setup();
    failedStart();
    await user.click(await screen.findByRole('button', { name: /download my research/i }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(await blob!.text()).toBe(stored);
    expect(JSON.parse(stored).markets[0].name).toEqual({ a: 1 });
  });

  it('restores the last backup after saying what it brings in, and keeps the bad workspace as the new backup', async () => {
    await poisonedWithBackup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    failedStart();
    await user.click(await screen.findByRole('button', { name: /restore the last backup/i }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(confirm.mock.calls[0]![0]).toContain('This brings in 1 deck and 0 companies.');
    const saved = await readBrowserResearchData();
    expect(JSON.parse(saved.current!).markets.map((m: { name: string }) => m.name)).toEqual(['Good market']);
    expect(JSON.parse(saved.backup!).markets[0].name).toEqual({ a: 1 });
  });

  it('restores even when the saved workspace cannot be read at all, and when it still says research is running', async () => {
    await putRaw('mi.repo.v1.committed.backup', { json: JSON.stringify(workspace(market('m_good', 'Good market'))), revision: 1, at: 1 });
    await putRaw(COMMITTED, { json: '{not json', revision: 2, at: 2 });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    failedStart();
    // The unreadable text is still there to download: it is what is stored.
    expect(await screen.findByRole('button', { name: /download my research/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /restore the last backup/i }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(JSON.parse((await readBrowserResearchData()).current!).markets[0].name).toBe('Good market');
  });

  it('does not hold the restore up for a crashed session\'s research that still reads as running', async () => {
    const store = await openBrowserResearchStore();
    await store.write(workspace(market('m_good', 'Good market')));
    const crashed = workspace(market('m_bad', { a: 1 })) as unknown as Record<string, unknown>;
    crashed.researchJobs = [{ id: 'job', status: 'running', stage: 'metrics', createdAt: 'x', updatedAt: 'x', catalogNames: [], completedEntityNames: [], warnings: [], error: null }];
    await store.write(crashed as unknown as RepoSnapshot);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    failedStart();
    await user.click(await screen.findByRole('button', { name: /restore the last backup/i }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(JSON.parse((await readBrowserResearchData()).current!).markets[0].name).toBe('Good market');
  });

  it('changes nothing when the confirmation is declined', async () => {
    await poisonedWithBackup();
    const before = await readBrowserResearchData();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    failedStart();
    await user.click(await screen.findByRole('button', { name: /restore the last backup/i }));
    await user.click(screen.getByRole('button', { name: /start fresh/i }));
    expect(await readBrowserResearchData()).toEqual(before);
    expect(reload).not.toHaveBeenCalled();
  });

  it('starts fresh after a plain confirmation: research and its backup go, the API key and settings stay', async () => {
    await poisonedWithBackup();
    localStorage.setItem('mi.geminiApiKey', 'kept-test-only');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    failedStart();
    await user.click(await screen.findByRole('button', { name: /start fresh/i }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(confirm.mock.calls[0]![0]).toMatch(/deletes the research saved in this browser, including its backup.*API key and settings are kept/s);
    expect(await readBrowserResearchData()).toEqual({ current: null, backup: null });
    expect(localStorage.getItem('mi.geminiApiKey')).toBe('kept-test-only');
  });

  it('offers no restore when there is no backup, and no download when nothing is stored', async () => {
    failedStart();
    expect(await screen.findByRole('button', { name: /start fresh/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restore the last backup/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /download my research/i })).toBeNull();
  });

  it('is also on the screen shown when saved research cannot be opened, where Settings is out of reach', async () => {
    await putRaw(COMMITTED, { json: '{not json', revision: 1, at: 1 });
    useApiKey.setState({ apiKey: 'k', hasKey: true } as never);
    render(<RepositoryProvider><p>app</p></RepositoryProvider>);
    expect(await screen.findByText('Your existing research has not been deleted.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /start fresh/i })).toBeInTheDocument();
    // The download button waits for the saved research to be read; "start fresh" does not.
    expect(await screen.findByRole('button', { name: /download my research/i })).toBeInTheDocument();
    useApiKey.setState({ apiKey: '', hasKey: false } as never);
  });
});
