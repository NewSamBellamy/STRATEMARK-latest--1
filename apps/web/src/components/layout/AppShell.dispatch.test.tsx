import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MockRepository } from '@mi/mocks';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { createQueryClient } from '@/lib/query/queryClient';
import { useApiKey } from '@/lib/settings/apiKey';
import { AppShell } from './AppShell';

vi.mock('./Sidebar', () => ({ Sidebar: () => null }));
vi.mock('./TopBar', () => ({ TopBar: () => null }));
vi.mock('@/features/settings/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('@/features/deepdive/DeepDive', () => ({
  useDeepDive: () => ({ isOpen: false, closePanel: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  useApiKey.setState({ apiKey: '', hasKey: false });
});

describe('automatic renderer dispatch', () => {
  it('never launches provider work just because the app shell is open', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_DESKTOP', '1');
    useApiKey.setState({ apiKey: 'fresh-transient-key', hasKey: true });
    const repository = new MockRepository({ latencyMs: 0 });
    const listMarkets = vi.spyOn(repository, 'listMarkets');
    const refreshDeck = vi.spyOn(repository, 'refreshDeck');
    const liveRepository = Object.assign(repository, {
      listDeckBriefings: vi.fn().mockResolvedValue([]),
      generateDeckBriefing: vi.fn(),
    });

    render(
      <RepositoryProvider repository={liveRepository}>
        <QueryClientProvider client={createQueryClient()}>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<p>Library</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </RepositoryProvider>,
    );

    await vi.advanceTimersByTimeAsync(61 * 60 * 1000);
    expect(listMarkets).not.toHaveBeenCalled();
    expect(refreshDeck).not.toHaveBeenCalled();
    expect(liveRepository.generateDeckBriefing).not.toHaveBeenCalled();
  });
});
