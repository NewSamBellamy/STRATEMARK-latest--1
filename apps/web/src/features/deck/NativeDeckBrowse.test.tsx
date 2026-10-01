import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { CardWithCompany, MarketIntelRepository, NativeResearchRun } from '@mi/contracts';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import NativeDeckPage from './NativeDeckPage';

const at = '2026-10-01T12:00:00.000Z';
const path = '/markets/market-1/deck';
const clients: QueryClient[] = [];
function card(
  id: string,
  name: string,
  cardType: CardWithCompany['card']['cardType'],
  summary: string,
  title: string,
): CardWithCompany {
  return {
    card: {
      id,
      deckId: 'deck-1',
      companyId: name,
      cardType,
      title,
      summary,
      tier: 7,
      tierReason: null,
      citations: [],
      keyPoints: id === 'alder-company' ? ['Work orders stay offline'] : [],
      createdAt: at,
    },
    company: {
      id: name,
      name,
      oneLiner: name === 'Birch Works' ? 'Spare parts specialist' : '',
      hqLocation: null,
      websiteUrl: null,
      logoUrl: null,
      brandTheme: null,
    },
    metrics: [],
    viceClaims: [],
  };
}
function fixture(status: NativeResearchRun['status'] = 'completed', empty = false) {
  const cards = empty
    ? []
    : [
        card('alder-company', 'Alder Works', 'company', 'Dispatch scheduling', 'Repair teams'),
        card(
          'alder-infra',
          'Alder Works',
          'infrastructure',
          'Maintenance tooling',
          'Repair toolchain',
        ),
        card('birch-company', 'Birch Works', 'company', 'Replacement inventory', 'Repair supply'),
        card('maple-channel', 'Maple Network', 'distribution', 'Delivery windows', 'Local routes'),
      ];
  const run: NativeResearchRun = {
    id: 'run-1',
    marketId: 'market-1',
    deckId: 'deck-1',
    requestKey: 'fixture-key',
    requestFingerprint: 'fixture-fingerprint',
    scope: {
      goal: 'Repair ecosystem',
      inclusions: [],
      exclusions: [],
      region: null,
      depth: 'quick',
      seeds: [],
    },
    maxCompanies: 12,
    limits: { maxRequests: 10, maxInputTokens: 1000, maxOutputTokens: 1000, maxSourceRequests: 12 },
    status,
    generation: 0,
    usage: { requests: 3, sourceRequests: 2, inputTokens: 100, outputTokens: 50, complete: true },
    createdAt: at,
    updatedAt: at,
    error: status === 'failed' ? 'Saved fixture failure' : null,
  };
  const forbidden = vi.fn(async () => {
    throw new Error('Browsing must not start research or mutate data');
  });
  const api = {
    storageMode: 'native',
    researchProvenance: 'synthetic_fixture',
    nativeResearchWritable: false,
    listNativeRuns: vi.fn(async () => [run]),
    nativeRunEvents: vi.fn(async () => []),
    onDeckRefresh: vi.fn(() => () => {}),
    listSavedCards: vi.fn(async () => []),
    getNativeCardEvidence: vi.fn(async (cardId: string) => ({ cardId, sources: [] })),
    startNativeResearch: forbidden,
    controlNativeRun: forbidden,
    saveCard: forbidden,
    unsaveCard: forbidden,
  };
  const repository = {
    getMarket: vi.fn(async () => ({
      id: 'market-1',
      name: 'Repair ecosystem',
      createdAt: at,
      refreshCadence: 'weekly',
      scopeDefinition: { vertical: 'Repair', geography: null, notes: null },
    })),
    getDeckByMarket: vi.fn(async () => ({
      id: 'deck-1',
      marketId: 'market-1',
      createdAt: at,
      lastRefreshedAt: null,
    })),
    listCards: vi.fn(async () => cards),
    getDashboardTab: forbidden,
    refreshDeck: forbidden,
  };
  Object.defineProperty(window, 'mi', { configurable: true, value: api });
  return { api, repository, forbidden };
}
function mount(native: ReturnType<typeof fixture>, route = path) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } },
  });
  clients.push(qc);
  const router = {
    location: { search: '' },
    navigate: (_delta: number) => {},
  };
  function NavigationProbe() {
    router.location = useLocation();
    router.navigate = useNavigate();
    return null;
  }
  render(
    <RepositoryProvider repository={native.repository as unknown as MarketIntelRepository}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <NavigationProbe />
          <Routes>
            <Route path="/markets/:marketId/deck" element={<NativeDeckPage />} />
            <Route path="/library" element={<h1>Library</h1>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </RepositoryProvider>,
  );
  return { user: userEvent.setup(), router };
}
function expectLocalOnly(native: ReturnType<typeof fixture>) {
  expect(native.forbidden).not.toHaveBeenCalled();
  expect(window.fetch).not.toHaveBeenCalled();
  expect(native.repository.listCards).toHaveBeenCalledTimes(1);
  expect(native.api.getNativeCardEvidence).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('No network in browsing tests');
    }),
  );
});
afterEach(() => {
  cleanup();
  for (const qc of clients.splice(0)) qc.clear();
  Object.defineProperty(window, 'mi', { configurable: true, value: undefined });
  vi.unstubAllGlobals();
});

