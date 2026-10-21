import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import type { CardWithCompany, MarketIntelRepository } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { useAgentTrace } from './agentTrace';
import { useHuntRunner } from './useHuntRunner';

function Runner() {
  useHuntRunner();
  return null;
}

beforeEach(() => useAgentTrace.setState({ jobs: [], events: [] }));

describe('a named company queued from a link', () => {
  function repo(): { repo: MarketIntelRepository; expandDeck: ReturnType<typeof vi.fn>; followCompanies: ReturnType<typeof vi.fn> } {
    const base = makeRepo();
    const expandDeck = vi.fn(async () => ({ added: 1 }));
    const followCompanies = vi.fn(async () => undefined);
    const card = { card: { id: 'c1' }, company: { id: 'co1', name: 'Sun Run' } } as unknown as CardWithCompany;
    Object.assign(base, {
      expandDeck, followCompanies,
      getDeckByMarket: vi.fn(async () => ({ id: 'd1' })),
      listCards: vi.fn(async () => [card]),
    });
    return { repo: base, expandDeck, followCompanies };
  }

  it('runs the one-company hunt and puts the company on Today only when asked', async () => {
    const { repo: r, expandDeck, followCompanies } = repo();
    renderWithProviders(<Runner />, { repository: r });
    const focus = { company: { name: 'Sunrun', domain: 'https://sunrun.com', descriptor: null } };
    act(() => useAgentTrace.getState().enqueueHunt({ marketId: 'm1', focus, label: 'Add Sunrun', followAfter: true }));
    await waitFor(() => expect(expandDeck).toHaveBeenCalledWith('m1', focus));
    await waitFor(() => expect(followCompanies).toHaveBeenCalledWith(['co1']));
  });

  it('does not touch Today without the ask', async () => {
    const { repo: r, expandDeck, followCompanies } = repo();
    renderWithProviders(<Runner />, { repository: r });
    act(() => useAgentTrace.getState().enqueueHunt({ marketId: 'm1', focus: { company: { name: 'Sunrun' } }, label: 'Add Sunrun' }));
    await waitFor(() => expect(useAgentTrace.getState().jobs[0]?.status).toBe('done'));
    expect(expandDeck).toHaveBeenCalledTimes(1);
    expect(followCompanies).not.toHaveBeenCalled();
  });

  it('treats the same company queued twice as one click', () => {
    const { enqueueHunt } = useAgentTrace.getState();
    enqueueHunt({ marketId: 'm1', focus: { company: { name: 'Sunrun' } }, label: 'a' });
    enqueueHunt({ marketId: 'm1', focus: { company: { name: 'SUNRUN' } }, label: 'b' });
    enqueueHunt({ marketId: 'm1', focus: { company: { name: 'Enphase' } }, label: 'c' });
    expect(useAgentTrace.getState().jobs.map((j) => j.label)).toEqual(['a', 'c']);
  });
});
