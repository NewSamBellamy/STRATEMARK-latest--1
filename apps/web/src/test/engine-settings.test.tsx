import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    vi.unstubAllEnvs();
    localStorage.clear();
    useEngineChoice.setState({ engine: 'local' });
    vi.restoreAllMocks();
  });

  it('presents one clear local workflow in the community desktop build', async () => {
    vi.stubEnv('VITE_DESKTOP', '1');
    useSettingsModal.setState({ isOpen: true });

    render(
      <TestWrapper>
        <SettingsModal />
      </TestWrapper>,
    );

    expect(screen.queryByRole('button', { name: /^engine$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /usage & limits/i })).toBeInTheDocument();
    expect(
      screen.getByText(/No Stratemark account or hosted service is required/i),
    ).toBeInTheDocument();
  });

  it('does not present incomplete desktop usage data as a meter or hard cap', async () => {
    vi.stubEnv('VITE_DESKTOP', '1');
    useSettingsModal.setState({ isOpen: true });
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <SettingsModal />
      </TestWrapper>,
    );

    await user.click(screen.getByRole('button', { name: /usage & limits/i }));
    expect(screen.getByText(/desktop usage is not metered here yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/a hard spending cap is not available in desktop yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('none')).not.toBeInTheDocument();
    expect(screen.queryByText('This month on your key')).not.toBeInTheDocument();
  });

  it('starts with precise research language instead of AI theater', () => {
    vi.stubEnv('VITE_DESKTOP', '1');
    render(
      <TestWrapper>
        <Routes>
          <Route path="/" element={<NewDeckPage />} />
        </Routes>
      </TestWrapper>,
    );

    expect(screen.getByText('Market research')).toBeInTheDocument();
    expect(screen.getByText(/records sourced figures/i)).toBeInTheDocument();
    expect(screen.queryByText(/verifies the figures/i)).not.toBeInTheDocument();
    expect(document.querySelector('button button')).toBeNull();
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
});
