import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import NotFoundPage from './NotFoundPage';

describe('the 404 page', () => {
  it('sends you back to All Decks, not "Markets"', () => {
    renderWithProviders(<NotFoundPage />);
    expect(screen.getByRole('link', { name: 'Back to All Decks' })).toHaveAttribute('href', '/history');
    expect(screen.queryByText(/Back to Markets/)).not.toBeInTheDocument();
  });
});
