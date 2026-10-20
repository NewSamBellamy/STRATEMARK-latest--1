/**
 * A share link pasted into the address bar of a tab that already has the app open is a navigation inside the running
 * app. The share page is loaded on demand and sits outside the app shell (no sidebar, no sign-in), which is where the
 * app's Suspense boundary lives; without a boundary of its own the page suspended with nowhere to wait and the whole app
 * showed "The app failed to start". This file holds exactly one test, so the share page's code has not been loaded by an
 * earlier one and the jump really has to wait for it.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRoutes } from '@/routes';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { AuthProvider } from '@/lib/auth/AuthContext';
import { DeepDiveProvider } from '@/features/deepdive/DeepDive';
import { createQueryClient } from '@/lib/query/queryClient';
import { makeRepo } from '@/test/test-utils';
import { encodeSharePayload, type SharePayload } from '@/lib/share/codec';

function Jump({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(to)}>jump to the link</button>;
}

describe('a share link opened from inside the running app', { timeout: 60_000 }, () => {
  it('opens the shared page instead of failing the whole app', async () => {
    const blob = await encodeSharePayload({
      v: 1, kind: 'deck', market: 'Forgeries', sharedAt: '2026-10-01T09:00:00.000Z',
      cards: [{ type: 'company', title: null, summary: null, tier: 7, keyPoints: [], citations: [], claims: [], metrics: [],
        company: { name: 'Honest Industries', oneLiner: 'Does one thing.', website: 'https://honest.example', hq: null, logo: null } }],
    } as unknown as SharePayload);
    const user = userEvent.setup();
    render(
      <RepositoryProvider repository={makeRepo()}>
        <QueryClientProvider client={createQueryClient()}>
          <AuthProvider>
            <DeepDiveProvider>
              <MemoryRouter initialEntries={['/history']}>
                <Jump to={`/share/${blob}`} />
                <AppRoutes />
              </MemoryRouter>
            </DeepDiveProvider>
          </AuthProvider>
        </QueryClientProvider>
      </RepositoryProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'jump to the link' }));
    expect(await screen.findByText('Forgeries', {}, { timeout: 30_000 })).toBeInTheDocument();
    expect(screen.queryByText(/failed to start/i)).not.toBeInTheDocument();
  });
});
