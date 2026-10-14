import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRoutes } from '@/routes';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { AuthProvider } from '@/lib/auth/AuthContext';
import { DeepDiveProvider } from '@/features/deepdive/DeepDive';
import { createQueryClient } from '@/lib/query/queryClient';
import { makeRepo } from './test-utils';

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

describe('dashboard tab routing', () => {
  it('an unknown tab slug redirects to the same company overview, keeping deck context', { timeout: 45000 }, async () => {
    render(
      <RepositoryProvider repository={makeRepo()}>
        <QueryClientProvider client={createQueryClient()}>
          <AuthProvider>
            <DeepDiveProvider>
              <MemoryRouter initialEntries={['/company/cmp_gracewear-global/dashboard/not-a-tab?deck=m1']}>
                <Where />
                <AppRoutes />
              </MemoryRouter>
            </DeepDiveProvider>
          </AuthProvider>
        </QueryClientProvider>
      </RepositoryProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('where'))
      .toHaveTextContent('/company/cmp_gracewear-global/dashboard/overview?deck=m1'), { timeout: 20000 });
    expect(await screen.findByRole('navigation', { name: 'Company dashboard tabs' }, { timeout: 20000 })).toBeInTheDocument();
    expect(screen.queryByText(/page not found|404/i)).not.toBeInTheDocument();
  });
});