describe('native deck local browsing', () => {
  it.each([
    ['  aLdEr  ', 2],
    ['dispatch', 1],
    ['repair toolchain', 1],
    ['work orders', 1],
    ['spare parts specialist', 1],
    ['   ', 4],
  ])('restores case-insensitive retained text search %j from the URL', async (q, count) => {
    const native = fixture();
    mount(native, `${path}?q=${encodeURIComponent(q)}`);
    expect(await screen.findByText(`Showing ${count} of 4 cards`)).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Search this deck' })).toHaveValue(q);
    expect(screen.getAllByRole('button', { name: / — .+ card$/ })).toHaveLength(count);
    expectLocalOnly(native);
  });

  it('combines search with actual retained types, preserving unrelated URL parameters', async () => {
    const native = fixture();
    const { user, router } = mount(native, `${path}?view=retained`);
    const search = await screen.findByRole('searchbox', { name: 'Search this deck' });
    await screen.findByText('Showing 4 of 4 cards');
    await user.type(search, 'Alder');
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Infrastructure' }));
    expect(screen.getByText('Showing 1 of 4 cards')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Alder Works — Infrastructure card' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Alder Works — Company card' }),
    ).not.toBeInTheDocument();
    const params = new URLSearchParams(router.location.search);
    expect(Object.fromEntries(params)).toEqual({
      view: 'retained',
      q: 'Alder',
      type: 'infrastructure',
    });
    expect(screen.getByRole('button', { name: 'Infrastructure' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: 'Community' })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /Passage verification, other card categories, sharing, questions and monitoring are still being built/,
      ),
    ).toBeVisible();
    expectLocalOnly(native);
  });

  it('clears only the search, then resets both search and type from an empty result', async () => {
    const native = fixture();
    const { user, router } = mount(native, `${path}?q=Alder&type=company&view=retained`);
    await screen.findByText('Showing 1 of 4 cards');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Showing 2 of 4 cards')).toBeVisible();
    expect(new URLSearchParams(router.location.search).get('type')).toBe('company');
    expect(new URLSearchParams(router.location.search).has('q')).toBe(false);
    await user.type(
      screen.getByRole('searchbox', { name: 'Search this deck' }),
      'not in this deck',
    );
    expect(screen.getByText('Showing 0 of 4 cards')).toBeVisible();
    expect(screen.getByText('No cards match your search and filters.')).toBeVisible();
    expect(
      screen.queryByText(/Retained activity explains incomplete research/),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset search and filters' }));
    expect(screen.getByText('Showing 4 of 4 cards')).toBeVisible();
    expect(router.location.search).toBe('?view=retained');
    expect(screen.getByRole('searchbox', { name: 'Search this deck' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'All cards' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expectLocalOnly(native);
  });

  it('recovers from an unknown type without advertising unsupported categories', async () => {
    const native = fixture();
    const { user, router } = mount(native, `${path}?type=unknown`);
    await screen.findByText('Showing 0 of 4 cards');
    await user.click(screen.getByRole('button', { name: 'Reset search and filters' }));
    expect(screen.getByText('Showing 4 of 4 cards')).toBeVisible();
    expect(router.location.search).toBe('');
    expectLocalOnly(native);
  });

  it.each(['Close', 'Escape'] as const)(
    'returns to the same filtered view and opener after reader %s',
    async (close) => {
      const native = fixture();
      const { user, router } = mount(native, `${path}?q=Alder&type=infrastructure`);
      const opener = await screen.findByRole('button', {
        name: 'Alder Works — Infrastructure card',
      });
      await user.click(opener);
      const dialog = within(await screen.findByRole('dialog'));
      expect(new URLSearchParams(router.location.search).get('card')).toBe('alder-infra');
      await waitFor(() =>
        expect(native.api.getNativeCardEvidence).toHaveBeenCalledWith('alder-infra'),
      );
      if (close === 'Close') await user.click(dialog.getByRole('button', { name: 'Close' }));
      else await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(Object.fromEntries(new URLSearchParams(router.location.search))).toEqual({
        q: 'Alder',
        type: 'infrastructure',
      });
      expect(screen.getByText('Showing 1 of 4 cards')).toBeVisible();
      await waitFor(() => expect(opener).toHaveFocus());
      expect(native.forbidden).not.toHaveBeenCalled();
      expect(window.fetch).not.toHaveBeenCalled();
      expect(native.repository.listCards).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps typed search as one history entry and restores the reader through Back/Forward', async () => {
    const native = fixture();
    const { user, router } = mount(native);
    await screen.findByText('Showing 4 of 4 cards');
    await user.type(screen.getByRole('searchbox', { name: 'Search this deck' }), 'Alder');
    await user.click(screen.getByRole('button', { name: 'Infrastructure' }));
    await user.click(screen.getByRole('button', { name: 'Alder Works — Infrastructure card' }));
    await screen.findByRole('dialog');
    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(router.location.search).toBe('?q=Alder&type=infrastructure');
    await act(async () => {
      await router.navigate(1);
    });
    await screen.findByRole('dialog');
    expect(new URLSearchParams(router.location.search).get('card')).toBe('alder-infra');
    await act(async () => {
      await router.navigate(-2);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(router.location.search).toBe('?q=Alder');
    expect(screen.getByText('Showing 2 of 4 cards')).toBeVisible();
    expect(native.forbidden).not.toHaveBeenCalled();
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it.each(['running', 'failed'] as const)(
    'preserves %s disclosures, usage and read-only controls in genuinely empty decks',
    async (status) => {
      const native = fixture(status, true);
      mount(native);
      expect(await screen.findByText('Showing 0 of 0 cards')).toBeVisible();
      expect(
        screen.getByText(
          status === 'running'
            ? 'Research is underway. Cards appear after their results have been saved.'
            : 'No saved cards in this view. Retained activity explains incomplete research.',
        ),
      ).toBeVisible();
      expect(
        screen.getByRole('button', {
          name: status === 'running' ? 'Pause' : 'Resume remaining work',
        }),
      ).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      expect(
        screen.getByText(/3 provider attempts · 2 source attempts.*Dollar cost not available/),
      ).toBeVisible();
      expect(
        screen.getByText(/Synthetic fixture research.*No provider calls or live research/),
      ).toBeVisible();
      expect(
        screen.getByText(/Research is disabled on this provenance-preserving reopen/),
      ).toBeVisible();
      if (status === 'failed') expect(screen.getByText('Saved fixture failure')).toBeVisible();
      expectLocalOnly(native);
    },
  );
});
