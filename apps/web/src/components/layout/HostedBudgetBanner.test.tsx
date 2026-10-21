import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { useHostedBudget, noteHostedAnswer } from '@/lib/hostedApi';
import { useApiKey } from '@/lib/settings/apiKey';
import { useSettingsModal } from '@/lib/settings/settingsModal';
import { COVERED_USAGE_USD } from '@/lib/beta';
import BetaPage from '@/features/beta/BetaPage';
import { HostedBudgetBanner } from './AppShell';

const reset = () => {
  useHostedBudget.setState({ exhausted: null, allowance: null });
  useApiKey.setState({ hosted: true });
  useSettingsModal.setState({ isOpen: false, tab: null });
};
beforeEach(reset);
afterEach(reset);

describe('the hosted research refusals, as the person sees them', () => {
  it('says plainly what was used, that the covered research is used up, and opens Settings on the key to continue', () => {
    noteHostedAnswer(402, { reason: 'allowance', usedUsd: 14.97, allowanceUsd: 15 }, new Headers());
    renderWithProviders(<HostedBudgetBanner />);
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent('You’ve used $14.97 of the $15.00 of research we cover for the beta');
    expect(note).toHaveTextContent('covered research is used up');
    expect(note).toHaveTextContent('everything already researched still works');
    expect(note).not.toHaveTextContent(/pric|upgrade|subscri|plan/i);
    fireEvent.click(screen.getByRole('button', { name: 'add your own Gemini key' }));
    expect(useSettingsModal.getState()).toMatchObject({ isOpen: true, tab: 'engine' });
  });

  it('falls back to the covered amount when the refusal carried no numbers', () => {
    noteHostedAnswer(402, { reason: 'allowance' }, new Headers());
    renderWithProviders(<HostedBudgetBanner />);
    expect(screen.getByRole('status')).toHaveTextContent(`$${COVERED_USAGE_USD.toFixed(2)} of the $${COVERED_USAGE_USD.toFixed(2)}`);
  });

  it('leaves the daily-limit messages as they were', () => {
    noteHostedAnswer(402, { reason: 'visitor' }, new Headers());
    const { unmount } = renderWithProviders(<HostedBudgetBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('You’ve used today’s free research.');
    expect(screen.getByRole('status')).toHaveTextContent('New research resumes at midnight UTC');
    unmount();
    noteHostedAnswer(402, { reason: 'global' }, new Headers());
    renderWithProviders(<HostedBudgetBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('Free research has reached today’s budget.');
  });

  it('shows nothing for a person on their own key, or before any refusal', () => {
    const { container, unmount } = renderWithProviders(<HostedBudgetBanner />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    useApiKey.setState({ hosted: false });
    noteHostedAnswer(402, { reason: 'allowance', usedUsd: 15, allowanceUsd: 15 }, new Headers());
    const own = renderWithProviders(<HostedBudgetBanner />);
    expect(own.container).toBeEmptyDOMElement();
  });
});

describe('what the Worker says about the allowance', () => {
  it('keeps the used amount from a successful hosted answer’s headers, and ignores headers that are not numbers', () => {
    noteHostedAnswer(200, null, new Headers({ 'x-allowance-used-usd': '3.5', 'x-allowance-usd': '15' }));
    expect(useHostedBudget.getState().allowance).toEqual({ usedUsd: 3.5, allowanceUsd: 15 });
    noteHostedAnswer(200, null, new Headers({ 'x-allowance-used-usd': 'lots', 'x-allowance-usd': '15' }));
    noteHostedAnswer(200, null, new Headers());
    expect(useHostedBudget.getState().allowance).toEqual({ usedUsd: 3.5, allowanceUsd: 15 });
    expect(useHostedBudget.getState().exhausted).toBeNull();
  });

  it('is shown low-key on the beta page once known, and not before', () => {
    const first = renderWithProviders(<BetaPage />);
    expect(screen.getByText(new RegExp(`We cover about \\$${COVERED_USAGE_USD} of research`))).toBeInTheDocument();
    expect(screen.queryByText(/so far/)).toBeNull();
    first.unmount();
    noteHostedAnswer(200, null, new Headers({ 'x-allowance-used-usd': '3.5', 'x-allowance-usd': '15' }));
    renderWithProviders(<BetaPage />);
    expect(screen.getByText(/You’ve used about \$3\.50 of \$15\.00 so far\./)).toBeInTheDocument();
  });
});
