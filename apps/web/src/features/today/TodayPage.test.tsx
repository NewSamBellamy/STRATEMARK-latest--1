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

  describe('tells the truth about its checks', () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

    it('reads "checked 3h ago" from the stored time, so it is right after a reload and never "never" when moves exist', async () => {
      const repo = todayRepo([{ ...acmeFollow, lastCheckedAt: hoursAgo(3) }], [move({})]);
      repo.refreshMoves.mockResolvedValue({ added: 0, refreshed: 0, refreshedAt: null });
      renderWithProviders(<TodayPage />, { repository: repo });
      expect(await screen.findByText(/checked 3h ago/)).toBeInTheDocument();
      expect(screen.queryByText(/checked never/)).not.toBeInTheDocument();
    });

    it('drops the "checked" clause rather than saying never when moves exist but no time is known', async () => {
      const repo = todayRepo([acmeFollow], [move({})]);
      repo.refreshMoves.mockResolvedValue({ added: 0, refreshed: 0, refreshedAt: null });
      renderWithProviders(<TodayPage />, { repository: repo });
      await screen.findByRole('link', { name: 'Acme Robotics raises $40M Series B' });
      await waitFor(() => expect(repo.refreshMoves).toHaveBeenCalled());
      expect(screen.queryByText(/checked/)).not.toBeInTheDocument();
      expect(screen.queryByText(/never/)).not.toBeInTheDocument();
    });

    it('says "not checked yet" for a follow that has never been looked at and has no moves', async () => {
      const repo = todayRepo([acmeFollow], []);
      repo.refreshMoves.mockResolvedValue({ added: 0, refreshed: 0, refreshedAt: null });
      renderWithProviders(<TodayPage />, { repository: repo });
      expect(await screen.findByText(/not checked yet/)).toBeInTheDocument();
    });

    it('while the first check runs it says so alone: no "0 unread", no "nothing new"', async () => {
      const repo = todayRepo([acmeFollow], []);
      repo.refreshMoves.mockReturnValue(new Promise(() => {}));
      renderWithProviders(<TodayPage />, { repository: repo });
      expect(await screen.findByText('Checking the companies you follow…')).toBeInTheDocument();
      expect(screen.queryByText(/unread/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Nothing new/)).not.toBeInTheDocument();
    });

    it('after a partial failure it names how many companies it could not reach and will retry', async () => {
      const repo = todayRepo([acmeFollow, { companyId: 'beta', companyName: 'Beta Capital', followedAt: '2026-10-01T00:00:00.000Z', checkFailedAt: hoursAgo(0.1) },
        { companyId: 'gamma', companyName: 'Gamma Shop', followedAt: '2026-10-01T00:00:00.000Z', checkFailedAt: hoursAgo(0.1) }], [move({})]);
      renderWithProviders(<TodayPage />, { repository: repo });
      expect(await screen.findByText('Couldn’t reach the news or filings for 2 companies, trying again later.')).toBeInTheDocument();
    });

    it('an outage with nothing stored does not claim "no moves found"', async () => {
      const repo = todayRepo([{ ...acmeFollow, checkFailedAt: hoursAgo(0.1) }], []);
      renderWithProviders(<TodayPage />, { repository: repo });
      expect(await screen.findByText('Couldn’t reach the news or filings for 1 company, trying again later.')).toBeInTheDocument();
      expect(screen.getByText(/not a full answer yet/)).toBeInTheDocument();
    });

    it('a failed check ends with a single full stop', async () => {
      const repo = todayRepo([acmeFollow], [move({})]);
      repo.refreshMoves.mockRejectedValue(new Error('Research was updated in another window. Reload before making changes.'));
      renderWithProviders(<TodayPage />, { repository: repo });
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Reload before making changes. Stored moves are still shown.');
      expect(alert.textContent).not.toContain('..');
    });
  });
});
