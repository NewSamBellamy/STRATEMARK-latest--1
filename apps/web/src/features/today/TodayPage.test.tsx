import { StrictMode } from 'react';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import type { CompanyFollow, CompanyMove, MarketIntelRepository, MovesRefreshResult } from '@mi/contracts';
import { AnotherWindowError } from '@mi/research';
import { AppRoutes } from '@/routes';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { AuthProvider } from '@/lib/auth/AuthContext';
import { DeepDiveProvider } from '@/features/deepdive/DeepDive';
import { createQueryClient } from '@/lib/query/queryClient';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import TodayPage, { TODAY_RECHECK_MS } from './TodayPage';

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
    refreshMoves: vi.fn(async (_options?: { force?: boolean; onProgress?: (done: number, total: number) => void }): Promise<MovesRefreshResult> => ({ added: 0, refreshed: 1, refreshedAt: new Date().toISOString() })),
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

  describe('day groups and mark all read', () => {
    // Only the date is faked, so the sample moves (mid October 2026) land in known groups.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
    });
    afterEach(() => { vi.useRealTimers(); });

    const grouped = () => todayRepo([acmeFollow], [
      move({ id: 'd_today', title: 'Today story', publishedAt: '2026-10-16T11:00:00.000Z' }),
      move({ id: 'd_yest', title: 'Yesterday story', publishedAt: '2026-10-15T12:00:00.000Z' }),
      move({ id: 'd_week', title: 'Week story', publishedAt: '2026-10-12T12:00:00.000Z' }),
      move({ id: 'd_old', title: 'Older story', publishedAt: '2026-10-01T12:00:00.000Z' }),
      move({ id: 'd_stale', title: 'Stale story', publishedAt: '2026-08-01T12:00:00.000Z' }),
    ]);

    it('headings come from each move’s publish day and stories over 30 days old fold under Older', async () => {
      renderWithProviders(<TodayPage />, { repository: grouped() });
      await screen.findByRole('link', { name: 'Today story' });
      const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
      expect(headings.slice(0, 4)).toEqual(['Today', 'Yesterday', 'This week', 'Older']);
      const week = screen.getByRole('region', { name: 'This week' });
      expect(within(week).getByText('Week story')).toBeInTheDocument();
      const older = screen.getByRole('region', { name: 'Older' });
      expect(within(older).getByText('Older story')).toBeInTheDocument();
      const fold = within(older).getByText(/1 from over 30 days ago/).closest('details')!;
      expect(fold).not.toHaveAttribute('open');
      expect(fold).toContainElement(within(older).getByText('Stale story'));
    });

    it('Mark all read marks every unread story in one batch call', async () => {
      const repo = Object.assign(grouped(), { markMovesRead: vi.fn(async (_ids: string[]) => {}) });
      const { user } = renderWithProviders(<TodayPage />, { repository: repo });
      await screen.findByRole('link', { name: 'Today story' });
      await user.click(screen.getByRole('button', { name: 'Mark all read' }));
      expect(repo.markMovesRead).toHaveBeenCalledTimes(1);
      expect([...repo.markMovesRead.mock.calls[0]![0]].sort()).toEqual(['d_old', 'd_stale', 'd_today', 'd_week', 'd_yest']);
      expect(repo.markMoveRead).not.toHaveBeenCalled();
    });
  });

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
    expect(within(first).getByText(/Reuters · 15 Oct 2026/)).toBeInTheDocument();
    // A filing is dated by its EDGAR filing day, whatever the viewer's time zone.
    expect(screen.getByText(/SEC EDGAR · 14 Oct 2026/)).toBeInTheDocument();
    expect(screen.getByText(/1 new since your last visit/)).toBeInTheDocument();
    await waitFor(() => expect(repo.refreshMoves).toHaveBeenCalledTimes(1));
    expect(repo.refreshMoves).toHaveBeenCalledWith(expect.objectContaining({ force: false }));

    await user.click(within(first).getByRole('button', { name: 'Mark read' }));
    expect(repo.markMoveRead).toHaveBeenCalledWith('mv_1', true);
    await user.click(screen.getByRole('button', { name: 'Check now' }));
    expect(repo.refreshMoves).toHaveBeenLastCalledWith(expect.objectContaining({ force: true }));
    await user.click(screen.getByRole('tab', { name: 'Filings' }));
    expect(screen.queryByText('Acme Robotics raises $40M Series B')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unfollow Acme Robotics' }));
    expect(repo.unfollowCompany).toHaveBeenCalledWith('acme');
  });

  it('shows "12 of 104" progress as the Check button text while a look runs', async () => {
    const repo = todayRepo([acmeFollow], [move({})]);
    let finish: (r: MovesRefreshResult) => void = () => {};
    repo.refreshMoves.mockImplementation((options?: { onProgress?: (done: number, total: number) => void }) => new Promise<MovesRefreshResult>((resolve) => {
      options?.onProgress?.(12, 104);
      finish = resolve;
    }));
    renderWithProviders(<TodayPage />, { repository: repo });
    expect(await screen.findByRole('button', { name: 'Checking 12 of 104…' })).toBeDisabled();
    await act(async () => { finish({ added: 0, refreshed: 1, refreshedAt: new Date().toISOString() }); });
    expect(await screen.findByRole('button', { name: 'Check now' })).toBeEnabled();
  });

  it('with nothing followed it says how to follow and searches nothing', async () => {
    const repo = todayRepo([], []);
    renderWithProviders(<TodayPage />, { repository: repo });
    expect(await screen.findByText('Follow companies to see their moves here')).toBeInTheDocument();
    expect(repo.refreshMoves).not.toHaveBeenCalled();
  });

  it('the empty state says what really happens, names the sun icon and offers a way in', async () => {
    renderWithProviders(<TodayPage />, { repository: todayRepo([], []) });
    await screen.findByText('Follow companies to see their moves here');
    expect(document.body.textContent).not.toMatch(/each morning/i);
    expect(screen.getByText(/sun icon/)).toBeInTheDocument();
    expect(screen.getByText(/when you open it, and about once a day while it stays open/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open a deck' })).toHaveAttribute('href', '/history');
  });

  it('the no-moves state does not promise a morning check either', async () => {
    renderWithProviders(<TodayPage />, { repository: todayRepo([acmeFollow], []) });
    await screen.findByText('No moves found yet');
    expect(document.body.textContent).not.toMatch(/daily check|each morning/i);
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

    it('a write refused because of another window offers a reload instead of an error', async () => {
      const repo = todayRepo([acmeFollow], [move({})]);
      repo.markMoveRead.mockRejectedValueOnce(new AnotherWindowError());
      const { user } = renderWithProviders(<TodayPage />, { repository: repo });
      const headline = await screen.findByRole('link', { name: 'Acme Robotics raises $40M Series B' });
      await user.click(within(headline.closest('li')!).getByRole('button', { name: 'Mark read' }));
      expect(await screen.findByText('Another window changed your research. Reload to see it.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
      expect(screen.queryByText(/The check didn’t finish/)).not.toBeInTheDocument();
    });

    it('a check refused because of another window says so, with a Reload button', async () => {
      const repo = todayRepo([acmeFollow], [move({})]);
      repo.refreshMoves.mockRejectedValue(new AnotherWindowError());
      renderWithProviders(<TodayPage />, { repository: repo });
      expect(await screen.findByText('Another window changed your research. Reload to see it.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
      expect(screen.queryByText(/The check didn’t finish/)).not.toBeInTheDocument();
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

  describe('stays current while it is open', () => {
    let visibility: 'visible' | 'hidden' = 'visible';
    const setVisibility = (next: 'visible' | 'hidden') => {
      visibility = next;
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    };
    beforeEach(() => {
      visibility = 'visible';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    });
    afterEach(() => {
      vi.useRealTimers();
      Reflect.deleteProperty(document, 'visibilityState');
    });

    it('checks again when the person comes back to the tab, not when they leave it', async () => {
      const repo = todayRepo([acmeFollow], [move({})]);
      renderWithProviders(<TodayPage />, { repository: repo });
      await waitFor(() => expect(repo.refreshMoves).toHaveBeenCalledTimes(1));
      setVisibility('hidden');
      expect(repo.refreshMoves).toHaveBeenCalledTimes(1);
      setVisibility('visible');
      await waitFor(() => expect(repo.refreshMoves).toHaveBeenCalledTimes(2));
      // Never forced: the engine's 20 hour rule bounds what each look reads.
      expect(repo.refreshMoves).toHaveBeenLastCalledWith(expect.objectContaining({ force: false }));
    });

    it('checks hourly while open, and stops when Today is closed', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const repo = todayRepo([acmeFollow], [move({})]);
      const view = renderWithProviders(<TodayPage />, { repository: repo });
      await waitFor(() => expect(repo.refreshMoves).toHaveBeenCalledTimes(1));
      await act(async () => { vi.advanceTimersByTime(TODAY_RECHECK_MS - 1_000); });
      expect(repo.refreshMoves).toHaveBeenCalledTimes(1);
      await act(async () => { vi.advanceTimersByTime(1_000); });
      await waitFor(() => expect(repo.refreshMoves).toHaveBeenCalledTimes(2));
      view.unmount();
      await act(async () => { vi.advanceTimersByTime(3 * TODAY_RECHECK_MS); });
      expect(repo.refreshMoves).toHaveBeenCalledTimes(2);
    });

    it('does not start another check while one is still running', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const repo = todayRepo([acmeFollow], [move({})]);
      repo.refreshMoves.mockReturnValue(new Promise(() => {}));
      renderWithProviders(<TodayPage />, { repository: repo });
      await waitFor(() => expect(repo.refreshMoves).toHaveBeenCalledTimes(1));
      setVisibility('visible');
      await act(async () => { vi.advanceTimersByTime(2 * TODAY_RECHECK_MS); });
      expect(repo.refreshMoves).toHaveBeenCalledTimes(1);
    });

    it('shows stories a later check adds without a reload', async () => {
      const state = { moves: [move({})] };
      const repo = todayRepo([acmeFollow], []);
      repo.listMoves.mockImplementation(async () => [...state.moves]);
      repo.refreshMoves.mockImplementation(async () => {
        if (repo.refreshMoves.mock.calls.length > 1) {
          state.moves = [...state.moves, move({ id: 'mv_9', title: 'Acme Robotics opens a Texas plant', url: 'https://news.example/acme-tx', kind: 'launch', importance: 1 })];
        }
        return { added: state.moves.length - 1, refreshed: 1, refreshedAt: new Date().toISOString() };
      });
      renderWithProviders(<TodayPage />, { repository: repo });
      await screen.findByRole('link', { name: 'Acme Robotics raises $40M Series B' });
      expect(screen.queryByRole('link', { name: 'Acme Robotics opens a Texas plant' })).not.toBeInTheDocument();
      setVisibility('visible');
      expect(await screen.findByRole('link', { name: 'Acme Robotics opens a Texas plant' })).toBeInTheDocument();
    });

    it('does not hang on "checking now" when mounted twice (React StrictMode, follows already cached)', async () => {
      const repo = todayRepo([acmeFollow], [move({})]);
      renderWithProviders(<StrictMode><TodayPage /></StrictMode>, { repository: repo });
      await screen.findByRole('link', { name: 'Acme Robotics raises $40M Series B' });
      await waitFor(() => expect(screen.getByText(/checked just now/)).toBeInTheDocument());
      expect(screen.queryByText(/checking now/)).not.toBeInTheDocument();
    });
  });
});
