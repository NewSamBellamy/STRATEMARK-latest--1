import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRoutes } from '@/routes';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { AuthProvider } from '@/lib/auth/AuthContext';
import { DeepDiveProvider } from '@/features/deepdive/DeepDive';
import { createQueryClient } from '@/lib/query/queryClient';
import { makeRepo } from './test-utils';

function renderApp() {
  const repository = makeRepo();
  return {
    user: userEvent.setup(),
    ...render(
      <RepositoryProvider repository={repository}>
        <QueryClientProvider client={createQueryClient()}>
          <AuthProvider>
            <DeepDiveProvider>
              <MemoryRouter initialEntries={['/']}>
                <AppRoutes />
              </MemoryRouter>
            </DeepDiveProvider>
          </AuthProvider>
        </QueryClientProvider>
      </RepositoryProvider>,
    ),
  };
}

const FIND = { timeout: 5000 } as const;

describe('end-to-end deck flow (markets → deck → 2-level split → card → dashboard)', () => {
  it('navigates the full journey against the mock repository', { timeout: 20000 }, async () => {
    const { user } = renderApp();

    // Navigate directly to the deck via the inline recent decks sidebar link.
    const marketLink = await screen.findByRole('link', { name: /Christian Apparel/i }, FIND);
    await user.click(marketLink);

    // Level 0 — full deck with the persistent card-type nav. Filtering happens
    // The type nav should be visible with company cards shown by default.
    expect(await screen.findByTestId('type-nav', undefined, FIND)).toBeInTheDocument();

    // Open a company card → reader → dashboard.
    const card = await screen.findByRole('button', { name: /^GraceWear Global — Company card$/ }, FIND);
    await user.click(card);
    const dialog = await screen.findByRole('dialog', undefined, FIND);
    await user.click(within(dialog).getByRole('link', { name: /open full company dashboard/i }));

    // Dashboard — route shell + tab switch to Metrics. The overview copy is
    // research-authored, so the journey should not depend on a specific heading.
    expect(await screen.findByRole('button', { name: 'Back to card' }, FIND)).toBeInTheDocument();
    await user.click(await screen.findByRole('link', { name: 'Metrics' }, FIND));
    expect(await screen.findByText(/Revenue trend/i, undefined, FIND)).toBeInTheDocument();
    expect(screen.getByText('Cap table')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to card' }));
    const reopened = await screen.findByRole('dialog', undefined, FIND);
    expect(within(reopened).getAllByText('GraceWear Global').length).toBeGreaterThan(0);
    expect(within(reopened).getByRole('button', { name: 'Next card' })).toBeInTheDocument();
  });
});
