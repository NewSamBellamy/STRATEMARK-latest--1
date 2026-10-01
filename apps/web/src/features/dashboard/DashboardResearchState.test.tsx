import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { MarketIntelRepository } from '@mi/contracts';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { createQueryClient } from '@/lib/query/queryClient';
import { useDashboardTab, useRerunDashboardTab } from '@/hooks/data';
import { DashboardResearchState } from './DashboardResearchState';

describe('DashboardResearchState', () => {
  it('keeps cached loading distinct from a missing section', () => {
    render(
      <DashboardResearchState
        loading
        hasKey
        researching={false}
        onResearch={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText('Loading saved research…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Research this section' })).not.toBeInTheDocument();
  });

  it('shows the provider requirement and does not launch research without a key', () => {
    const onResearch = vi.fn();
    render(
      <DashboardResearchState
        loading={false}
        hasKey={false}
        researching={false}
        onResearch={onResearch}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText(/Connect a provider in/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText(/may incur API charges/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Research this section' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Research this section' }));
    expect(onResearch).not.toHaveBeenCalled();
  });

  it('starts research once from the visible button', () => {
    const onResearch = vi.fn();
    render(
      <DashboardResearchState
        loading={false}
        hasKey
        researching={false}
        onResearch={onResearch}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Research this section' }));
    expect(onResearch).toHaveBeenCalledTimes(1);
  });

  it('starts one explicit research action and disables the action while pending', () => {
    const onResearch = vi.fn();
    render(
      <DashboardResearchState
        loading={false}
        hasKey
        researching
        onResearch={onResearch}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Researching…/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Research is running');
    fireEvent.click(screen.getByRole('button', { name: /Researching…/ }));
    expect(onResearch).not.toHaveBeenCalled();
  });

  it('keeps cached-read failures free and does not expose raw error text', () => {
    const onRetry = vi.fn();
    render(
      <DashboardResearchState
        loading={false}
        hasKey
        researching={false}
        readError={new Error('secret provider payload')}
        onResearch={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Saved research could not be loaded');
    expect(screen.getByRole('alert')).toHaveTextContent('free cached read');
    expect(screen.queryByText(/secret provider payload/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved research' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('labels a research retry as paid, gates it on a provider key, and hides raw errors', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <DashboardResearchState
        loading={false}
        hasKey
        researching={false}
        researchError={new Error('secret provider payload')}
        onResearch={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Research did not finish');
    expect(screen.getByRole('alert')).toHaveTextContent('may incur API charges');
    expect(screen.queryByText(/secret provider payload/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry research' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(
      <DashboardResearchState
        loading={false}
        hasKey={false}
        researching={false}
        researchError={new Error('secret provider payload')}
        onResearch={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('button', { name: 'Retry research' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('reads a missing section for free, then only the explicit rerun uses paid research', async () => {
    const result = {
      companyId: 'cmp_test',
      tab: 'team_org' as const,
      content: { nodes: [], edges: [] },
      lastRefreshedAt: null,
    };
    const repository = {
      getDashboardTab: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(result),
    } as unknown as MarketIntelRepository;
    const client = createQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <RepositoryProvider repository={repository}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </RepositoryProvider>
    );
    const { result: read } = renderHook(() => useDashboardTab('cmp_test', 'team_org'), { wrapper });
    await waitFor(() => expect(read.current.data).toBeNull());
    expect(repository.getDashboardTab).toHaveBeenCalledWith('cmp_test', 'team_org');

    const { result: action } = renderHook(() => useRerunDashboardTab('cmp_test', 'team_org'), {
      wrapper,
    });
    await action.current.mutateAsync();
    expect(repository.getDashboardTab).toHaveBeenLastCalledWith('cmp_test', 'team_org', true);
  });

  it('preserves cached research when an explicit refresh fails', async () => {
    const oldResult = {
      companyId: 'cmp_test',
      tab: 'team_org' as const,
      content: { nodes: [{ id: 'leader-1', name: 'Saved leader' }], edges: [] },
      lastRefreshedAt: '2026-09-29T00:00:00.000Z',
    };
    const repository = {
      getDashboardTab: vi.fn().mockRejectedValue(new Error('secret provider payload')),
    } as unknown as MarketIntelRepository;
    const client = createQueryClient();
    client.setQueryData(['dashboard', 'cmp_test', 'team_org'], oldResult);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <RepositoryProvider repository={repository}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </RepositoryProvider>
    );
    const { result: action } = renderHook(() => useRerunDashboardTab('cmp_test', 'team_org'), {
      wrapper,
    });

    await expect(action.current.mutateAsync()).rejects.toThrow('secret provider payload');
    expect(client.getQueryData(['dashboard', 'cmp_test', 'team_org'])).toEqual(oldResult);
  });
});
