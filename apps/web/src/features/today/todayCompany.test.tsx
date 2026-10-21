import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { CompanyFollow, CompanyMove, DashboardTab, DashboardTabResult } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import TodayPage from './TodayPage';
import { FollowTodayButton } from './FollowTodayButton';

vi.mock('@/features/export/reportImages', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/features/export/reportImages')),
  resolveUpdateImages: vi.fn(async () => new Map()),
}));

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

async function setup(options: { follows?: CompanyFollow[]; moves?: CompanyMove[]; social?: boolean } = {}) {
  const base = makeRepo();
  const [market] = await base.listMarkets();
  const deck = (await base.getDeckByMarket(market!.id))!;
  const cards = await base.listCards(deck.id);
  const company = cards.find((c) => c.company && c.card.cardType === 'company')!.company!;
  const follows = options.follows ?? [{ companyId: company.id, companyName: company.name, followedAt: daysAgo(3) }];
  const moves: CompanyMove[] = options.moves ?? [
    { id: 'mv_1', companyId: company.id, companyName: company.name, kind: 'launch', importance: 3, title: `${company.name} launches a new model`, url: 'https://news.example/launch', publisher: 'Reuters', publishedAt: daysAgo(1), foundAt: daysAgo(0), source: 'news', readAt: null },
    { id: 'mv_2', companyId: company.id, companyName: company.name, kind: 'funding', importance: 2, title: `${company.name} raises money`, url: 'https://news.example/raise', publisher: 'Bloomberg', publishedAt: daysAgo(2), foundAt: daysAgo(1), source: 'news', readAt: null },
  ];
  const state = { moves: [...moves] };
  const peek = vi.fn(async (_id: string, tab: DashboardTab) => (tab === 'live_intel' && options.social !== false ? ({
    companyId: company.id, tab, lastRefreshedAt: daysAgo(1), content: { cadence: 'weekly', lastRefreshedAt: daysAgo(1), items: [
      { id: 'r1', source: 'reddit', title: 'Users are unhappy with the pricing change', url: 'https://reddit.com/r/x/1', summary: 'A long thread about pricing.', detail: null, publishedDate: daysAgo(1).slice(0, 10), sentiment: 'negative', publishedAt: daysAgo(1), stale: false },
      { id: 'n1', source: 'news', title: 'A story that belongs to the news feed', url: 'https://news.example/n1', summary: 'x', detail: null, publishedDate: null, sentiment: 'neutral', publishedAt: daysAgo(1), stale: false },
    ] },
  } as unknown as DashboardTabResult<'live_intel'>) : null));
  const original = base.getDashboardTab.bind(base);
  const getDashboardTab = vi.fn(async (...args: unknown[]) => original(args[0] as string, args[1] as DashboardTab));
  const repository = Object.assign(base, {
    listFollows: vi.fn(async () => follows),
    listMoves: vi.fn(async () => state.moves),
    refreshMoves: vi.fn(async () => ({ added: 0, refreshed: 1, refreshedAt: new Date().toISOString() })),
    markMoveRead: vi.fn(async (id: string, read: boolean) => { state.moves = state.moves.map((m) => (m.id === id ? { ...m, readAt: read ? new Date().toISOString() : null } : m)); }),
    followCompanies: vi.fn(async () => undefined),
    unfollowCompany: vi.fn(async () => undefined),
    peekDashboardTab: peek,
    getDashboardTab,
  });
  return { repository, company, peek, getDashboardTab };
}

