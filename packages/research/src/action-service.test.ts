import { describe, expect, it, vi } from 'vitest';
import type { ActionRequest } from '@mi/contracts';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

function snapshot(): RepoSnapshot {
  const now = '2026-10-01T12:00:00.000Z';
  return {
    schemaVersion: 2,
    markets: [
      {
        id: 'mkt_frontier',
        name: 'Frontier AI',
        scopeDefinition: {
          vertical: 'artificial_intelligence',
          geography: null,
          inclusionCriteria: [],
          exclusionCriteria: [],
        },
        refreshCadence: 'manual',
        createdAt: now,
        updatedAt: now,
      },
    ],
    decks: [{ id: 'deck_frontier', marketId: 'mkt_frontier', createdAt: now, lastRefreshedAt: now }],
    companies: [],
    metrics: [],
    cards: [],
    viceClaims: [],
    dashboards: {},
    companyMarket: {},
    reports: [],
    briefings: [],
    savedCards: [],
    opportunity: {},
    researchJobs: [],
    threads: [],
    actionRuns: [],
  } as unknown as RepoSnapshot;
}

function memoryStore(initial = snapshot()): ResearchStore & { current(): RepoSnapshot } {
  let data: RepoSnapshot = structuredClone(initial);
  return {
    read: () => structuredClone(data),
    write: (next) => {
      data = structuredClone(next);
    },
    current: () => structuredClone(data),
  };
}

function command(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    contractVersion: '1',
    requestId: 'req_expand_1',
    idempotencyKey: 'expand-frontier-1',
    action: 'market.discovery.expand',
    vaultId: 'vault_local',
    target: { marketId: 'mkt_frontier' },
    expectedRevision: 0,
    policyRef: 'policy_local_explicit',
    budgetRef: 'budget_local_monthly',
    input: {
      scopeRevision: 0,
      focus: { cardType: 'infrastructure' },
      exclusions: [],
      maxCompanies: 3,
      maxSearchBatches: 1,
    },
    ...overrides,
  } as ActionRequest;
}

function repository(store: ResearchStore, authorized = true): GeminiRepository {
  const unavailable = vi.fn().mockRejectedValue(new Error('provider should be stubbed'));
  return new GeminiRepository({
    store,
    client: { ground: unavailable, structure: unavailable } as unknown as LlmClient,
    ...(authorized ? { authorizeAction: () => undefined } : {}),
  });
}

describe('durable action acceptance', () => {
  it('persists before dispatch and returns one receipt for simultaneous and restart replay', async () => {
    const store = memoryStore();
    const repo = repository(store);
    const expand = vi.spyOn(repo, 'expandDeck').mockImplementation(async () => {
      expect(store.current().actionRuns).toHaveLength(1);
      expect(store.current().actionRuns[0]?.status).toBe('running');
      return { added: 2 };
    });

    const [first, replay] = await Promise.all([
      repo.acceptAction(command()),
      repo.acceptAction(command({ requestId: 'req_expand_retry' })),
    ]);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      action: 'market.discovery.expand',
      effect: 'job',
      status: 'queued',
      target: { marketId: 'mkt_frontier' },
    });
    await vi.waitFor(() => expect(store.current().actionRuns[0]?.status).toBe('completed'));
    expect(store.current().actionRuns[0]?.result).toEqual({ added: 2 });
    expect(expand).toHaveBeenCalledTimes(1);
    expect(expand).toHaveBeenCalledWith('mkt_frontier', { cardType: 'infrastructure' }, undefined, {
      target: 3,
      excludeNames: [],
    });

    const reopened = repository(store);
    const reopenedExpand = vi.spyOn(reopened, 'expandDeck').mockResolvedValue({ added: 99 });
    expect(await reopened.acceptAction(command({ requestId: 'req_after_restart' }))).toEqual(first);
    expect(reopenedExpand).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key for a different command before dispatch', async () => {
    const store = memoryStore();
    const repo = repository(store);
    const expand = vi.spyOn(repo, 'expandDeck').mockResolvedValue({ added: 0 });
    await repo.acceptAction(command());

    await expect(
      repo.acceptAction(
        command({
          requestId: 'req_conflict',
          input: {
            scopeRevision: 0,
            focus: { cardType: 'infrastructure' },
            exclusions: [],
            maxCompanies: 4,
            maxSearchBatches: 1,
          },
        } as Partial<ActionRequest>),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(expand).toHaveBeenCalledTimes(1);
  });

  it('never dispatches when durable acceptance cannot be written', async () => {
    const store = memoryStore();
    vi.spyOn(store, 'write').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const repo = repository(store);
    const expand = vi.spyOn(repo, 'expandDeck').mockResolvedValue({ added: 1 });

    await expect(repo.acceptAction(command())).rejects.toThrow('disk full');
    expect(expand).not.toHaveBeenCalled();
    expect(store.current().actionRuns).toEqual([]);
  });

  it('fails paid actions closed when no trusted policy and budget gate is configured', async () => {
    const store = memoryStore();
    const repo = repository(store, false);
    const expand = vi.spyOn(repo, 'expandDeck').mockResolvedValue({ added: 1 });

    await expect(repo.acceptAction(command())).rejects.toMatchObject({
      code: 'ACTION_AUTHORIZATION_UNAVAILABLE',
    });
    expect(expand).not.toHaveBeenCalled();
    expect(store.current().actionRuns).toEqual([]);
  });
});
