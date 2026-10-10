import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import type { LivingDeckState } from '@/lib/living/useLivingDeck';
import { AgentActivityFeed } from './AgentActivityFeed';

function state(overrides: Partial<LivingDeckState> = {}): LivingDeckState {
  return {
    events: [],
    status: 'running',
    deskCount: 20,
    actionCount: 3,
    canVerify: true,
    pause: vi.fn(),
    resume: vi.fn(),
    fillCardFaces: vi.fn(async () => ({ targeted: 0, filledCompanies: 0, filledTypes: 0, failed: 0 })),
    ...overrides,
  };
}

describe('AgentActivityFeed', () => {
  it('shows the live pill with the desk count and session actions', () => {
    renderWithProviders(<AgentActivityFeed living={state()} />);
    expect(screen.getByText('Live research')).toBeInTheDocument();
    expect(screen.getByText(/tracking 20 companies/)).toBeInTheDocument();
    expect(screen.getByText(/3 actions this session/)).toBeInTheDocument();
  });

  it('renders nothing for a deck with no company desks', () => {
    const { container } = renderWithProviders(
      <AgentActivityFeed living={state({ deskCount: 0 })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('expands to show research events with source counts', async () => {
    const { user } = renderWithProviders(
      <AgentActivityFeed
        living={state({
          events: [
            {
              id: 1,
              at: Date.now() - 12_000,
              kind: 'corrected',
              companyName: 'OpenAI',
              message: 'OpenAI desk corrected ARR: now $40.0B (3 sources)',
              citations: 3,
            },
          ],
        })}
      />,
    );
    await user.click(screen.getByTitle('Show activity'));
    expect(screen.getByText(/OpenAI desk corrected ARR/)).toBeInTheDocument();
    expect(screen.getAllByText(/3 sources/).length).toBeGreaterThan(0);
  });

  it('pause control calls through', async () => {
    const living = state();
    const { user } = renderWithProviders(<AgentActivityFeed living={living} />);
    await user.click(screen.getByTitle('Pause live research'));
    expect(living.pause).toHaveBeenCalledOnce();
  });
});
