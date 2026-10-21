import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import BetaPage from './BetaPage';

describe('About this beta: what is kept', () => {
  it('says plainly that a share link the person creates is the one thing kept, and for how long', () => {
    renderWithProviders(<BetaPage />);
    expect(screen.getByText(/A share link is the one exception/)).toBeInTheDocument();
    expect(screen.getByText(/keep a\s+read-only copy of that card or deck, with its research, for 90 days/)).toBeInTheDocument();
    expect(screen.getByText(/stop sharing at any time from the Share dialog/)).toBeInTheDocument();
  });
});
