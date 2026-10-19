import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { screen, waitFor } from '@testing-library/react';
import { migrateSnapshot } from '@mi/research';
import { renderWithProviders } from '@/test/test-utils';
import { openBrowserResearchStore, readBrowserResearchData } from '@/lib/repository/browserResearchStore';
import { useSettingsModal } from '@/lib/settings/settingsModal';
import { SettingsModal } from './SettingsModal';

const market = (id: string, name: unknown) => ({ id, name, scopeDefinition: { vertical: 'Test', geography: null, notes: null }, refreshCadence: 'weekly', createdAt: '2026-01-01T00:00:00Z' });
const company = (id: string) => ({ id, name: `Company ${id}`, oneLiner: '', logoUrl: null, hqLocation: null, websiteUrl: null, brandTheme: null });
function file(mutate: (snapshot: Record<string, unknown>) => void): File {
  const snapshot = migrateSnapshot(null).snapshot as unknown as Record<string, unknown>;
  snapshot.markets = [market('m1', 'Real market'), market('m2', { a: 1 })];
  // The unreadable market's deck goes with it: two rows left out, one deck kept.
  snapshot.decks = [{ id: 'd1', marketId: 'm1', createdAt: '2026-01-01T00:00:00Z', lastRefreshedAt: null }, { id: 'd2', marketId: 'm2', createdAt: '2026-01-01T00:00:00Z', lastRefreshedAt: null }];
  snapshot.companies = [company('a'), company('b'), company('c')];
  mutate(snapshot);
  return new File([JSON.stringify(snapshot)], 'research.json', { type: 'application/json' });
}

const reload = vi.fn();
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
  reload.mockReset();
  vi.stubGlobal('location', { ...window.location, reload });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); useSettingsModal.setState({ isOpen: false, tab: null }); });

/** Settings open on Data safety, and a file chosen through its Import button. */
async function chooseFile(chosen: File) {
  useSettingsModal.setState({ isOpen: true, tab: 'data' });
  const { user, container } = renderWithProviders(<SettingsModal />);
  await screen.findByRole('heading', { name: 'Data safety' });
  const input = container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]')!;
  await user.upload(input, chosen);
}

describe('importing a research file from Settings', () => {
  it('asks with what the file brings in and what it leaves out, and replaces nothing on no', async () => {
    const store = await openBrowserResearchStore();
    await store.write(migrateSnapshot(null).snapshot);
    const before = await readBrowserResearchData();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await chooseFile(file(() => undefined));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    const asked = confirm.mock.calls[0]![0] as string;
    expect(asked).toContain('This brings in 1 deck and 3 companies.');
    expect(asked).toContain('2 items in the file could not be read, so they are left out.');
    expect(asked).toContain('Your current research will become the backup.');
    expect(await readBrowserResearchData()).toEqual(before);
    expect(reload).not.toHaveBeenCalled();
  });

  it('says it will not restart research the file recorded as running', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await chooseFile(file((s) => {
      s.researchJobs = [{ id: 'j', status: 'running', stage: 'metrics', createdAt: 'x', updatedAt: 'x', catalogNames: [], completedEntityNames: [], warnings: [], error: null }];
    }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0]![0]).toContain('1 research run that was still going when the file was saved will not be started again.');
  });

  it('saves the readable rows on yes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await chooseFile(file(() => undefined));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    const saved = JSON.parse((await readBrowserResearchData()).current!);
    expect(saved.markets.map((m: { name: string }) => m.name)).toEqual(['Real market']);
    expect(saved.companies).toHaveLength(3);
  });

  it('refuses a file with too many companies in plain words, without asking to replace anything', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await chooseFile(file((s) => { s.companies = Array.from({ length: 1001 }, (_, n) => company(`c${n}`)); }));
    expect(await screen.findByText(/1,001 companies, more than the 1,000 an import can bring in/)).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
