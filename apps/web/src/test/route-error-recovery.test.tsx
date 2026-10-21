import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRoutes } from '@/routes';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { AuthProvider } from '@/lib/auth/AuthContext';
import { DeepDiveProvider } from '@/features/deepdive/DeepDive';
import { createQueryClient } from '@/lib/query/queryClient';
import { makeRepo } from './test-utils';

vi.mock('@/features/beta/BetaPage', () => ({
  default: () => {
    throw new Error('beta page exploded');
  },
}));

let nav: NavigateFunction | null = null;
function NavHandle() {
  nav = useNavigate();
  return null;
}

describe('route error boundary', () => {
  it('a crashed page does not stay crashed after navigating to another page', { timeout: 30000 }, async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <RepositoryProvider repository={makeRepo()}>
        <QueryClientProvider client={createQueryClient()}>
          <AuthProvider>
            <DeepDiveProvider>
              <MemoryRouter initialEntries={['/beta']}>
                <NavHandle />
                <AppRoutes />
              </MemoryRouter>
            </DeepDiveProvider>
          </AuthProvider>
        </QueryClientProvider>
      </RepositoryProvider>,
    );
    expect(await screen.findByText('beta page exploded', undefined, { timeout: 10000 })).toBeInTheDocument();

    act(() => nav!('/history'));
    await screen.findByRole('heading', { level: 1 }, { timeout: 10000 });
    expect(screen.queryByText('beta page exploded')).not.toBeInTheDocument();
    vi.mocked(console.error).mockRestore();
  });
});
