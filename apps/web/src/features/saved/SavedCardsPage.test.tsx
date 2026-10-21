import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import SavedCardsPage from './SavedCardsPage';

describe('the Saved Cards page', () => {
  it('when empty, says where to bookmark and offers to open a deck', async () => {
    const repository = makeRepo();
    vi.spyOn(repository, 'listSavedCards').mockResolvedValue([]);
    renderWithProviders(<SavedCardsPage />, { repository });
    expect(await screen.findByText('No saved cards yet')).toBeInTheDocument();
    expect(screen.getByText(/bookmark icon on a company card/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open a deck' })).toHaveAttribute('href', '/history');
  });
});
