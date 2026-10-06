import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { GoogleAuthProvider } from '@/lib/auth/AuthContext';
import { TaskManagerProvider } from '@/lib/tasks/TaskManagerContext';
import { DeepDiveProvider } from '@/features/deepdive/DeepDive';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { createQueryClient } from '@/lib/query/queryClient';
import { SentinelRepository } from '@/lib/repository/SentinelRepository';
import DeckPage from '@/features/deck/DeckPage';
import { Sidebar } from '@/components/layout/Sidebar';
import * as sentinelApi from '@/lib/sentinelApi';
import { useCards } from '@/hooks/data';
import { qk } from '@/lib/query/keys';

function TestWrapper({
  children,
  repo,
  queryClient = createQueryClient(),
}: {
  children: React.ReactNode;
  repo?: SentinelRepository;
  queryClient?: ReturnType<typeof createQueryClient>;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <GoogleAuthProvider>
        <TaskManagerProvider>
          <DeepDiveProvider>
            <RepositoryProvider repository={repo ?? new SentinelRepository()}>
              <MemoryRouter initialEntries={['/markets/deck_test_cloud/deck']}>
                {children}
              </MemoryRouter>
            </RepositoryProvider>
          </DeepDiveProvider>
        </TaskManagerProvider>
      </GoogleAuthProvider>
    </QueryClientProvider>
  );
}

function CardsProbe() {
  const cards = useCards('deck_ready');
  return <output data-testid="card-count">{cards.data?.length ?? -1}</output>;
}

