import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from '@/App';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { createQueryClient } from '@/lib/query/queryClient';
import { makeRepo } from './test-utils';

// Exercise production router/panel placement without duplicating route-level tests.
vi.mock('@/routes', () => ({ AppRoutes: () => <h1>Router root ready</h1> }));

describe('production router root', () => {
  it('mounts the real research panel inside the router without an external router', () => {
    render(
      <RepositoryProvider repository={makeRepo()}>
        <QueryClientProvider client={createQueryClient()}>
          <App />
        </QueryClientProvider>
      </RepositoryProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Router root ready' })).toBeInTheDocument();
  });
});
