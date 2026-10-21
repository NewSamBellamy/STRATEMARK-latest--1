import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MockRepository } from '@mi/mocks';
import { GoogleAuthProvider } from '@/lib/auth/AuthContext';
import { TaskManagerProvider } from '@/lib/tasks/TaskManagerContext';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { createQueryClient } from '@/lib/query/queryClient';
import { useEngineChoice } from '@/lib/settings/engine';
import { useResearchSession } from '@/features/deck/research-session';
import * as sentinelApi from '@/lib/sentinelApi';
import NewDeckPage from './NewDeckPage';

describe('"Start a new deck" from a confirmed link', () => {
  beforeEach(() => {
    localStorage.clear();
    useResearchSession.getState().clear();
    vi.restoreAllMocks();
  });

  it('never runs the cloud engine: it researches one company, and the cloud deck would research ten', async () => {
    useEngineChoice.setState({ engine: 'cloud' });
    const cloud = vi.spyOn(sentinelApi, 'runCloudResearchDeck');
    const repo = new MockRepository();
    Object.assign(repo, {
      identifyCompanyFromLink: async () => ({
        status: 'identified', kind: 'website', name: 'Sunrun', websiteUrl: 'https://sunrun.com', descriptor: null,
        sources: [{ url: 'https://sunrun.com/', title: null, how: 'link_address' }],
      }),
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={createQueryClient()}>
        <GoogleAuthProvider>
          <TaskManagerProvider>
            <RepositoryProvider repository={repo}>
              <MemoryRouter initialEntries={['/']}>
                <Routes><Route path="/" element={<NewDeckPage />} /></Routes>
              </MemoryRouter>
            </RepositoryProvider>
          </TaskManagerProvider>
        </GoogleAuthProvider>
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Add one from a link' }));
    await user.type(screen.getByLabelText(/Link to a post/), 'https://sunrun.com');
    await user.click(screen.getByRole('button', { name: 'Find the company' }));
    await user.click(await screen.findByRole('button', { name: 'Start a new deck' }));
    expect(cloud).not.toHaveBeenCalled();
  });
});
