import { afterEach, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { useDashboardTab } from './data';

afterEach(() => vi.useRealTimers());

function Probe() {
  const query = useDashboardTab('company', 'overview');
  return <output>{query.isError ? 'Research failed — retry manually' : 'Researching'}</output>;
}

it('does not silently repeat a paid dashboard research request after failure', async () => {
  vi.useFakeTimers();
  const getDashboardTab = vi.fn().mockRejectedValue(new Error('Provider unavailable'));
  renderWithProviders(<Probe />, { repository: Object.assign(makeRepo(), { getDashboardTab }) });
  await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
  expect(getDashboardTab).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Research failed — retry manually')).toBeInTheDocument();
});
