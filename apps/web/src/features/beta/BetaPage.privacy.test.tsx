import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import BetaPage from './BetaPage';

describe('About this beta: what is kept', () => {
  it('lists the spend total, the short-lived fair-use counters and shared copies, not just a spend total', () => {
    renderWithProviders(<BetaPage />);
    expect(screen.queryByText(/the only thing we keep/)).not.toBeInTheDocument();
    expect(screen.getByText(/What we keep is a running total of AI spend/)).toBeInTheDocument();
    expect(screen.getByText(/short-lived per-visitor counters used only for fair-use limits/)).toBeInTheDocument();
    expect(screen.getByText(/read-only copy of anything you choose to share/)).toBeInTheDocument();
  });
  it('says plainly that a share link the person creates is the one thing kept, and for how long', () => {
    renderWithProviders(<BetaPage />);
    expect(screen.getByText(/A share link is the one exception/)).toBeInTheDocument();
    expect(screen.getByText(/keep a\s+read-only copy of that card or deck, with its research, for 90 days/)).toBeInTheDocument();
    expect(screen.getByText(/stop sharing at any time from the Share dialog/)).toBeInTheDocument();
  });
});