describe('Cloud Deck Polling & UI State', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('SentinelRepository fetches updated deck and cards from cloud API when running', async () => {
    const repo = new SentinelRepository();
    repo.cacheCloudDeckResponse({
      ok: true,
      deckId: 'deck_async_1',
      state: { status: 'running' },
    });

    vi.spyOn(sentinelApi, 'getCloudDeck').mockResolvedValueOnce({
      deck: { id: 'deck_async_1', marketId: 'deck_async_1' },
      market: { id: 'deck_async_1', name: 'Cloud Market Test' },
      cards: [
        {
          id: 'c_1',
          deckId: 'deck_async_1',
          title: 'Autonomous Drone Co',
          cardType: 'company',
          tier: 3,
        },
      ],
      companies: [
        {
          id: 'comp_1',
          name: 'Autonomous Drone Co',
          oneLiner: 'Drone delivery startup',
        },
      ],
      metrics: [],
      viceClaims: [],
    });

    const deck = await repo.getDeckByMarket('deck_async_1');
    expect(sentinelApi.getCloudDeck).toHaveBeenCalledWith('deck_async_1');
    expect(deck?.id).toBe('deck_async_1');

    const cards = await repo.listCards('deck_async_1');
    expect(cards.length).toBe(1);
    expect(cards[0]?.card.title).toBe('Autonomous Drone Co');
  });

  it('DeckPage renders active Sentinel Cloud Agent research banner when running with 0 cards', async () => {
    const repo = new SentinelRepository();
    repo.cacheCloudDeckResponse({
      ok: true,
      deckId: 'deck_test_cloud',
      market: { id: 'deck_test_cloud', name: 'Frontier AI Research' },
      state: { status: 'running' },
    });

    vi.spyOn(sentinelApi, 'getCloudDeck').mockResolvedValue({
      deck: { id: 'deck_test_cloud', marketId: 'deck_test_cloud', status: 'running' },
      market: { id: 'deck_test_cloud', name: 'Frontier AI Research' },
      cards: [],
      companies: [],
      metrics: [],
      viceClaims: [],
      state: { status: 'running' },
    });

    render(
      <TestWrapper repo={repo}>
        <Routes>
          <Route path="/markets/:marketId/deck" element={<DeckPage />} />
        </Routes>
      </TestWrapper>
    );

    expect(
      await screen.findByText(/Preparing the cards before reveal/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Building evidence-ready card faces…/i)).toBeInTheDocument();
    expect(screen.queryByText(/No cards yet/i)).not.toBeInTheDocument();
  });

  it('opens on the first populated core category when an exact-scope deck has no company-role card', async () => {
    const repo = new SentinelRepository();
    const card = {
      id: 'card_microsoft_infrastructure',
      deckId: 'deck_test_cloud',
      companyId: 'company_microsoft',
      cardType: 'infrastructure' as const,
      title: null,
      summary: 'Microsoft provides cloud and AI infrastructure.',
      tier: null,
      tierReason: null,
      citations: [],
      keyPoints: [],
      createdAt: new Date().toISOString(),
    };
    const company = {
      id: 'company_microsoft',
      name: 'Microsoft Corporation',
      oneLiner: 'Cloud and AI infrastructure provider.',
      logoUrl: null,
      hqLocation: 'Redmond, Washington',
      websiteUrl: 'https://microsoft.com',
      brandTheme: null,
    };
    const secondCard = {
      ...card,
      id: 'card_coreweave_infrastructure',
      companyId: 'company_coreweave',
      title: 'CoreWeave',
      summary: 'CoreWeave provides cloud and AI infrastructure.',
    };
    const secondCompany = {
      ...company,
      id: 'company_coreweave',
      name: 'CoreWeave, Inc.',
      oneLiner: 'AI cloud infrastructure provider.',
      hqLocation: 'Livingston, New Jersey',
      websiteUrl: 'https://coreweave.com',
    };
    repo.cacheCloudDeckResponse({
      ok: true,
      deckId: 'deck_test_cloud',
      market: { id: 'deck_test_cloud', name: 'Selected company market' },
      cards: [card, secondCard],
      companies: [company, secondCompany],
    });
    vi.spyOn(sentinelApi, 'getCloudDeck').mockResolvedValue({
      deck: { id: 'deck_test_cloud', marketId: 'deck_test_cloud', status: 'ready' },
      market: {
        id: 'deck_test_cloud',
        name: 'Selected company market',
        scopeDefinition: { vertical: 'AI infrastructure', geography: null, notes: null },
        refreshCadence: 'weekly',
        createdAt: new Date().toISOString(),
      },
      cards: [card, secondCard],
      companies: [company, secondCompany],
      metrics: [],
      viceClaims: [],
    });

    render(
      <TestWrapper repo={repo}>
        <Routes>
          <Route path="/markets/:marketId/deck" element={<DeckPage />} />
        </Routes>
      </TestWrapper>,
    );

    expect(await screen.findByRole('button', { name: /microsoft corporation — infrastructure card/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /coreweave, inc\. — infrastructure card/i })).toBeInTheDocument();
    expect(screen.getByText(/2 infrastructure providers/i)).toBeInTheDocument();
    expect(screen.getByText('2 companies')).toBeInTheDocument();
  });

  it('DeckPage renders failed state when research fails', async () => {
    const repo = new SentinelRepository();
    repo.cacheCloudDeckResponse({
      ok: true,
      deckId: 'deck_test_cloud',
      market: { id: 'deck_test_cloud', name: 'Frontier AI Research' },
      state: { status: 'failed', error: 'Research timed out or was aborted' },
    });

    vi.spyOn(sentinelApi, 'getCloudDeck').mockResolvedValue({
      deck: { id: 'deck_test_cloud', marketId: 'deck_test_cloud', status: 'failed' },
      market: { id: 'deck_test_cloud', name: 'Frontier AI Research' },
      cards: [],
      companies: [],
      metrics: [],
      viceClaims: [],
      state: { status: 'failed', error: 'Research timed out or was aborted' },
    });

    render(
      <TestWrapper repo={repo}>
        <Routes>
          <Route path="/markets/:marketId/deck" element={<DeckPage />} />
        </Routes>
      </TestWrapper>
    );

    expect(await screen.findByText(/Research failed/i)).toBeInTheDocument();
    expect(screen.getByText(/Research timed out or was aborted/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry research/i })).toBeInTheDocument();
  });

  it('Sidebar renders pulsing dot for running cloud decks in recent list', async () => {
    vi.spyOn(sentinelApi, 'getCloudMarkets').mockResolvedValueOnce([
      {
        id: 'deck_running_1',
        name: 'Autonomous Delivery',
        status: 'running',
        createdAt: new Date().toISOString(),
      },
    ]);
    vi.spyOn(sentinelApi, 'getCloudDecks').mockResolvedValueOnce([]);

    render(
      <TestWrapper>
        <Sidebar />
      </TestWrapper>
    );

    expect(await screen.findByText('Autonomous Delivery')).toBeInTheDocument();
    expect(screen.getByTitle('Research in progress')).toBeInTheDocument();
  });

  it('keeps polling when a ready deck response arrives before its hydrated cards', async () => {
    vi.useFakeTimers();
    const repo = new SentinelRepository();
    const queryClient = createQueryClient();
    queryClient.setQueryData(qk.deck('deck_ready'), {
      id: 'deck_ready',
      marketId: 'deck_ready',
      status: 'ready',
    });
    const getCloudDeck = vi.spyOn(sentinelApi, 'getCloudDeck');
    getCloudDeck
      .mockResolvedValueOnce({
        deck: { id: 'deck_ready', marketId: 'deck_ready' },
        market: { id: 'deck_ready', name: 'Ready Market' },
        cards: [],
        companies: [],
        metrics: [],
        viceClaims: [],
        state: { status: 'ready' },
      })
      .mockResolvedValueOnce({
        deck: { id: 'deck_ready', marketId: 'deck_ready' },
        market: { id: 'deck_ready', name: 'Ready Market' },
        cards: [
          {
            card: {
              id: 'card_hydrated',
              deckId: 'deck_ready',
              companyId: 'company_1',
              cardType: 'company',
              tier: 3,
            },
            company: { id: 'company_1', name: 'Hydrated Co', oneLiner: 'A company' },
            metrics: [],
            viceClaims: [],
          },
        ],
        companies: [],
        metrics: [],
        viceClaims: [],
        state: { status: 'ready' },
      });

    render(
      <TestWrapper repo={repo} queryClient={queryClient}>
        <CardsProbe />
      </TestWrapper>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('card-count')).toHaveTextContent('0');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(screen.getByTestId('card-count')).toHaveTextContent('1');
    expect(getCloudDeck).toHaveBeenCalledTimes(2);
  });
});
