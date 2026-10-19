import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { useSettingsModal } from '@/lib/settings/settingsModal';
import BetaPage from './BetaPage';

describe('About this beta', () => {
  it('states the promises plainly: we cover AI, research stays local, export and migrate, BYOK after', () => {
    renderWithProviders(<BetaPage />);
    expect(screen.getByText(/honest feedback, not your data/i)).toBeInTheDocument();
    expect(screen.getByText(/we pay for the AI research and the backend/i)).toBeInTheDocument();
    expect(screen.getByText(/saved only in this browser/i)).toBeInTheDocument();
    expect(screen.getByText(/don.t store or log what\s+they contain/i)).toBeInTheDocument();
    expect(screen.getByText(/import that same file/i)).toBeInTheDocument();
    expect(screen.getByText(/bring-your-own-key/i)).toBeInTheDocument();
    // The one thing the beta does keep, said plainly: a share link the person creates.
    expect(screen.getByText(/A share link is the one exception/)).toBeInTheDocument();
    expect(screen.getByText(/keep a\s+read-only copy of that card or deck, with its research, for 90 days/)).toBeInTheDocument();
    expect(screen.getByText(/optional paid hosted version/i)).toBeInTheDocument();
  });
  it('opens Settings straight to Data controls for export', () => {
    renderWithProviders(<BetaPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Export my research' }));
    expect(useSettingsModal.getState()).toMatchObject({ isOpen: true, tab: 'data' });
  });
});
