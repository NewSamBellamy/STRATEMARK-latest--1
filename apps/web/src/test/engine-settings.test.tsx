import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { GoogleAuthProvider } from '@/lib/auth/AuthContext';
import { TaskManagerProvider } from '@/lib/tasks/TaskManagerContext';
import { SettingsModal } from '@/features/settings/SettingsModal';
import NewDeckPage from '@/features/deck/NewDeckPage';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { createQueryClient } from '@/lib/query/queryClient';
import { MockRepository } from '@mi/mocks';
import { useEngineChoice } from '@/lib/settings/engine';
import * as sentinelApi from '@/lib/sentinelApi';

import { useSettingsModal } from '@/lib/settings/settingsModal';
import { useResearchSession } from '@/features/deck/research-session';

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <GoogleAuthProvider>
        <TaskManagerProvider>
          <RepositoryProvider repository={new MockRepository()}>
            <MemoryRouter initialEntries={['/']}>{children}</MemoryRouter>
          </RepositoryProvider>
        </TaskManagerProvider>
      </GoogleAuthProvider>
    </QueryClientProvider>
  );
}

describe('Research Engine Settings & Strict Execution', () => {
  beforeEach(() => {
    localStorage.clear();
    useEngineChoice.setState({ engine: 'local' });
    useResearchSession.getState().clear();
    vi.restoreAllMocks();
  });

  it('allows toggling research execution engine in SettingsModal', async () => {
    useSettingsModal.setState({ isOpen: true });
    const user = userEvent.setup();
    render(
      <TestWrapper>
        <SettingsModal />
      </TestWrapper>,
    );

    await user.click(screen.getByRole('button', { name: /^engine$/i }));
    expect(screen.getByText('Research Execution Engine')).toBeInTheDocument();
    const cloudBtn = screen.getByRole('button', { name: /sentinel cloud agent/i });
    const localBtn = screen.getByRole('button', { name: /local engine/i });

    expect(cloudBtn).toBeInTheDocument();
    expect(localBtn).toBeInTheDocument();

    await user.click(cloudBtn);
    expect(useEngineChoice.getState().engine).toBe('cloud');

    await user.click(localBtn);
    expect(useEngineChoice.getState().engine).toBe('local');
  });

  it('stops and renders error when Cloud Agent fails without falling back silently to local research', async () => {
    useEngineChoice.setState({ engine: 'cloud' });

    vi.spyOn(sentinelApi, 'runCloudResearchDeck').mockRejectedValueOnce(
      new Error('Sentinel Cloud Run service temporary 503 error'),
    );

    const user = userEvent.setup();
    render(
      <TestWrapper>
        <Routes>
          <Route path="/" element={<NewDeckPage />} />
        </Routes>
      </TestWrapper>,
    );

    const input = screen.getByPlaceholderText(/describe a market/i);
    await user.type(input, 'Autonomous drone delivery');

    const submitBtn = screen.getByRole('button', { name: /research this market/i });
    await user.click(submitBtn);

    expect(
      await screen.findByText(
        /Sentinel Cloud Agent error: Sentinel Cloud Run service temporary 503 error/i,
      ),
    ).toBeInTheDocument();
  });

  it('keeps the captured research steps available after a run fails', async () => {
    const failedSession = {
      query: 'Microsoft Corporation',
      time: '1:14 AM',
      running: true,
      logLines: [
        'Discovered 1 entities: Microsoft Corporation',
        'Could not enrich Microsoft Corporation; preserving the rest of the deck. Original-source retrieval timed out.',
      ],
      done: null,
      error: null,
      stage: null,
      progress: null,
      found: ['Microsoft Corporation'],
    };
    useResearchSession.setState({ session: failedSession });

    const user = userEvent.setup();
    render(
      <TestWrapper>
        <Routes>
          <Route path="/" element={<NewDeckPage />} />
        </Routes>
      </TestWrapper>,
    );

    act(() => {
      useResearchSession.setState({
        session: {
          ...failedSession,
          running: false,
          error: 'No company, infrastructure, or distribution card completed its first research pass; the deck was not opened.',
        },
      });
    });

    expect(
      screen.getByText(/No company, infrastructure, or distribution card completed/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Original-source retrieval timed out/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show research steps/i }));

    expect(screen.getByRole('log', { name: /research steps before failure/i })).toHaveTextContent(
      /Original-source retrieval timed out/,
    );
  });

  it('uses the asynchronous cloud deckId and opens the running deck', async () => {
    useEngineChoice.setState({ engine: 'cloud' });
    vi.spyOn(sentinelApi, 'runCloudResearchDeck').mockResolvedValueOnce({
      ok: true,
      deckId: 'deck_cloud_123',
    });

    const user = userEvent.setup();
    render(
      <TestWrapper>
        <Routes>
          <Route path="/" element={<NewDeckPage />} />
          <Route path="/markets/:marketId/deck" element={<div>running cloud deck</div>} />
        </Routes>
      </TestWrapper>,
    );

    await user.type(screen.getByPlaceholderText(/describe a market/i), 'Autonomous drone delivery');
    await user.click(screen.getByRole('button', { name: /research this market/i }));

    expect(await screen.findByText('running cloud deck')).toBeInTheDocument();
  });

  it('keeps the welcome header timeless and refreshes the market suggestions', async () => {
    const user = userEvent.setup();
    render(
      <TestWrapper>
        <Routes>
          <Route path="/" element={<NewDeckPage />} />
        </Routes>
      </TestWrapper>,
    );

    expect(screen.queryByText(/^\d{1,2}:\d{2}\s?(AM|PM)?$/i)).not.toBeInTheDocument();

    const before = screen
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter(Boolean);
    await user.click(screen.getByRole('button', { name: /show different suggestions/i }));
    const after = screen
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter(Boolean);

    expect(after).not.toEqual(before);
  });
});
