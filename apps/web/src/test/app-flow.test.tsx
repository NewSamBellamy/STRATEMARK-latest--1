import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRoutes } from '@/routes';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { AuthProvider } from '@/lib/auth/AuthContext';
import { DeepDiveProvider } from '@/features/deepdive/DeepDive';
import { createQueryClient } from '@/lib/query/queryClient';
import { makeRepo } from './test-utils';
import { useApiKey } from '@/lib/settings/apiKey';
import { useAgentTrace } from '@/lib/agentic/agentTrace';

function renderApp(repository = makeRepo(), initialRoute = '/') {
  const dashboardResearch = vi.spyOn(repository, 'getDashboardTab');
  return {
    user: userEvent.setup(),
    dashboardResearch,
    ...render(
      <RepositoryProvider repository={repository}>
        <QueryClientProvider client={createQueryClient()}>
          <AuthProvider>
            <DeepDiveProvider>
              <MemoryRouter initialEntries={[initialRoute]}>
                <AppRoutes />
              </MemoryRouter>
            </DeepDiveProvider>
          </AuthProvider>
        </QueryClientProvider>
      </RepositoryProvider>,
    ),
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, 'mi');
  useApiKey.setState({ apiKey: '', hasKey: false });
  useAgentTrace.setState({ jobs: [] });
});

const FIND = { timeout: 20000 } as const;
const STAGE_FIND = { timeout: 2500 } as const;