const view = () => (
  <Routes><Route path="/today" element={<TodayPage />} /></Routes>
);

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('a company on Today', () => {
  it('opens with its card on the left and its dated, sourced updates on the right', async () => {
    const { repository, company } = await setup();
    renderWithProviders(view(), { repository, route: `/today?company=${company.id}` });
    const card = await screen.findByLabelText(`${company.name} card`);
    expect(card).toBeInTheDocument();
    const updates = await screen.findByLabelText(`${company.name} updates`);
    expect(await within(updates).findByRole('link', { name: `${company.name} launches a new model` })).toHaveAttribute('href', 'https://news.example/launch');
    expect(within(updates).getByText(/Reuters ·/)).toBeInTheDocument();
    // The social conversation comes from stored research, with the sentiment it was tagged with.
    const thread = within(updates).getByRole('link', { name: 'Users are unhappy with the pricing change' });
    expect(thread.closest('li')!).toHaveTextContent('negative');
    expect(thread.closest('li')!).toHaveTextContent('Reddit');
    // A news-source item in the research is not repeated as "social".
    expect(within(updates).queryByText('A story that belongs to the news feed')).not.toBeInTheDocument();
    expect(within(updates).getByText(/3 updates · 3 unread/)).toBeInTheDocument();
  });

  it('marks a move read through the engine and a social item read on this device', async () => {
    const { repository, company } = await setup();
    const { user } = renderWithProviders(view(), { repository, route: `/today?company=${company.id}` });
    const updates = await screen.findByLabelText(`${company.name} updates`);
    const move = (await within(updates).findByRole('link', { name: `${company.name} raises money` })).closest('li')!;
    await user.click(within(move).getByRole('button', { name: 'Mark read' }));
    await waitFor(() => expect(repository.markMoveRead).toHaveBeenCalledWith('mv_2', true));
    const social = within(updates).getByRole('link', { name: /Users are unhappy/ }).closest('li')!;
    await user.click(within(social).getByRole('button', { name: 'Mark read' }));
    await waitFor(() => expect(within(social).getByRole('button', { name: 'Mark unread' })).toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem('mi.today.socialRead')!)).toEqual([expect.stringMatching(/^social:/)]);
  });

  it('does not pad a short list and says so', async () => {
    const { repository, company } = await setup({ social: false, moves: [] });
    renderWithProviders(view(), { repository, route: `/today?company=${company.id}` });
    expect(await screen.findByText('Nothing dated in the last two months yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View full report/ })).toBeDisabled();
  });

  it('reads stored sentiment without researching, and only researches when asked', async () => {
    const { repository, company, peek, getDashboardTab } = await setup();
    const { user } = renderWithProviders(view(), { repository, route: `/today?company=${company.id}` });
    await screen.findByRole('link', { name: /Users are unhappy/ });
    expect(peek).toHaveBeenCalledWith(company.id, 'live_intel');
    expect(getDashboardTab).not.toHaveBeenCalledWith(company.id, 'live_intel', true);
    await user.click(screen.getByRole('button', { name: /Refresh social sentiment/ }));
    await waitFor(() => expect(getDashboardTab).toHaveBeenCalledWith(company.id, 'live_intel', true));
  });

  it('makes a report of the same updates', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { repository, company } = await setup();
    const { user } = renderWithProviders(view(), { repository, route: `/today?company=${company.id}` });
    await screen.findByRole('link', { name: /Users are unhappy/ });
    await user.click(screen.getByRole('button', { name: /View full report/ }));
    await waitFor(() => expect(print).toHaveBeenCalled());
    const doc = document.querySelector('.sm-print-doc')!;
    expect(doc.textContent).toContain(`${company.name} launches a new model`);
    expect(doc.textContent).toContain('Users are unhappy with the pricing change');
    expect(doc.textContent).toContain('Stratemark · Today');
    print.mockRestore();
  });

  it('lets you pick a company from the rail and go back to everyone', async () => {
    const { repository, company } = await setup();
    const { user } = renderWithProviders(view(), { repository, route: '/today' });
    const rail = await screen.findByRole('navigation', { name: 'Companies on Today' });
    await user.click(within(rail).getByRole('button', { name: new RegExp(company.name) }));
    expect(await screen.findByLabelText(`${company.name} updates`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All companies' }));
    await waitFor(() => expect(screen.queryByLabelText(`${company.name} updates`)).not.toBeInTheDocument());
  });
});

describe('the Today button next to a card\'s bookmark', () => {
  it('adds the company to Today and takes it off again', async () => {
    const { repository, company } = await setup({ follows: [] });
    const { user } = renderWithProviders(<FollowTodayButton companyId={company.id} companyName={company.name} />, { repository });
    await user.click(await screen.findByRole('button', { name: `Add ${company.name} to Today` }));
    await waitFor(() => expect(repository.followCompanies).toHaveBeenCalledWith([company.id]));
  });

  it('shows that the company is already on Today', async () => {
    const { repository, company } = await setup();
    const { user } = renderWithProviders(<FollowTodayButton companyId={company.id} companyName={company.name} />, { repository });
    const button = await screen.findByRole('button', { name: new RegExp(`Following ${company.name}`) });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await user.click(button);
    await waitFor(() => expect(repository.unfollowCompany).toHaveBeenCalledWith(company.id));
  });

  it('is not offered where the engine has no Today', async () => {
    const repository = Object.assign(makeRepo(), { followCompanies: undefined });
    renderWithProviders(<FollowTodayButton companyId="x" companyName="X" />, { repository });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
