import { expect, it, vi } from 'vitest';
import type { ActionRequest } from '@mi/contracts';
import { acceptDesktopAction } from './desktop-action';

const request: ActionRequest = {
  contractVersion: '1',
  requestId: 'req_bridge',
  idempotencyKey: 'bridge-discovery',
  action: 'market.discovery.expand',
  vaultId: 'vault_local',
  target: { marketId: 'mkt_frontier' },
  expectedRevision: 0,
  policyRef: 'policy_explicit',
  budgetRef: 'budget_explicit',
  input: {
    scopeRevision: 0,
    focus: {},
    exclusions: [],
    maxCompanies: 3,
    maxSearchBatches: 1,
    limits: { maxRequests: 90, maxInputTokens: 2_000_000, maxOutputTokens: 400_000 },
  },
};

it('binds desktop identity in the trusted host and returns the service receipt', async () => {
  const receipt = { actionId: 'act_saved' };
  const repository = { acceptAction: vi.fn().mockResolvedValue(receipt) };
  expect(await acceptDesktopAction(repository, request)).toBe(receipt);
  expect(repository.acceptAction).toHaveBeenCalledWith(expect.objectContaining(request), {
    principalRef: 'desktop_owner',
  });
});

it('rejects malformed and caller-forged commands before reaching the service', async () => {
  const repository = { acceptAction: vi.fn() };
  for (const input of [null, {}, { ...request, principalRef: 'another_owner' }]) {
    await expect(acceptDesktopAction(repository, input)).rejects.toThrow();
  }
  expect(repository.acceptAction).not.toHaveBeenCalled();
});

it('preserves service rejection instead of reporting a successful acceptance', async () => {
  const rejected = new Error('Approved research budget was not found.');
  const repository = { acceptAction: vi.fn().mockRejectedValue(rejected) };
  await expect(acceptDesktopAction(repository, request)).rejects.toBe(rejected);
});