describe('end-to-end deck flow (markets → deck → 2-level split → card → dashboard)', () => {
  it('navigates the full journey against the mock repository', { timeout: 20000 }, async () => {
    const { user, dashboardResearch } = renderApp();

    // Navigate directly to the deck via the inline recent decks sidebar link.
    const marketLink = await screen.findByRole('link', { name: /Christian Apparel/i }, FIND);
    await user.click(marketLink);

    // Level 0 — full deck with the persistent card-type nav. Filtering happens
    // The type nav should be visible with company cards shown by default.
    expect(await screen.findByTestId('type-nav', undefined, FIND)).toBeInTheDocument();

    // Open a company card → reader → dashboard.
    const card = await screen.findByRole('button', { name: /GraceWear Global/ }, FIND);
    await user.click(card);
    const dialog = await screen.findByRole('dialog', undefined, FIND);
    await user.click(within(dialog).getByRole('link', { name: /explore research/i }));

    // The card opens into an immediate evidence brief. Live dashboard research
    // starts only when the user explicitly opens a deeper view.
    expect(await screen.findByText('Company brief', undefined, FIND)).toBeInTheDocument();
    expect(screen.getByText('Most useful public figures')).toBeInTheDocument();
    expect(dashboardResearch).not.toHaveBeenCalled();
    // The overview shortcut must preserve deck/card context just like the tab,
    // otherwise the dashboard loses the "Back to card" journey.
    await user.click(screen.getByRole('link', { name: /See all metrics/i }));
    expect(await screen.findByText(/Revenue trend/i, undefined, FIND)).toBeInTheDocument();
    expect(screen.getByText('Cap table')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to card' }));
    const reopened = await screen.findByRole('dialog', undefined, FIND);
    expect(within(reopened).getAllByText('GraceWear Global').length).toBeGreaterThan(0);
    expect(within(reopened).getByRole('button', { name: 'Next card' })).toBeInTheDocument();
  });

  it('keeps company comparison selectable inside the scale-band-grouped view', async () => {
    const { user } = renderApp();
    const marketLink = await screen.findByRole('link', { name: /Christian Apparel/i }, FIND);
    await user.click(marketLink);
    expect(await screen.findByTestId('type-nav', undefined, FIND)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /group by scale band/i }));
    expect(
      await screen.findByText(/Companies grouped by size-signal band/i, undefined, FIND),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Compare' }));
    await user.click(await screen.findByRole('button', { name: /GraceWear Global/i }, FIND));
    await user.click(await screen.findByRole('button', { name: /CrossThread Labs/i }, FIND));

    expect(screen.getByText('2 cards selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ask about these/i })).toBeEnabled();
  });

  it(
    'keeps staged archive navigation read-only and labels unreviewed research',
    { timeout: 20000 },
    async () => {
      Object.defineProperty(window, 'mi', {
        configurable: true,
        value: { storageMode: 'staged_readonly' },
      });
      const repository = makeRepo();
      const createMarket = vi.spyOn(repository, 'createMarket');
      const refreshDeck = vi.spyOn(repository, 'refreshDeck');
      const saveCard = vi.spyOn(repository, 'saveCard');
      const listCards = repository.listCards.bind(repository);
      vi.spyOn(repository, 'listCards').mockImplementation(async (deckId, filter) =>
        (await listCards(deckId, filter)).map((card) => ({
          ...card,
          marketRoles: ['company', 'infrastructure'],
          evidenceState: 'legacy_unreviewed',
          company: card.company ? { ...card.company, logoUrl: null } : null,
          metrics: [],
          citations: [],
        })),
      );
      const deleteMarket = vi.spyOn(repository, 'deleteMarket');
      const { user } = renderApp(repository);

      expect(await screen.findByText('Read-only migration preview')).toBeInTheDocument();
      expect(
        within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', {
          name: 'Library',
        }),
      ).toHaveTextContent('Library');
      expect(screen.getByText(/Older research has not been revalidated/)).toBeInTheDocument();
      const marketLink = await screen.findByRole(
        'button',
        { name: /Open Christian Apparel/i },
        STAGE_FIND,
      );
      await user.click(marketLink);
      expect(await screen.findByTestId('role-nav', undefined, STAGE_FIND)).toBeInTheDocument();
      const infrastructure = screen.getByRole('button', { name: /Infrastructure/i });
      await user.click(infrastructure);

      const card = await screen.findByRole('button', { name: /GraceWear Global/i }, STAGE_FIND);
      await user.click(card);
      expect(await screen.findByRole('dialog', undefined, STAGE_FIND)).toBeInTheDocument();
      expect(screen.getByText(/legacy research has not been reviewed/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /save card/i })).not.toBeInTheDocument();

      await user.click(screen.getByRole('link', { name: /explore research/i }));
      expect(await screen.findByRole('heading', { name: 'GraceWear Global' })).toBeInTheDocument();
      await user.click(screen.getByRole('link', { name: 'Metrics' }));
      expect(
        await screen.findByText(/saved detail for this section is not available/i),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /back to card/i }));
      expect(await screen.findByRole('dialog', undefined, STAGE_FIND)).toBeInTheDocument();

      expect(createMarket).not.toHaveBeenCalled();
      expect(refreshDeck).not.toHaveBeenCalled();
      expect(saveCard).not.toHaveBeenCalled();
      expect(deleteMarket).not.toHaveBeenCalled();
    },
  );

  it('does not dispatch a queued hunt or refresh in staged mode even when an old key exists', () => {
    Object.defineProperty(window, 'mi', {
      configurable: true,
      value: { storageMode: 'staged_readonly' },
    });
    useApiKey.setState({ apiKey: 'retained-key', hasKey: true });
    useAgentTrace.setState({
      jobs: [
        {
          id: 'queued-hunt',
          marketId: 'market-1',
          focus: {},
          label: 'Queued hunt',
          status: 'queued',
          added: null,
        },
      ],
    });
    const repository = makeRepo();
    const expandDeck = vi.spyOn(repository, 'expandDeck');
    const refreshDeck = vi.spyOn(repository, 'refreshDeck');

    renderApp(repository);

    expect(useAgentTrace.getState().jobs[0]?.status).toBe('queued');
    expect(expandDeck).not.toHaveBeenCalled();
    expect(refreshDeck).not.toHaveBeenCalled();
  });
  it('opens a legacy distribution deep link as a role filter without hiding its company', async () => {
    Object.defineProperty(window, 'mi', {
      configurable: true,
      value: { storageMode: 'staged_readonly' },
    });
    const repository = makeRepo();
    const listCards = repository.listCards.bind(repository);
    vi.spyOn(repository, 'listCards').mockImplementation(async (deckId, filter) =>
      (await listCards(deckId, filter)).map((card) => ({
        ...card,
        marketRoles: ['company', 'distribution'],
        evidenceState: 'legacy_unreviewed',
      })),
    );
    const market = (await repository.listMarkets())[0]!;
    renderApp(repository, `/markets/${market.id}/deck?type=distribution`);
    expect(
      await screen.findByRole('button', { name: /GraceWear Global/i }, STAGE_FIND),
    ).toBeInTheDocument();
    expect(screen.getByTestId('role-nav')).toBeInTheDocument();
  });

  it.each([
    '/reports',
    '/saved',
    '/markets/market-1/briefing',
    '/share/not-a-preview-route',
  ] as const)(
    'routes archived or unsupported direct link %s back to the preview library',
    async (initialRoute) => {
      Object.defineProperty(window, 'mi', {
        configurable: true,
        value: { storageMode: 'staged_readonly' },
      });
      renderApp(makeRepo(), initialRoute);
      expect(
        await screen.findByRole('heading', { name: 'All decks' }, STAGE_FIND),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Archived reports, findings, and saved items remain retained/i),
      ).toBeInTheDocument();
    },
  );
});
