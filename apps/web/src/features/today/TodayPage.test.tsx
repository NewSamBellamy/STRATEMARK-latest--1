import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import type { CompanyFollow, CompanyMove, MarketIntelRepository } from '@mi/contracts';
import { AppRoutes } from '@/routes';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { AuthProvider } from '@/lib/auth/AuthContext';
import { DeepDiveProvider } from '@/features/deepdive/DeepDive';
import { createQueryClient } from '@/lib/query/queryClient';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import TodayPage from './TodayPage';

const move = (over: Partial<CompanyMove>): CompanyMove => ({
  id: 'mv_1', companyId: 'acme', companyName: 'Acme Robotics', kind: 'funding', importance: 3,
  title: 'Acme Robotics raises $40M Series B', url: 'https://news.example/acme-b', publisher: 'Reuters',
  publishedAt: '2026-10-15T08:00:00.000Z', foundAt: '2026-10-16T07:00:00.000Z', source: 'news', readAt: null, ...over,
});

/** The demo engine plus an in-memory Today. */
function todayRepo(follows: CompanyFollow[], moves: CompanyMove[]) {
  const state = { follows: [...follows], moves: [...moves] };
  const repo = Object.assign(makeRepo(), {
    listFollows: vi.fn(async () => state.follows),
    listMoves: vi.fn(async () => [...state.moves].sort((a, b) => Number(Boolean(a.readAt)) - Number(Boolean(b.readAt)))),
    refreshMoves: vi.fn(async (_options?: { force?: boolean }) => ({ added: 0, refreshed: 1, refreshedAt: new Date().toISOString() })),
    markMoveRead: vi.fn(async (id: string, read: boolean) => {
      state.moves = state.moves.map((m) => (m.id === id ? { ...m, readAt: read ? new Date().toISOString() : null } : m));
    }),
    followCompanies: vi.fn(async () => {}),
    unfollowCompany: vi.fn(async (id: string) => { state.follows = state.follows.filter((f) => f.companyId !== id); }),
  });
  return repo;
}

const acmeFollow = { companyId: 'acme', companyName: 'Acme Robotics', followedAt: '2026-10-01T00:00:00.000Z' };

describe('Today', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('lists followed companies’ moves with source and date, new since the last visit, and checks once on open', async () => {
    localStorage.setItem('mi.today.lastVisit', '2026-10-15T12:00:00.000Z');
    const repo = todayRepo([acmeFollow], [
      move({}),
      move({ id: 'mv_2', kind: 'filing', importance: 1, title: 'Current report (Form 8-K): Executive or director change', url: 'https://www.sec.gov/x',
        publisher: 'SEC EDGAR', publishedAt: '2026-10-14T00:00:00.000Z', foundAt: '2026-10-14T07:00:00.000Z', source: 'sec_filing' }),
    ]);
    const { user } = renderWithProviders(<TodayPage />, { repository: repo });
    const headline = await screen.findByRole('link', { name: 'Acme Robotics raises $40M Series B' });
    expect(headline).toHaveAttribute('href', 'https://news.example/acme-b');
    expect(headline).toHaveAttribute('target', '_blank');
    const first = headline.closest('li')!;
    expect(within(first).getByText('New')).toBeInTheDocument();
    expect(within(first).getByText('Major')).toBeInTheDocument();
    expect(within(first).getByText(/Reuters · Oct 15, 2026/)).toBeInTheDocument();
    // A filing is dated by its EDGAR filing day, whatever the viewer's time zone.
    expect(screen.getByText(/SEC EDGAR · Oct 14, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/1 new since your last visit/)).toBeInTheDocument();
    await waitFor(() => expect(repo.refreshMoves).toHaveBeenCalledTimes(1));
    expect(repo.refreshMoves).toHaveBeenCalledWith({ force: false });

    await user.click(within(first).getByRole('button', { name: 'Mark read' }));
    expect(repo.markMoveRead).toHaveBeenCalledWith('mv_1', true);
    await user.click(screen.getByRole('button', { name: 'Check now' }));
    expect(repo.refreshMoves).toHaveBeenLastCalledWith({ force: true });
    await user.click(screen.getByRole('tab', { name: 'Filings' }));
    expect(screen.queryByText('Acme Robotics raises $40M Series B')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unfollow Acme Robotics' }));
    expect(repo.unfollowCompany).toHaveBeenCalledWith('acme');
  });

  it('with nothing followed it says how to follow and searches nothing', async () => {
    const repo = todayRepo([], []);
    renderWithProviders(<TodayPage />, { repository: repo });
    expect(await screen.findByText('Follow companies to see their moves here')).toBeInTheDocument();
    expect(repo.refreshMoves).not.toHaveBeenCalled();
  });

  it('a session opens on Today once companies are followed; New Deck stays home otherwise', async () => {
    function Where() { const loc = useLocation(); return <output data-testid="where">{loc.pathname}</output>; }
    const mount = (repo: MarketIntelRepository) => render(
      <RepositoryProvider repository={repo}>
        <QueryClientProvider client={createQueryClient()}>
          <AuthProvider><DeepDiveProvider>
            <MemoryRouter initialEntries={['/']}><Where /><AppRoutes /></MemoryRouter>
          </DeepDiveProvider></AuthProvider>
        </QueryClientProvider>
      </RepositoryProvider>,
    );
    const followed = mount(todayRepo([acmeFollow], [move({})]));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/today'), { timeout: 20000 });
    followed.unmount();
    sessionStorage.clear();
    mount(todayRepo([], []));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
  }, 45000);
});
