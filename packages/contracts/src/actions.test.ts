import { describe, expect, it } from 'vitest';
import {
  ACTION_DEFINITIONS,
  actionRequestSchema,
  researchActionReceiptSchema,
  researchRunStateSchema,
} from './actions';

const command = {
  contractVersion: '1',
  requestId: 'req_1',
  idempotencyKey: 'research-company-1',
  action: 'company.research.start',
  vaultId: 'v_1',
  target: { companyId: 'co_1', marketId: 'm_1' },
  expectedRevision: 12,
  input: { sections: ['products'], mode: 'fill_gaps' },
  policyRef: 'policy_1',
  budgetRef: 'budget_1',
};

const receipt = {
  contractVersion: '1',
  actionId: 'act_1',
  requestId: 'req_1',
  action: 'company.research.start',
  vaultId: 'v_1',
  target: { companyId: 'co_1', marketId: 'm_1' },
  acceptedAt: '2026-09-30T12:00:00.000Z',
  resultingRevision: 13,
  status: 'queued',
  runId: 'run_1',
};

describe('shared action contracts', () => {
  it('keeps all 62 planned action names and IDs unique', () => {
    const definitions = Object.values(ACTION_DEFINITIONS);
    expect(definitions).toHaveLength(62);
    expect(new Set(definitions.map((definition) => definition.id)).size).toBe(62);
    expect(definitions.map((definition) => definition.id)).toEqual(
      Array.from({ length: 62 }, (_, index) => `A${String(index + 1).padStart(2, '0')}`),
    );
  });

  it('separates cached reads, billable jobs, and human-only operations', () => {
    expect(ACTION_DEFINITIONS['company.get']).toMatchObject({
      effect: 'read',
      billable: false,
      external: 'scoped',
    });
    expect(ACTION_DEFINITIONS['company.research.start']).toMatchObject({
      effect: 'job',
      billable: true,
      scope: 'research:run',
    });
    expect(ACTION_DEFINITIONS['observation.confirm']).toMatchObject({
      external: 'never',
      humanOnly: true,
    });
    expect(ACTION_DEFINITIONS['provider.configure']).toMatchObject({
      external: 'never',
      humanOnly: true,
    });
  });

  it('preserves a versioned company research command without inventing authority', () => {
    expect(actionRequestSchema.parse(command)).toEqual(command);
  });

  it.each(['actor', 'user_verified', 'apiKey', 'grant', 'shell'])(
    'rejects caller-supplied %s in the envelope',
    (field) => {
      expect(actionRequestSchema.safeParse({ ...command, [field]: 'forged' }).success).toBe(false);
    },
  );

  it.each(['policyRef', 'budgetRef', 'expectedRevision', 'idempotencyKey'])(
    'requires %s before accepting a paid command',
    (field) => {
      const malformed: Record<string, unknown> = { ...command };
      delete malformed[field];
      expect(actionRequestSchema.safeParse(malformed).success).toBe(false);
    },
  );

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid revision %s',
    (expectedRevision) => {
      expect(actionRequestSchema.safeParse({ ...command, expectedRevision }).success).toBe(false);
    },
  );

  it('rejects unknown input, target fields, empty sections and unsafe identifiers', () => {
    for (const replacement of [
      { input: { ...command.input, apiKey: 'secret' } },
      { target: { ...command.target, filePath: '../vault.sqlite' } },
      { target: { companyId: '../co_1' } },
      { target: { marketId: 'm_1' } },
      { input: { sections: [], mode: 'fill_gaps' } },
      { input: { sections: ['products', 'products'], mode: 'refresh' } },
      { input: { sections: ['unlimited_web'], mode: 'refresh' } },
    ]) {
      expect(actionRequestSchema.safeParse({ ...command, ...replacement }).success).toBe(false);
    }
  });

  it('validates market discovery bounds and requires the saved scope revision', () => {
    const marketCommand = {
      ...command,
      action: 'market.research.start',
      target: { marketId: 'm_1' },
      input: {
        scopeRevision: 2,
        depth: 'standard',
        seedCompanyIds: ['co_1'],
        maxCompanies: 12,
        maxSearchBatches: 6,
      },
    };
    expect(actionRequestSchema.safeParse(marketCommand).success).toBe(true);
    expect(
      actionRequestSchema.safeParse({
        ...marketCommand,
        input: { ...marketCommand.input, maxCompanies: 0 },
      }).success,
    ).toBe(false);
    expect(
      actionRequestSchema.safeParse({
        ...marketCommand,
        input: { ...marketCommand.input, scopeRevision: undefined },
      }).success,
    ).toBe(false);
  });

  it('accepts cached company reads with no spending or mutation fields', () => {
    const read = {
      contractVersion: '1',
      requestId: 'req_read',
      action: 'company.get',
      vaultId: 'v_1',
      target: { companyId: 'co_1' },
      input: { section: 'overview', revision: 12 },
    };
    expect(actionRequestSchema.parse(read)).toEqual(read);
    expect(actionRequestSchema.safeParse({ ...read, budgetRef: 'budget_1' }).success).toBe(false);
    expect(actionRequestSchema.safeParse({ ...read, input: { force: true } }).success).toBe(false);
  });

  it('requires revalidated spending policy on resume but not on cancellation', () => {
    const control = {
      contractVersion: '1',
      requestId: 'req_control',
      idempotencyKey: 'cancel-run-1',
      action: 'run.cancel',
      vaultId: 'v_1',
      target: { runId: 'run_1' },
      expectedRevision: 2,
      input: {},
    };
    expect(actionRequestSchema.safeParse(control).success).toBe(true);
    expect(actionRequestSchema.safeParse({ ...control, action: 'run.resume' }).success).toBe(false);
    expect(
      actionRequestSchema.safeParse({
        ...control,
        action: 'run.resume',
        policyRef: 'policy_1',
        budgetRef: 'budget_1',
      }).success,
    ).toBe(true);
  });

  it('bounds event replay pagination and treats cursors as data, not paths', () => {
    const query = {
      contractVersion: '1',
      requestId: 'req_events',
      action: 'run.events.list',
      vaultId: 'v_1',
      target: { runId: 'run_1' },
      input: { cursor: 'event_50', limit: 100 },
    };
    expect(actionRequestSchema.safeParse(query).success).toBe(true);
    expect(actionRequestSchema.safeParse({ ...query, input: { limit: 101 } }).success).toBe(false);
  });

  it('fails closed for unknown or not-yet-schema-backed actions', () => {
    for (const action of ['execute', 'fetch_url', 'provider.configure', 'observation.confirm']) {
      expect(actionRequestSchema.safeParse({ ...command, action }).success).toBe(false);
    }
  });

  it('requires an addressable run for asynchronous receipts', () => {
    expect(researchActionReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(researchActionReceiptSchema.safeParse({ ...receipt, runId: undefined }).success).toBe(
      false,
    );
    expect(
      researchActionReceiptSchema.safeParse({ ...receipt, action: 'company.get' }).success,
    ).toBe(false);
    expect(
      researchActionReceiptSchema.safeParse({ ...receipt, target: { marketId: 'm_1' } }).success,
    ).toBe(false);
  });

  it('does not let a resume receipt point to a different run or carry an actor claim', () => {
    const resumed = { ...receipt, action: 'run.resume', target: { runId: 'run_1' } };
    expect(researchActionReceiptSchema.safeParse(resumed).success).toBe(true);
    expect(researchActionReceiptSchema.safeParse({ ...resumed, runId: 'run_2' }).success).toBe(
      false,
    );
    expect(researchActionReceiptSchema.safeParse({ ...resumed, actor: 'owner' }).success).toBe(
      false,
    );
  });

  it('rejects duplicate seeds, excessive discovery, invalid versions and path cursors', () => {
    const discovery = {
      ...command,
      action: 'market.research.start',
      target: { marketId: 'm_1' },
      input: {
        scopeRevision: 2,
        depth: 'standard',
        seedCompanyIds: ['co_1'],
        maxCompanies: 12,
        maxSearchBatches: 6,
      },
    };
    for (const input of [
      { ...discovery.input, seedCompanyIds: ['co_1', 'co_1'] },
      { ...discovery.input, maxCompanies: 51 },
      { ...discovery.input, maxSearchBatches: 1.5 },
    ]) {
      expect(actionRequestSchema.safeParse({ ...discovery, input }).success).toBe(false);
    }
    expect(actionRequestSchema.safeParse({ ...command, contractVersion: '2' }).success).toBe(false);
    expect(
      actionRequestSchema.safeParse({
        contractVersion: '1',
        requestId: 'req_events',
        action: 'run.events.list',
        vaultId: 'v_1',
        target: { runId: 'run_1' },
        input: { cursor: '../events', limit: 25 },
      }).success,
    ).toBe(false);
  });

  it('does not confuse requested cancellation/pause with acknowledged completion', () => {
    for (const state of ['pausing', 'paused', 'cancelling', 'cancelled', 'partial']) {
      expect(researchRunStateSchema.safeParse(state).success).toBe(true);
    }
    expect(researchRunStateSchema.safeParse('stopping').success).toBe(false);
  });
});
