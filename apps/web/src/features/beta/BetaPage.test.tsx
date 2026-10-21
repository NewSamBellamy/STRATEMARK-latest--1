import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { useSettingsModal } from '@/lib/settings/settingsModal';
import { OPEN_SOURCE_LAUNCH } from '@/lib/beta';
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
    expect(screen.getByText(/optional paid hosted version/i)).toBeInTheDocument();
  });
  it('says the open-source version launches on December 1', () => {
    renderWithProviders(<BetaPage />);
    expect(OPEN_SOURCE_LAUNCH).toBe('December 1, 2026');
    expect(screen.getAllByText(/December 1, 2026/).length).toBeGreaterThan(0);
  });
  it('opens Settings straight to Data controls for export', () => {
    renderWithProviders(<BetaPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Export my research' }));
    expect(useSettingsModal.getState()).toMatchObject({ isOpen: true, tab: 'data' });
  });
});
