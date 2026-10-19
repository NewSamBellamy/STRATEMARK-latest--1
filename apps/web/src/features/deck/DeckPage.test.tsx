import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { useApiKey } from '@/lib/settings/apiKey';
import DeckPage from './DeckPage';

describe('DeckPage for a deck that no longer exists', () => {
  it('shows only the not-found state, with no deck chrome or live deck actions', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/markets/:marketId/deck" element={<DeckPage />} />
      </Routes>,
      { route: '/markets/mkt_deleted_long_ago/deck' },
    );

    expect(await screen.findByRole('heading', { name: /this deck's research isn't here/i })).toBeInTheDocument();
    expect(screen.getByText(/no longer exists in your library/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All decks' })).toHaveAttribute('href', '/history');

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByTestId('demo-banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /compare/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /briefing/i })).not.toBeInTheDocument();
  });
});

describe('DeckPage header', () => {
  it('keeps four controls, with report, share and download behind one Share & export menu', async () => {
    const repository = makeRepo();
    const [market] = await repository.listMarkets();
    const { user } = renderWithProviders(
      <Routes>
        <Route path="/markets/:marketId/deck" element={<DeckPage />} />
      </Routes>,
      { route: `/markets/${market!.id}/deck`, repository },
    );

    const compare = await screen.findByRole('button', { name: 'Compare' });
    const bar = compare.parentElement!;
    expect(bar.children.length).toBeLessThanOrEqual(4);
    expect(within(bar).getByRole('button', { name: /^Ask/ })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Share & export' })).toBeInTheDocument();
    // Moved out of the header, still one click away.
    expect(within(bar).queryByRole('link', { name: /briefing/i })).not.toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: /^Chats/ })).not.toBeInTheDocument();

    await user.click(within(bar).getByRole('button', { name: 'Share & export' }));
    expect(await screen.findByRole('menuitem', { name: /create report/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /share link/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /deck report \(pdf\)/i })).toBeInTheDocument();

    await user.click(within(bar).getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('link', { name: /daily briefing/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /past chats/i })).toBeInTheDocument();
  });
});

describe('an empty market-signal tab', () => {
  afterEach(() => { useApiKey.setState({ apiKey: '', hasKey: false }); });

  it('searches for the missing cards through the deck, not as a hunt for new companies', async () => {
    useApiKey.setState({ apiKey: 'test-placeholder', hasKey: true });
    const repository = makeRepo();
    const [market] = await repository.listMarkets();
    const deck = (await repository.getDeckByMarket(market!.id))!;
    const all = await repository.listCards(deck.id);
    vi.spyOn(repository, 'listCards').mockResolvedValue(all.filter((c) => c.card.cardType !== 'vice'));
    const ensure = vi.fn().mockResolvedValue({ added: { barrier: 0, insight: 0, vice: 2, culture: 0 }, failed: false });
    const expandDeck = vi.spyOn(repository, 'expandDeck');
    Object.assign(repository, { ensureSignalCards: ensure });
    const { user } = renderWithProviders(
      <Routes>
        <Route path="/markets/:marketId/deck" element={<DeckPage />} />
      </Routes>,
      { route: `/markets/${market!.id}/deck?type=vice`, repository },
    );
    await user.click(await screen.findByRole('button', { name: /hunt for .* in this market/i }));
    expect(ensure).toHaveBeenCalledWith(deck.id, { force: true });
    expect(expandDeck).not.toHaveBeenCalled();
    expect(await screen.findByText(/Found 2 new cards/)).toBeInTheDocument();
  });
});
