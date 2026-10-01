import { describe, expect, it, vi } from 'vitest';
import type { ActionRequest, BudgetPolicy, EgressPolicy } from '@mi/contracts';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient, UsageMeter } from './types';

function snapshot(): RepoSnapshot {
  const now = '2026-10-01T12:00:00.000Z';
  const scope = {
    kind: 'records' as const,
    records: [{ kind: 'market' as const, marketId: 'mkt_frontier', revision: 0 }],
  };
  const actionPolicy: EgressPolicy = {
    contractVersion: '1',
    id: 'policy_local_explicit',
    revision: 1,
    vaultId: 'vault_local',
    connectionIds: ['connection_local'],
    modelCapabilities: ['model', 'extraction'],
    retrievalCapabilities: ['native_grounding'],
    scope,
    purposes: ['market_research'],
    budgetRef: 'budget_local_monthly',
    issuedAt: '2026-09-30T00:00:00.000Z',
    expiresAt: '2026-10-30T00:00:00.000Z',
  };
  const budgetPolicy: BudgetPolicy = {
    contractVersion: '1',
    id: 'budget_local_monthly',
    revision: 1,
    vaultId: 'vault_local',
    maxRequests: 300,
    maxInputTokens: 4_000_000,
    maxOutputTokens: 800_000,
    durationDays: 30,
    connectionIds: ['connection_local'],
    scope,
    priceHandling: 'allow_unpriced',
    issuedAt: '2026-09-30T00:00:00.000Z',
    expiresAt: '2026-10-30T00:00:00.000Z',
    state: 'active',
  };
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
    decks: [
      { id: 'deck_frontier', marketId: 'mkt_frontier', createdAt: now, lastRefreshedAt: now },
    ],
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
    actionPolicies: [actionPolicy],
    budgetPolicies: [budgetPolicy],
    budgetReservations: [],
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
      limits: { maxRequests: 90, maxInputTokens: 2_000_000, maxOutputTokens: 400_000 },
    },
    ...overrides,
  } as ActionRequest;
}

function repository(store: ResearchStore): GeminiRepository {
  const unavailable = vi.fn().mockRejectedValue(new Error('provider should be stubbed'));
  return new GeminiRepository({
    store,
    client: { ground: unavailable, structure: unavailable } as unknown as LlmClient,
  });
}

const caller = { principalRef: 'desktop_owner' };

