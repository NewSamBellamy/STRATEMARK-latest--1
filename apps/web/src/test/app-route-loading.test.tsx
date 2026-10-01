import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { App } from '@/App';

const route = vi.hoisted(() => ({ ready: false, pending: Promise.resolve() as Promise<void> }));
vi.mock('@/features/deepdive/DeepDive', () => ({
  DeepDiveProviderWithPanel: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/routes', () => ({
  AppRoutes: () => {
    if (!route.ready) throw route.pending;
    return <h1>Outside-shell destination</h1>;
  },
}));
it('shows a route loading state outside the shell instead of letting lazy destinations crash', async () => {
  let release!: () => void;
  route.pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  route.ready = false;
  render(<App />);
  expect(screen.getByRole('status')).toBeVisible();
  await act(async () => {
    route.ready = true;
    release();
    await route.pending;
  });
  expect(screen.getByRole('heading', { name: 'Outside-shell destination' })).toBeVisible();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
