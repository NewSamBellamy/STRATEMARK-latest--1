import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRoutes } from '@/routes';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { AuthProvider } from '@/lib/auth/AuthContext';
import { DeepDiveProvider } from '@/features/deepdive/DeepDive';
import { createQueryClient } from '@/lib/query/queryClient';
import { makeRepo } from './test-utils';
import { useSettingsModal } from '@/lib/settings/settingsModal';

// The page we navigate to is still downloading (slow network, or offline: the
// lazy route waits for the connection). Its chunk never resolves here.
vi.mock('@/features/beta/BetaPage', () => new Promise(() => {}));

// Generous: the dashboard route is code-split and loads slowly on a cold, busy machine.
const FIND = { timeout: 20000 } as const;
const COMPANY = 'cmp_gracewear-global';

let nav: NavigateFunction | null = null;
function NavHandle() {
  nav = useNavigate();
  return null;
}

function renderAt(route: string) {
  const repository = Object.assign(makeRepo(), {
    getDashboardTab: vi.fn().mockImplementation(async (companyId: string, tab: string) => ({
      companyId, tab, lastRefreshedAt: '2026-10-01T00:00:00.000Z',
      content: { founderStory: '', quotes: [], timeline: [companyId === COMPANY
        ? { date: '2021', title: 'Acquisition Closed', detail: 'Bought Widgets Inc.' }
        : { date: '2022', title: 'Second Company Launch', detail: 'Opened its first store.' }] },
    })),
  });
  return {
    user: userEvent.setup(),
    ...render(
      <RepositoryProvider repository={repository}>
        <QueryClientProvider client={createQueryClient()}>
          <AuthProvider>
            <DeepDiveProvider>
              <MemoryRouter initialEntries={[route]}>
                <NavHandle />
                <AppRoutes />
              </MemoryRouter>
            </DeepDiveProvider>
          </AuthProvider>
        </QueryClientProvider>
      </RepositoryProvider>,
    ),
  };
}

const eventDialog = () => screen.queryByRole('dialog', { name: 'Acquisition Closed' });

describe('overlays close when the route changes', () => {
  it('a History event dialog does not stay over the next page while it loads', { timeout: 45000 }, async () => {
    const { user } = renderAt(`/company/${COMPANY}/dashboard/history`);
    await user.click(await screen.findByRole('button', { name: /Acquisition Closed/ }, FIND));
    expect(await screen.findByRole('dialog', { name: 'Acquisition Closed' }, FIND)).toBeInTheDocument();

    act(() => nav!('/beta'));
    // The next page is still loading (its loader shows) — the old page's
    // dialog must already be gone, not floating over the loader.
    expect(eventDialog()).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Loading/i);
  });

  it('switching to another company closes the open event instead of re-pointing it', { timeout: 45000 }, async () => {
    const OTHER = 'cmp_seraph-studio';
    const { user } = renderAt(`/company/${OTHER}/dashboard/history`);
    expect(await screen.findByRole('button', { name: /Second Company Launch/ }, FIND)).toBeInTheDocument();
    act(() => nav!(`/company/${COMPANY}/dashboard/history`));
    await user.click(await screen.findByRole('button', { name: /Acquisition Closed/ }, FIND));
    expect(await screen.findByRole('dialog', { name: 'Acquisition Closed' }, FIND)).toBeInTheDocument();

    // Back to a company whose data is cached: the dashboard does not pass
    // through a loading state, so tab-local state (the open event, keyed by
    // index) would otherwise carry over and open the OTHER company's event.
    act(() => nav!(`/company/${OTHER}/dashboard/history`));
    expect(await screen.findByRole('button', { name: /Second Company Launch/ }, FIND)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Acquisition Closed|Second Company Launch/ })).not.toBeInTheDocument();
  });

  it('the app-level Settings modal closes when the user navigates away', { timeout: 45000 }, async () => {
    renderAt('/settings');
    // #/settings opens Settings over home (a redirect that must not close it).
    expect(await screen.findByRole('dialog', { name: 'Settings' }, FIND)).toBeInTheDocument();
    act(() => nav!('/history'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument(), FIND);
    expect(useSettingsModal.getState().isOpen).toBe(false);
  });
});
