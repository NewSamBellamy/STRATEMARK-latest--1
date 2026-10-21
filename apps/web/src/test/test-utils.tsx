import type { ReactElement, ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import type { MarketIntelRepository } from '@mi/contracts';
import { MockRepository } from '@mi/mocks';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { AuthProvider } from '@/lib/auth/AuthContext';
import { TaskManagerProvider } from '@/lib/tasks/TaskManagerContext';
import { DeepDiveProvider } from '@/features/deepdive/DeepDive';
import { createQueryClient } from '@/lib/query/queryClient';

export function makeRepo(): MarketIntelRepository {
  return new MockRepository({ latencyMs: 0 });
}

function Providers({
  children,
  repository,
}: {
  children: ReactNode;
  repository: MarketIntelRepository;
}) {
  return (
    <RepositoryProvider repository={repository}>
      <QueryClientProvider client={createQueryClient()}>
        <AuthProvider>
          <TaskManagerProvider>
            <DeepDiveProvider>{children}</DeepDiveProvider>
          </TaskManagerProvider>
        </AuthProvider>
      </QueryClientProvider>
    </RepositoryProvider>
  );
}

type RenderWithProvidersResult = RenderResult & {
  user: ReturnType<typeof userEvent.setup>;
  repository: MarketIntelRepository;
};

/** Render a component tree with all providers + a MemoryRouter. */
export function renderWithProviders(
  ui: ReactElement,
  options: { route?: string; repository?: MarketIntelRepository } = {},
): RenderWithProvidersResult {
  const repository = options.repository ?? makeRepo();
  return {
    user: userEvent.setup(),
    repository,
    ...render(
      <Providers repository={repository}>
        <MemoryRouter initialEntries={[options.route ?? '/']}>{ui}</MemoryRouter>
      </Providers>,
    ),
  };
}
