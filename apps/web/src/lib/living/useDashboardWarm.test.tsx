import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { MockRepository } from '@mi/mocks';
import { createQueryClient } from '@/lib/query/queryClient';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { useResearchControl } from './researchControl';
import { useDashboardWarm } from './useDashboardWarm';

afterEach(() => { act(() => useResearchControl.setState({ paused: false, storageError: null })); });
function setup() {
  const repository = new MockRepository({ latencyMs: 0 });
  const getDashboardTab = vi.fn().mockResolvedValue(null);
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={Object.assign(repository, { getDashboardTab })}><QueryClientProvider client={client}>{children}</QueryClientProvider></RepositoryProvider>;
  return { getDashboardTab, wrapper };
}
describe('dashboard background warming follows shared pause', () => {
  it('starts no automatic work when paused, including after remount', async () => {
    useResearchControl.getState().setPaused(true);
    const { wrapper, getDashboardTab } = setup();
    const first = renderHook(() => useDashboardWarm('company', 'overview', 'Example'), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(getDashboardTab).not.toHaveBeenCalled();
    first.unmount();
    renderHook(() => useDashboardWarm('company', 'metrics', 'Example'), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(getDashboardTab).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject'] as const)('does not advance the warm queue after pausing in flight (%s)', async outcome => {
    const { wrapper, getDashboardTab } = setup();
    const finishers: Array<() => void> = [];
    getDashboardTab.mockImplementation(() => new Promise((resolve, reject) => {
      finishers.push(() => outcome === 'resolve' ? resolve(null) : reject(new Error('source failed')));
    }));
    renderHook(() => useDashboardWarm('company', 'overview', 'Example'), { wrapper });
    // Three desks run at once; the tab on screen is first.
    await waitFor(() => expect(getDashboardTab).toHaveBeenCalledTimes(3));
    expect(getDashboardTab.mock.calls[0]![1]).toBe('overview');
    await act(async () => { useResearchControl.getState().setPaused(true); finishers.forEach((f) => f()); });
    expect(getDashboardTab).toHaveBeenCalledTimes(3);
    act(() => useResearchControl.getState().setPaused(false));
    await waitFor(() => expect(getDashboardTab.mock.calls.length).toBeGreaterThan(3));
  });
});
