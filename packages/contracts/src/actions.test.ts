import { describe, expect, it } from 'vitest';
import {
  ACTION_DEFINITIONS,
  actionRequestSchema,
  researchActionReceiptSchema,
  researchRunStateSchema,
  isResearchRunTransitionAllowed,
  actionFailureSchema,
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

const scopeDraft = {
  goal: 'Compare regional robotics automation vendors',
  inclusions: ['Warehouse robotics'],
  exclusions: ['Consumer toys'],
  region: 'North America',
  depth: 'standard',
  seeds: [{ name: 'Example Robotics', domain: 'example.com' }],
};

const selectedAnswerTargets = [{ kind: 'company', companyId: 'co_1', revision: 4 }];
const selectedReportTargets = [{ kind: 'company', companyId: 'co_1', revision: 4 }];

const newActionRequest = (
  action: string,
  target: Record<string, unknown>,
  input: Record<string, unknown>,
  kind: 'read' | 'write' | 'paid',
) => ({
  contractVersion: '1',
  requestId: 'req_new',
  vaultId: 'v_1',
  action,
  target,
  input,
  ...(kind === 'read' ? {} : { idempotencyKey: 'new-action-1', expectedRevision: 5 }),
  ...(kind === 'paid' ? { policyRef: 'policy_1', budgetRef: 'budget_1' } : {}),
});

const newlyBackedActions = [
  ['scope.preview', newActionRequest('scope.preview', {}, scopeDraft, 'read')],
  ['scope.assist.start', newActionRequest('scope.assist.start', {}, scopeDraft, 'paid')],
  ['market.create', newActionRequest('market.create', {}, scopeDraft, 'write')],
  [
    'market.scope.update',
    newActionRequest('market.scope.update', { marketId: 'm_1' }, scopeDraft, 'write'),
  ],
  [
    'membership.update',
    newActionRequest(
      'membership.update',
      { companyId: 'co_1', marketId: 'm_1' },
      {
        companyRevision: 4,
        roles: ['company', 'distribution'],
        fit: { basis: 'evidence', evidenceIds: ['ev_1'], reason: 'Evidence shows channel sales.' },
      },
      'write',
    ),
  ],
  [
    'saved.update',
    newActionRequest(
      'saved.update',
      { kind: 'company', companyId: 'co_1' },
      { saved: true },
      'write',
    ),
  ],
  [
    'market.discovery.expand',
    newActionRequest(
      'market.discovery.expand',
      { marketId: 'm_1' },
      {
        scopeRevision: 3,
        exclusions: ['consumer products'],
        maxCompanies: 12,
        maxSearchBatches: 5,
      },
      'paid',
    ),
  ],
  [
    'finding.research.start',
    newActionRequest(
      'finding.research.start',
      { marketId: 'm_1' },
      { scopeRevision: 3, kind: 'trend', focus: 'Warehouse automation', maxSearchBatches: 4 },
      'paid',
    ),
  ],
  [
    'answer.from_library.start',
    newActionRequest(
      'answer.from_library.start',
      {},
      {
        question: 'Which vendors support cold storage?',
        targets: selectedAnswerTargets,
        maxEvidence: 20,
      },
      'paid',
    ),
  ],
  [
    'answer.research.start',
    newActionRequest(
      'answer.research.start',
      {},
      {
        question: 'Which vendors support cold storage?',
        targets: selectedAnswerTargets,
        maxEvidence: 20,
        webExpansion: { enabled: true, maxSearchBatches: 3, maxResultsPerBatch: 5 },
      },
      'paid',
    ),
  ],
  [
    'comparison.explain.start',
    newActionRequest(
      'comparison.explain.start',
      {},
      {
        companies: [
          { companyId: 'co_1', revision: 4 },
          { companyId: 'co_2', revision: 7 },
        ],
        goal: 'Choose a warehouse pilot vendor',
        weights: [
          { criterion: 'Deployment time', weight: 0.6 },
          { criterion: 'Cold storage support', weight: 0.4 },
        ],
      },
      'paid',
    ),
  ],
  [
    'report.create.start',
    newActionRequest(
      'report.create.start',
      {},
      {
        targets: selectedReportTargets,
        templateId: 'brief_standard',
        templateVersion: '1.0',
      },
      'paid',
    ),
  ],
  [
    'evidence.check.start',
    newActionRequest(
      'evidence.check.start',
      {},
      {
        items: [{ kind: 'claim', claimId: 'claim_1', revision: 2 }],
        retrievalScope: { mode: 'approved_web', maxSearchBatches: 3 },
      },
      'paid',
    ),
  ],
  [
    'run.retry',
    newActionRequest(
      'run.retry',
      { runId: 'run_1' },
      {
        selection: 'failed_tasks',
        tasks: [{ taskId: 'task_1', revision: 2 }],
        maxAttempts: 1,
      },
      'paid',
    ),
  ],
  [
    'updates.check.start',
    newActionRequest(
      'updates.check.start',
      {},
      {
        companies: [
          { companyId: 'co_1', revision: 4 },
          { companyId: 'co_2', revision: 7 },
        ],
        focus: 'Material product and leadership changes',
        maxSearchBatches: 4,
      },
      'paid',
    ),
  ],
] as const;

describe('shared action contracts', () => {
  it('permits market discovery without seeds or a geography restriction', () => {
    expect(
      actionRequestSchema.safeParse(
        newActionRequest(
          'scope.preview',
          {},
          {
            ...scopeDraft,
            seeds: [],
            region: null,
          },
          'read',
        ),
      ).success,
    ).toBe(true);
  });

  it('preserves same-name seed ambiguity instead of treating names as identity', () => {
    const input = {
      ...scopeDraft,
      seeds: [
        { name: 'Example Labs', domain: 'one.example' },
        { name: 'Example Labs', domain: 'two.example' },
      ],
    };
    const request = newActionRequest('scope.preview', {}, input, 'read');
    expect(actionRequestSchema.parse(request)).toEqual(request);
    expect(
      actionRequestSchema.safeParse({
        ...request,
        input: {
          ...input,
          seeds: [input.seeds[0], input.seeds[0]],
        },
      }).success,
    ).toBe(false);
  });
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

  it.each(newlyBackedActions)('accepts the bounded %s request shape', (_action, request) => {
    expect(actionRequestSchema.parse(request)).toEqual(request);
  });

  it.each(newlyBackedActions)(
    'keeps %s strict at the envelope, target, and input boundaries',
    (_action, request) => {
      expect(actionRequestSchema.safeParse({ ...request, actor: 'owner' }).success).toBe(false);
      expect(
        actionRequestSchema.safeParse({
          ...request,
          target: { ...(request.target as object), extra: 'unexpected' },
        }).success,
      ).toBe(false);
      expect(
        actionRequestSchema.safeParse({
          ...request,
          input: { ...(request.input as object), extra: 'unexpected' },
        }).success,
      ).toBe(false);
    },
  );

  it('rejects unbounded scope, forged fit support, and invalid membership preconditions', () => {
    const preview = newlyBackedActions[0][1];
    expect(
      actionRequestSchema.safeParse({
        ...preview,
        input: { ...scopeDraft, webSearch: true },
      }).success,
    ).toBe(false);
    expect(
      actionRequestSchema.safeParse({
        ...preview,
        input: { ...scopeDraft, seeds: [{ name: 'Example', domain: 'https://example.com' }] },
      }).success,
    ).toBe(false);
    const membership = newlyBackedActions[4][1];
    expect(
      actionRequestSchema.safeParse({
        ...membership,
        input: { ...membership.input, companyRevision: undefined },
      }).success,
    ).toBe(false);
    expect(
      actionRequestSchema.safeParse({
        ...membership,
        input: {
          ...membership.input,
          fit: {
            basis: 'human_judgment',
            label: 'Evidence verified',
            reason: 'Reviewed by a person.',
          },
        },
      }).success,
    ).toBe(false);
  });

  it('requires paid envelopes for jobs and rejects spending authority on local writes', () => {
    const paidRequest = newlyBackedActions[1][1];
    expect(actionRequestSchema.safeParse({ ...paidRequest, policyRef: undefined }).success).toBe(
      false,
    );
    const writeRequest = newlyBackedActions[2][1];
    expect(
      actionRequestSchema.safeParse({
        ...writeRequest,
        policyRef: 'policy_1',
        budgetRef: 'budget_1',
      }).success,
    ).toBe(false);
    expect(
      actionRequestSchema.safeParse({ ...writeRequest, idempotencyKey: undefined }).success,
    ).toBe(false);
  });

  it('keeps library answers offline and bounds external answer expansion', () => {
    const libraryAnswer = newlyBackedActions[8][1];
    expect(
      actionRequestSchema.safeParse({
        ...libraryAnswer,
        input: {
          ...libraryAnswer.input,
          webExpansion: { enabled: true, maxSearchBatches: 1, maxResultsPerBatch: 1 },
        },
      }).success,
    ).toBe(false);
    const webAnswer = newlyBackedActions[9][1];
    expect(
      actionRequestSchema.safeParse({
        ...webAnswer,
        input: {
          ...webAnswer.input,
          webExpansion: { enabled: true, maxSearchBatches: 51, maxResultsPerBatch: 5 },
        },
      }).success,
    ).toBe(false);
    expect(
      actionRequestSchema.safeParse({
        ...webAnswer,
        input: {
          ...webAnswer.input,
          targets: [{ kind: 'company', companyId: 'co_1' }],
        },
      }).success,
    ).toBe(false);
  });

  it('requires explicit revisions and finite selections for comparison and report inputs', () => {
    const comparison = newlyBackedActions[10][1];
    expect(
      actionRequestSchema.safeParse({
        ...comparison,
        input: {
          ...comparison.input,
          companies: [{ companyId: 'co_1', revision: 4 }, { companyId: 'co_2' }],
        },
      }).success,
    ).toBe(false);
    const report = newlyBackedActions[11][1];
    expect(
      actionRequestSchema.safeParse({
        ...report,
        input: { ...report.input, targets: [{ kind: 'company', companyId: 'co_1' }] },
      }).success,
    ).toBe(false);
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

  it.each([
    ['library.search', {}, { query: 'robotics', kinds: ['company'], limit: 25 }],
    ['market.list', {}, { limit: 25, savedOnly: true }],
    ['evidence.get', { passageId: 'passage_1' }, { revision: 3 }],
    ['company.resolve', {}, { names: ['Example Labs'], domains: [], context: 'robotics' }],
    ['comparison.get', { companyIds: ['co_1', 'co_2'] }, { revision: 3 }],
    ['report.get', { reportId: 'report_1' }, {}],
    ['updates.list', { companyId: 'co_1' }, { since: '2026-09-30T00:00:00.000Z', limit: 25 }],
    ['provider.status', { connectionId: 'connection_1' }, {}],
    ['budget.get', { budgetId: 'budget_1' }, {}],
    ['vault.status', {}, {}],
  ])('accepts bounded cached %s reads without spending fields', (action, target, input) => {
    const query = {
      contractVersion: '1',
      requestId: 'req_read',
      vaultId: 'v_1',
      action,
      target,
      input,
    };
    expect(actionRequestSchema.parse(query)).toEqual(query);
    expect(actionRequestSchema.safeParse({ ...query, budgetRef: 'budget_1' }).success).toBe(false);
    expect(
      actionRequestSchema.safeParse({ ...query, input: { ...input, force: true } }).success,
    ).toBe(false);
  });

  it.each([
    ['library.search', {}, { query: 'robotics', limit: 101 }],
    ['library.search', {}, { query: ' ', limit: 25 }],
    ['evidence.get', { sourceId: 's_1', claimId: 'claim_1' }, {}],
    ['company.resolve', {}, { names: [], domains: [] }],
    ['company.resolve', {}, { names: [], domains: ['https://example.com/secret'] }],
    ['comparison.get', { companyIds: ['co_1', 'co_1'] }, {}],
    ['updates.list', {}, { limit: 25 }],
    ['updates.list', { companyId: 'co_1', marketId: 'm_1' }, { limit: 25 }],
    ['provider.status', { connectionId: '../credentials' }, {}],
  ])('rejects ambiguous or unsafe %s query input', (action, target, input) => {
    expect(
      actionRequestSchema.safeParse({
        contractVersion: '1',
        requestId: 'req_read',
        vaultId: 'v_1',
        action,
        target,
        input,
      }).success,
    ).toBe(false);
  });

  it('requires acknowledged pause/cancel states and forbids terminal resurrection', () => {
    expect(isResearchRunTransitionAllowed('running', 'pausing')).toBe(true);
    expect(isResearchRunTransitionAllowed('pausing', 'paused')).toBe(true);
    expect(isResearchRunTransitionAllowed('paused', 'queued')).toBe(true);
    expect(isResearchRunTransitionAllowed('pausing', 'cancelling')).toBe(true);
    expect(isResearchRunTransitionAllowed('cancelling', 'cancelled')).toBe(true);
    expect(isResearchRunTransitionAllowed('running', 'cancelled')).toBe(false);
    expect(isResearchRunTransitionAllowed('running', 'paused')).toBe(false);
    for (const terminal of ['completed', 'partial', 'failed', 'cancelled'] as const) {
      expect(isResearchRunTransitionAllowed(terminal, 'running')).toBe(false);
      expect(isResearchRunTransitionAllowed(terminal, 'queued')).toBe(false);
    }
  });

  it('returns structured recovery without raw provider errors, secret fields or existence leaks', () => {
    const failure = {
      contractVersion: '1',
      requestId: 'req_1',
      code: 'NOT_FOUND_OR_NOT_ALLOWED',
      retryable: false,
      nextAction: null,
    };
    expect(actionFailureSchema.parse(failure)).toEqual(failure);
    expect(actionFailureSchema.safeParse({ ...failure, code: 'NOT_FOUND' }).success).toBe(false);
    expect(actionFailureSchema.safeParse({ ...failure, apiKey: 'secret' }).success).toBe(false);
    expect(
      actionFailureSchema.safeParse({ ...failure, providerResponse: 'private research' }).success,
    ).toBe(false);
    expect(actionFailureSchema.safeParse({ ...failure, nextAction: 'fetch_url' }).success).toBe(
      false,
    );
    expect(
      actionFailureSchema.safeParse({
        ...failure,
        code: 'BUDGET_REQUIRED',
        nextAction: 'budget.preview',
      }).success,
    ).toBe(true);
  });
});
