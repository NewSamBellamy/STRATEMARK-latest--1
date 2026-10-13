import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/test-utils';
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