describe('durable action acceptance', () => {
  it('persists before dispatch and returns one receipt for simultaneous and restart replay', async () => {
    const store = memoryStore();
    const repo = repository(store);
    const expand = vi.spyOn(repo, 'expandDeck').mockImplementation(async (...args) => {
      expect(store.current().actionRuns).toHaveLength(1);
      expect(store.current().actionRuns[0]?.status).toBe('running');
      expect(store.current().budgetReservations[0]?.status).toBe('reserved');
      const usageMeter = (args[3] as { usageMeter?: UsageMeter } | undefined)?.usageMeter;
      expect(usageMeter).toBeDefined();
      const attempt = usageMeter!.beginAttempt({
        kind: 'model',
        estimatedInputTokens: 2_000,
        maxOutputTokens: 500,
      });
      usageMeter!.settleAttempt(attempt.id, { inputTokens: 120, outputTokens: 40 });
      return { added: 2 };
    });

    const [first, replay] = await Promise.all([
      repo.acceptAction(command(), caller),
      repo.acceptAction(command({ requestId: 'req_expand_retry' }), caller),
    ]);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      action: 'market.discovery.expand',
      effect: 'job',
      status: 'queued',
      target: { marketId: 'mkt_frontier' },
    });
    await vi.waitFor(() => expect(store.current().actionRuns[0]?.status).toBe('completed'));
    expect(store.current().actionRuns[0]?.principalRef).toBe('desktop_owner');
    expect(store.current().budgetReservations).toHaveLength(1);
    expect(store.current().budgetReservations[0]).toMatchObject({
      budgetRef: 'budget_local_monthly',
      status: 'settled',
      maxRequests: 90,
      maxInputTokens: 2_000_000,
      maxOutputTokens: 400_000,
      actualRequests: 1,
      actualInputTokens: 120,
      actualOutputTokens: 40,
      usageComplete: true,
    });
    expect(store.current().actionRuns[0]?.result).toEqual({ added: 2 });
    expect(expand).toHaveBeenCalledTimes(1);
    expect(expand).toHaveBeenCalledWith(
      'mkt_frontier',
      { cardType: 'infrastructure' },
      undefined,
      expect.objectContaining({
        target: 3,
        excludeNames: [],
        usageMeter: expect.any(Object),
      }),
    );

    const reopened = repository(store);
    const reopenedExpand = vi.spyOn(reopened, 'expandDeck').mockResolvedValue({ added: 99 });
    expect(
      await reopened.acceptAction(command({ requestId: 'req_after_restart' }), caller),
    ).toEqual(first);
    expect(reopenedExpand).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key for a different command before dispatch', async () => {
    const store = memoryStore();
    const repo = repository(store);
    const expand = vi.spyOn(repo, 'expandDeck').mockResolvedValue({ added: 0 });
    await repo.acceptAction(command(), caller);

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
            limits: { maxRequests: 115, maxInputTokens: 2_500_000, maxOutputTokens: 500_000 },
          },
        } as Partial<ActionRequest>),
        caller,
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

    await expect(repo.acceptAction(command(), caller)).rejects.toThrow('disk full');
    expect(expand).not.toHaveBeenCalled();
    expect(store.current().actionRuns).toEqual([]);
    expect(store.current().budgetReservations).toEqual([]);
  });

  it('fails paid actions closed when the referenced local policy is absent', async () => {
    const state = snapshot();
    state.actionPolicies = [];
    const store = memoryStore(state);
    const repo = repository(store);
    const expand = vi.spyOn(repo, 'expandDeck').mockResolvedValue({ added: 1 });

    await expect(repo.acceptAction(command(), caller)).rejects.toMatchObject({
      code: 'POLICY_REQUIRED',
    });
    expect(expand).not.toHaveBeenCalled();
    expect(store.current().actionRuns).toEqual([]);
  });

  it('rejects a command whose atomic reservation would exceed the remaining budget', async () => {
    const state = snapshot();
    state.budgetPolicies[0]!.maxRequests = 89;
    const store = memoryStore(state);
    const repo = repository(store);
    const expand = vi.spyOn(repo, 'expandDeck').mockResolvedValue({ added: 1 });

    await expect(repo.acceptAction(command(), caller)).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
    });
    expect(expand).not.toHaveBeenCalled();
    expect(store.current().budgetReservations).toEqual([]);
  });

  it('rejects a declared allowance below the current provider retry ceiling', async () => {
    const store = memoryStore();
    const repo = repository(store);
    const expand = vi.spyOn(repo, 'expandDeck').mockResolvedValue({ added: 1 });

    await expect(
      repo.acceptAction(
        command({
          input: {
            scopeRevision: 0,
            focus: { cardType: 'infrastructure' },
            exclusions: [],
            maxCompanies: 3,
            maxSearchBatches: 1,
            limits: {
              maxRequests: 89,
              maxInputTokens: 2_000_000,
              maxOutputTokens: 400_000,
            },
          },
        } as Partial<ActionRequest>),
        caller,
      ),
    ).rejects.toMatchObject({ code: 'BUDGET_REQUIRED' });
    expect(expand).not.toHaveBeenCalled();
    expect(store.current().budgetReservations).toEqual([]);
  });

  it('counts settled reservations when accepting later commands', async () => {
    const state = snapshot();
    state.budgetPolicies[0]!.maxRequests = 179;
    const store = memoryStore(state);
    const repo = repository(store);
    vi.spyOn(repo, 'expandDeck').mockResolvedValue({ added: 1 });
    await repo.acceptAction(command(), caller);

    await expect(
      repo.acceptAction(
        command({
          requestId: 'req_expand_2',
          idempotencyKey: 'expand-frontier-2',
        }),
        caller,
      ),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    expect(store.current().budgetReservations).toHaveLength(1);
  });

  it('uses fully reported usage instead of the conservative ceiling for later commands', async () => {
    const state = snapshot();
    state.budgetPolicies[0]!.maxRequests = 91;
    const store = memoryStore(state);
    const repo = repository(store);
    vi.spyOn(repo, 'expandDeck').mockImplementation(async (...args) => {
      const usageMeter = (args[3] as { usageMeter?: UsageMeter } | undefined)?.usageMeter;
      const attempt = usageMeter!.beginAttempt({
        kind: 'model',
        estimatedInputTokens: 100,
        maxOutputTokens: 10,
      });
      usageMeter!.settleAttempt(attempt.id, { inputTokens: 10, outputTokens: 2 });
      return { added: 1 };
    });
    await repo.acceptAction(command(), caller);
    await vi.waitFor(() => expect(store.current().budgetReservations[0]?.usageComplete).toBe(true));

    await expect(
      repo.acceptAction(
        command({ requestId: 'req_expand_2', idempotencyKey: 'expand-frontier-2' }),
        caller,
      ),
    ).resolves.toMatchObject({ status: 'queued' });
    expect(store.current().budgetReservations).toHaveLength(2);
  });

  it('settles the conservative reservation when provider work fails', async () => {
    const store = memoryStore();
    const repo = repository(store);
    vi.spyOn(repo, 'expandDeck').mockRejectedValue(new Error('provider unavailable'));

    const receipt = await repo.acceptAction(command(), caller);
    if (receipt.effect !== 'job') throw new Error('Expected a job receipt');
    await vi.waitFor(() => expect(store.current().actionRuns[0]?.status).toBe('failed'));
    expect(store.current().actionRuns[0]?.error).toBe('provider unavailable');
    expect(store.current().budgetReservations[0]).toMatchObject({
      runId: receipt.runId,
      status: 'settled',
      maxRequests: 90,
    });
  });

  it('requires an authenticated local principal before reserving or dispatching', async () => {
    const store = memoryStore();
    const repo = repository(store);
    const expand = vi.spyOn(repo, 'expandDeck').mockResolvedValue({ added: 1 });

    await expect(
      repo.acceptAction(command(), { principalRef: '../anonymous' }),
    ).rejects.toMatchObject({
      code: 'POLICY_REQUIRED',
    });
    expect(expand).not.toHaveBeenCalled();
    expect(store.current().budgetReservations).toEqual([]);
  });

  it('rejects expired policy grants and strict money caps without price metadata', async () => {
    const expired = snapshot();
    expired.actionPolicies[0]!.expiresAt = '2026-09-30T00:00:00.000Z';
    const expiredRepo = repository(memoryStore(expired));
    await expect(expiredRepo.acceptAction(command(), caller)).rejects.toMatchObject({
      code: 'POLICY_REQUIRED',
    });

    const priced = snapshot();
    priced.budgetPolicies[0]!.currencyLimit = { amountMinor: 500, currency: 'USD' };
    priced.budgetPolicies[0]!.priceHandling = 'reject_unknown';
    const pricedRepo = repository(memoryStore(priced));
    await expect(pricedRepo.acceptAction(command(), caller)).rejects.toMatchObject({
      code: 'PRICE_UNKNOWN',
    });
  });
});
