import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { CardWithCompany, Market, NativeCardEvidence } from '@mi/contracts';
import { useApiKey } from '@/lib/settings/apiKey';
import NativeSavedCardsPage from './NativeSavedCardsPage';

const at = '2026-10-01T12:00:00.000Z';
const clients: QueryClient[] = [];
function card(
  id: string,
  deckId: string,
  cardType: CardWithCompany['card']['cardType'],
): CardWithCompany {
  return {
    card: {
      id,
      deckId,
      companyId: 'company-1',
      cardType,
      title: 'Alder role',
      summary: `Retained ${id} context.`,
      tier: null,
      tierReason: null,
      citations: [{ url: `https://fixture.invalid/${id}`, title: `Source ${id}` }],
      keyPoints: [],
      createdAt: at,
    },
    company: {
      id: 'company-1',
      name: 'Alder Works',
      oneLiner: 'Fictional repairs.',
      hqLocation: null,
      logoUrl: null,
      websiteUrl: null,
      brandTheme: null,
    },
    metrics: [],
    viceClaims: [],
  };
}
function fixture() {
  const cards = [
    card('card-1', 'deck-1', 'company'),
    card('card-2', 'deck-1', 'infrastructure'),
    card('card-3', 'deck-2', 'company'),
  ];
  const saved = new Set(cards.map((entry) => entry.card.id));
  const markets: Market[] = [1, 2].map((number) => ({
    id: `market-${number}`,
    name: `Local market ${number}`,
    createdAt: at,
    refreshCadence: 'weekly',
    scopeDefinition: { vertical: 'Repairs', geography: null, notes: null },
  }));
  const forbidden = () => {
    throw new Error('Collection must not start research or open a dashboard');
  };
  const api = {
    storageMode: 'native',
    researchProvenance: 'synthetic_fixture',
    nativeResearchWritable: true,
    listSavedCards: vi.fn(async () => cards.filter((entry) => saved.has(entry.card.id))),
    saveCard: vi.fn(async (cardId: string) => {
      saved.add(cardId);
      return { cardId, savedAt: at };
    }),
    unsaveCard: vi.fn(async (cardId: string) => {
      saved.delete(cardId);
    }),
    listMarkets: vi.fn(async () => markets),
    listNativeRuns: vi.fn(async () =>
      [1, 2].map((number) => ({
        id: `run-${number}`,
        deckId: `deck-${number}`,
        marketId: `market-${number}`,
        status: 'completed',
        scope: { goal: 'Repairs' },
      })),
    ),
    getNativeCardEvidence: vi.fn(async (cardId: string): Promise<NativeCardEvidence> => ({
      cardId,
      sources: [
        {
          url: `https://fixture.invalid/${cardId}`,
          title: `Source ${cardId}`,
          retrievalStatus: 'retrieved',
          fetchedAt: at,
          text: `Synthetic retained ${cardId} text — not live research.`,
          sourceId: `source-${cardId}`,
          sourceRevision: 1,
          passageId: `passage-${cardId}`,
          support: 'unreviewed',
        },
      ],
    })),
    startNativeResearch: vi.fn(forbidden),
    controlNativeRun: vi.fn(forbidden),
    getDashboardTab: vi.fn(forbidden),
    listCards: vi.fn(forbidden),
    captureSource: vi.fn(forbidden),
  };
  Object.defineProperty(window, 'mi', { configurable: true, value: api });
  return { cards, saved, api };
}
function RouteProbe() {
  const location = useLocation();
  return (
    <output data-testid="saved-location">
      {location.pathname}
      {location.search}
    </output>
  );
}
function mount(route = '/saved') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } },
  });
  clients.push(qc);
  return {
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <RouteProbe />
          <NativeSavedCardsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
    user: userEvent.setup(),
    qc,
  };
}
beforeEach(() => {
  useApiKey.setState({ apiKey: '', hasKey: false });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('No paid or page calls in collection tests');
    }),
  );
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  clients.splice(0).forEach((qc) => qc.clear());
  expect(fetch).not.toHaveBeenCalled();
  if (window.mi)
    for (const method of [
      'startNativeResearch',
      'controlNativeRun',
      'getDashboardTab',
      'listCards',
      'captureSource',
    ] as const) {
      expect((window.mi as unknown as Record<string, unknown>)[method]).not.toHaveBeenCalled();
    }
  Reflect.deleteProperty(window, 'mi');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('native saved collection', () => {
  it.each([
    ['card-1', 'Local market 1', 'Local market 2'],
    ['card-3', 'Local market 2', 'Local market 1'],
  ])(
    'identifies the correct market inside the same-company same-role reader %s',
    async (id, name, other) => {
      fixture();
      mount(`/saved?card=${id}`);
      const dialog = within(await screen.findByRole('dialog'));
      expect(await dialog.findByText(`From ${name}`)).toBeVisible();
      expect(dialog.queryByText(`From ${other}`)).not.toBeInTheDocument();
      expect(dialog.getByRole('heading', { name: 'Alder Works' })).toBeVisible();
    },
  );
  it('shows the same retained role brief keyless through direct entry and keeps notes through removal/Undo', async () => {
    const native = fixture();
    native.cards[1]!.researchBrief = {
      sections: [
        {
          section: 'overview',
          blocks: [
            {
              id: 'overview',
              text: 'Retained infrastructure overview.',
              kind: 'reported',
              support: 'unreviewed',
              timeWindow: null,
              citations: [
                { title: 'Own saved note lead', url: 'https://fixture.invalid/own-note' },
              ],
            },
          ],
        },
        {
          section: 'offering',
          blocks: [
            {
              id: 'capabilities',
              text: 'Retained tooling capabilities.',
              kind: 'analysis',
              support: 'unreviewed',
              timeWindow: null,
              citations: [],
            },
          ],
        },
      ],
      openQuestions: ['Which tools are actually deployed?'],
      limitations: ['No semantic support review.'],
    };
    const { user } = mount('/saved?card=card-2');
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByText('Retained infrastructure overview.')).toBeVisible();
    expect(dialog.getByRole('link', { name: 'Own saved note lead' })).toHaveAttribute(
      'href',
      'https://fixture.invalid/own-note',
    );
    await user.click(dialog.getByRole('tab', { name: 'Capabilities' }));
    expect(dialog.getByText('Retained tooling capabilities.')).toBeVisible();
    expect(dialog.getByText('Analysis · unreviewed')).toBeVisible();
    expect(dialog.getByText('Period unknown')).toBeVisible();
    await user.click(await dialog.findByRole('button', { name: 'Show retained text' }));
    expect(dialog.getByText('Synthetic retained card-2 text — not live research.')).toBeVisible();
    await user.click(await dialog.findByRole('button', { name: 'Remove from saved' }));
    await user.click(await dialog.findByRole('button', { name: 'Undo removal' }));
    await waitFor(() => expect(native.saved.has('card-2')).toBe(true));
    expect(dialog.getByText('Retained tooling capabilities.')).toBeVisible();
    expect(dialog.getByText('Synthetic retained card-2 text — not live research.')).toBeVisible();
    expect(native.api.getNativeCardEvidence).toHaveBeenCalledTimes(1);
    expect(native.api.saveCard).toHaveBeenCalledWith('card-2');
    expect(native.api.unsaveCard).toHaveBeenCalledWith('card-2');
  });

  it('retains a directly resolved reader after removal and restores the exact card through Undo', async () => {
    const native = fixture();
    const { user } = mount('/saved?card=card-2&view=compact');
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(await dialog.findByRole('button', { name: 'Show retained text' }));
    expect(dialog.getByText('Synthetic retained card-2 text — not live research.')).toBeVisible();
    await user.click(await dialog.findByRole('button', { name: 'Remove from saved' }));
    await waitFor(() => expect(native.saved.has('card-2')).toBe(false));
    await waitFor(() => expect(native.api.listSavedCards.mock.calls.length).toBeGreaterThan(1));
    const undo = await screen.findByRole('button', { name: 'Undo removal' });
    expect(
      within(screen.getByRole('dialog')).getByRole('heading', { name: 'Alder Works' }),
    ).toBeVisible();
    expect(dialog.getByText('Infrastructure · Research collection')).toBeVisible();
    expect(dialog.getByText('Synthetic retained card-2 text — not live research.')).toBeVisible();
    expect(screen.getByTestId('saved-location')).toHaveTextContent(
      '/saved?card=card-2&view=compact',
    );
    expect(native.api.unsaveCard).toHaveBeenCalledWith('card-2');
    await user.click(undo);
    await waitFor(() => expect(native.saved.has('card-2')).toBe(true));
    expect(await dialog.findByRole('button', { name: 'Remove from saved' })).toBeEnabled();
    expect(native.api.saveCard).toHaveBeenCalledTimes(1);
    expect(native.api.saveCard).toHaveBeenCalledWith('card-2');
    expect(native.api.getNativeCardEvidence.mock.calls.map(([id]) => id)).toEqual(['card-2']);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Alder Works — Infrastructure card' })).toBeVisible();
    expect(screen.getByTestId('saved-location')).toHaveTextContent('/saved?view=compact');
  });

  it('keeps exact card/deck/role identities, opens saved evidence offline, and restores focus on Escape', async () => {
    const native = fixture();
    onlineManager.setOnline(false);
    const { user } = mount();
    const companies = await screen.findAllByRole('button', { name: 'Alder Works — Company card' });
    expect(companies).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Alder Works — Infrastructure card' })).toBeVisible();
    expect(screen.getByText('3 saved cards')).toBeVisible();
    expect(screen.getAllByText('Local market 1')).toHaveLength(2);
    expect(screen.getByText('Local market 2')).toBeVisible();
    expect(native.api.getNativeCardEvidence).not.toHaveBeenCalled();
    await user.click(companies[1]!);
    const dialog = within(await screen.findByRole('dialog'));
    await dialog.findByRole('button', { name: 'Show retained text' });
    await user.click(dialog.getByRole('button', { name: 'Show retained text' }));
    expect(dialog.getByText('Synthetic retained card-3 text — not live research.')).toBeVisible();
    expect(dialog.getByTitle(at)).toHaveAttribute('datetime', at);
    expect(dialog.getByText('Retrieved · support unreviewed')).toBeVisible();
    expect(dialog.getByText(/Synthetic fixture material · no live research/)).toBeVisible();
    expect(native.api.getNativeCardEvidence).toHaveBeenCalledWith('card-3');
    expect(native.api.unsaveCard).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(companies[1]).toHaveFocus());
    expect(screen.getAllByRole('link', { name: 'Open source deck' })[2]).toHaveAttribute(
      'href',
      '/markets/market-2/deck?card=card-3&type=company',
    );
  });

  it('removes only after confirmation, keeps the reader/research intact, and supports explicit guarded undo', async () => {
    const native = fixture();
    let finish!: () => void;
    native.api.unsaveCard.mockImplementationOnce(
      (id) =>
        new Promise((resolve) => {
          finish = () => {
            native.saved.delete(id);
            resolve();
          };
        }),
    );
    const { user } = mount();
    await user.click(
      await screen.findByRole('button', { name: 'Alder Works — Infrastructure card' }),
    );
    const dialog = within(await screen.findByRole('dialog'));
    const remove = await dialog.findByRole('button', { name: 'Remove from saved' });
    await user.click(remove);
    expect(remove).toBeDisabled();
    expect(native.saved.size).toBe(3);
    expect(dialog.queryByText(/Removed from saved/)).not.toBeInTheDocument();
    await act(async () => finish());
    expect(
      await dialog.findByText(/Removed from saved.*Research and sources remain/),
    ).toBeVisible();
    expect(native.cards).toHaveLength(3);
    expect(native.saved.has('card-2')).toBe(false);
    expect(dialog.getByRole('heading', { name: 'Alder Works' })).toBeVisible();
    expect(native.api.unsaveCard).toHaveBeenCalledWith('card-2');
    await user.click(dialog.getByRole('button', { name: 'Undo removal' }));
    await waitFor(() => expect(native.saved.has('card-2')).toBe(true));
    expect(await dialog.findByRole('button', { name: 'Remove from saved' })).toBeEnabled();
    expect(native.api.saveCard).toHaveBeenCalledWith('card-2');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Alder Works — Infrastructure card' })).toBeVisible();
  });

  it('retains the collection and permits retry after a failed removal', async () => {
    const native = fixture();
    native.api.unsaveCard.mockRejectedValueOnce(new Error('Collection write failed'));
    const { user } = mount();
    await user.click(
      await screen.findByRole('button', { name: 'Alder Works — Infrastructure card' }),
    );
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(await dialog.findByRole('button', { name: 'Remove from saved' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent(/could not be removed/i);
    expect(native.saved.size).toBe(3);
    expect(dialog.getByRole('button', { name: 'Remove from saved' })).toBeEnabled();
    await user.click(dialog.getByRole('button', { name: 'Remove from saved' }));
    await dialog.findByText(/Removed from saved/);
    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('button', { name: 'Alder Works — Infrastructure card' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Saved cards' })).toHaveFocus();
  });

  it('reopens the stored collection and source text using a fresh client without resaving or dashboard calls', async () => {
    const native = fixture();
    const first = mount();
    await first.user.click(
      await screen.findByRole('button', { name: 'Alder Works — Infrastructure card' }),
    );
    first.unmount();
    const reopened = mount();
    await reopened.user.click(
      await screen.findByRole('button', { name: 'Alder Works — Infrastructure card' }),
    );
    const dialog = within(await screen.findByRole('dialog'));
    await reopened.user.click(await dialog.findByRole('button', { name: 'Show retained text' }));
    expect(dialog.getByText('Synthetic retained card-2 text — not live research.')).toBeVisible();
    expect(native.api.listSavedCards.mock.calls.length).toBeGreaterThan(1);
    expect(native.api.saveCard).not.toHaveBeenCalled();
    expect(native.api.unsaveCard).not.toHaveBeenCalled();
    expect(native.api.getNativeCardEvidence.mock.calls.map(([id]) => id)).toEqual([
      'card-2',
      'card-2',
    ]);
  });

  it('reads saved evidence keyless in read-only mode and blocks removal with an explanation', async () => {
    const native = fixture();
    native.api.nativeResearchWritable = false;
    const { user } = mount();
    await user.click(
      await screen.findByRole('button', { name: 'Alder Works — Infrastructure card' }),
    );
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByRole('button', { name: 'Remove from saved' })).toBeDisabled();
    expect(
      dialog.getByText(/Collection changes are disabled.*Saved cards and sources remain readable/),
    ).toBeVisible();
    await user.click(await dialog.findByRole('button', { name: 'Show retained text' }));
    expect(dialog.getByText('Synthetic retained card-2 text — not live research.')).toBeVisible();
    expect(native.api.unsaveCard).not.toHaveBeenCalled();
  });

  it('shows honest empty and load-failure states with a saved-read-only retry', async () => {
    const native = fixture();
    native.saved.clear();
    native.api.listSavedCards.mockRejectedValueOnce(new Error('Vault unavailable'));
    const { user } = mount();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Saved cards could not be read/);
    await user.click(screen.getByRole('button', { name: 'Retry saved cards' }));
    expect(await screen.findByText('No saved cards yet')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Browse Library' })).toHaveAttribute(
      'href',
      '/library',
    );
    expect(native.api.saveCard).not.toHaveBeenCalled();
  });
});
