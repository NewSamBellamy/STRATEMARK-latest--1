import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
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
