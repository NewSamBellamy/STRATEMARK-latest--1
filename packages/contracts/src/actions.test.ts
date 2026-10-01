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
        focus: { cardType: 'infrastructure', tier: 4 },
        exclusions: ['consumer products'],
        maxCompanies: 12,
        maxSearchBatches: 5,
        limits: { maxRequests: 190, maxInputTokens: 7_600_000, maxOutputTokens: 1_520_000 },
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

const sha256 = 'a'.repeat(64);
const approval = { approvalRef: 'approval_1' };
const monitorLimits = {
  maxRequestsPerTick: 8,
  maxInputTokensPerRequest: 4000,
  maxOutputTokensPerRequest: 1000,
  currencyLimit: { currency: 'USD', amountMinor: 500 },
};
const remainingActions = [
  [
    'company.merge',
    newActionRequest(
      'company.merge',
      { companyId: 'co_survivor', mergeCompanyId: 'co_duplicate' },
      {
        mergeCompanyRevision: 7,
        reviewedEvidenceIds: ['evidence_1'],
        ...approval,
      },
      'write',
    ),
  ],
  [
    'observation.correct',
    newActionRequest(
      'observation.correct',
      { observationId: 'observation_1' },
      {
        correctedValue: 12.5,
        status: 'supported',
        reason: 'The cited report gives the corrected value.',
        supportIds: ['evidence_1'],
        ...approval,
      },
      'write',
    ),
  ],
  [
    'observation.confirm',
    newActionRequest(
      'observation.confirm',
      { observationId: 'observation_1' },
      { supportIds: ['evidence_1'], reason: 'Checked against the retained source.', ...approval },
      'write',
    ),
  ],
  [
    'monitor.preview',
    newActionRequest(
      'monitor.preview',
      {},
      {
        companies: [{ companyId: 'co_1', revision: 4 }],
        cadence: 'daily',
        limits: monitorLimits,
      },
      'read',
    ),
  ],
  [
    'monitor.enable',
    newActionRequest(
      'monitor.enable',
      {},
      {
        proposalId: 'proposal_1',
        proposalHash: sha256,
        policyRef: 'policy_1',
        budgetRef: 'budget_1',
        ...approval,
      },
      'write',
    ),
  ],
  [
    'monitor.update',
    newActionRequest(
      'monitor.update',
      { scheduleId: 'schedule_1' },
      { changes: { cadence: 'weekly', limits: monitorLimits } },
      'write',
    ),
  ],
  [
    'monitor.disable',
    newActionRequest(
      'monitor.disable',
      { scheduleId: 'schedule_1' },
      { activeRunHandling: 'allow_finish' },
      'write',
    ),
  ],
  [
    'connection.grant',
    newActionRequest(
      'connection.grant',
      {},
      {
        clientBindingRef: 'client_1',
        records: [{ kind: 'company', companyId: 'co_1', revision: 4 }],
        actions: ['company.get', 'evidence.get'],
        fields: ['identity', 'overview', 'observations', 'evidence'],
        maxResponseBytes: 65536,
        expiresInHours: 24,
        ...approval,
      },
      'write',
    ),
  ],
  [
    'connection.revoke',
    newActionRequest('connection.revoke', { grantId: 'grant_1' }, approval, 'write'),
  ],
  [
    'connection.audit.list',
    newActionRequest('connection.audit.list', { grantId: 'grant_1' }, { limit: 25 }, 'read'),
  ],
  [
    'export.preview',
    newActionRequest(
      'export.preview',
      {},
      {
        targets: [{ kind: 'company', companyId: 'co_1', revision: 4 }],
        format: 'json',
        evidenceDepth: 'supporting',
      },
      'read',
    ),
  ],
  [
    'export.create',
    newActionRequest(
      'export.create',
      {},
      { previewId: 'preview_1', previewHash: sha256, saveDialogRef: 'dialog_1', ...approval },
      'write',
    ),
  ],
  ['import.preview', newActionRequest('import.preview', {}, { openDialogRef: 'dialog_1' }, 'read')],
  [
    'import.apply',
    newActionRequest(
      'import.apply',
      {},
      { previewId: 'preview_1', previewHash: sha256, ...approval },
      'write',
    ),
  ],
  ['backup.create', newActionRequest('backup.create', {}, { retentionDays: 30 }, 'write')],
  [
    'backup.restore',
    newActionRequest(
      'backup.restore',
      {},
      { backupHandle: 'backup_1', backupHash: sha256, ...approval },
      'write',
    ),
  ],
  [
    'vault.relocate',
    newActionRequest(
      'vault.relocate',
      {},
      { directoryDialogRef: 'directory_1', ...approval },
      'write',
    ),
  ],
  [
    'record.trash',
    newActionRequest(
      'record.trash',
      { kind: 'company', companyId: 'co_1' },
      { impactPreviewId: 'preview_1', impactPreviewHash: sha256, ...approval },
      'write',
    ),
  ],
  [
    'record.restore',
    newActionRequest('record.restore', { tombstoneId: 'tombstone_1' }, approval, 'write'),
  ],
  [
    'record.purge',
    newActionRequest(
      'record.purge',
      { tombstoneId: 'tombstone_1' },
      { confirmationPhrase: 'PURGE', ...approval },
      'write',
    ),
  ],
  [
    'provider.configure',
    newActionRequest(
      'provider.configure',
      {},
      {
        endpoint: 'https://api.example.com/v1',
        protocol: 'openai_chat_completions',
        capabilities: ['model', 'search'],
        secretInputRef: 'secret_input_1',
        ...approval,
      },
      'write',
    ),
  ],
  [
    'provider.test.start',
    newActionRequest(
      'provider.test.start',
      { connectionId: 'connection_1' },
      {
        limits: { maxRequests: 1, maxInputTokens: 2000, maxOutputTokens: 500 },
        capabilities: ['model'],
        ...approval,
      },
      'paid',
    ),
  ],
  [
    'provider.remove',
    newActionRequest('provider.remove', { connectionId: 'connection_1' }, approval, 'write'),
  ],
  [
    'budget.preview',
    newActionRequest(
      'budget.preview',
      {},
      {
        connectionIds: ['connection_1'],
        targets: [{ kind: 'company', companyId: 'co_1', revision: 4 }],
        limits: { maxRequests: 100, maxInputTokens: 20000, maxOutputTokens: 4000 },
        durationDays: 30,
        currencyLimit: { currency: 'USD', amountMinor: 10000 },
        priceHandling: 'reject_unknown',
      },
      'read',
    ),
  ],
  [
    'budget.approve',
    newActionRequest(
      'budget.approve',
      {},
      { proposalId: 'proposal_1', proposalHash: sha256, ...approval },
      'write',
    ),
  ],
  [
    'budget.restrict',
    newActionRequest(
      'budget.restrict',
      { budgetId: 'budget_1' },
      { limits: { maxRequests: 50, maxInputTokens: 8000, maxOutputTokens: 2000 } },
      'write',
    ),
  ],
  [
    'preferences.update',
    newActionRequest(
      'preferences.update',
      {},
      { viewMode: 'cards', sortBy: 'name', metricProfileId: 'metric_default' },
      'write',
    ),
  ],
  [
    'navigation.open',
    newActionRequest('navigation.open', { kind: 'source', sourceId: 'source_1' }, approval, 'read'),
  ],
] as const;

type RequestFixture = ReturnType<typeof newActionRequest>;
const invalidRemainingActions: readonly (readonly [
  string,
  (request: RequestFixture) => unknown,
])[] = [
  [
    'company.merge',
    (request) => ({ ...request, target: { ...request.target, mergeCompanyId: 'co_survivor' } }),
  ],
  [
    'observation.correct',
    (request) => ({ ...request, input: { ...request.input, status: 'user_verified' } }),
  ],
  [
    'observation.confirm',
    (request) => ({ ...request, input: { ...request.input, approvalRef: undefined } }),
  ],
  ['monitor.preview', (request) => ({ ...request, input: { ...request.input, companies: [] } })],
  [
    'monitor.enable',
    (request) => ({ ...request, input: { ...request.input, proposalHash: 'not-a-hash' } }),
  ],
  ['monitor.update', (request) => ({ ...request, input: { ...request.input, changes: {} } })],
  [
    'monitor.disable',
    (request) => ({ ...request, input: { ...request.input, activeRunHandling: 'maybe' } }),
  ],
  ['connection.grant', (request) => ({ ...request, input: { ...request.input, actions: ['*'] } })],
  [
    'connection.revoke',
    (request) => ({ ...request, input: { ...request.input, approvalRef: undefined } }),
  ],
  ['connection.audit.list', (request) => ({ ...request, input: { ...request.input, limit: 101 } })],
  ['export.preview', (request) => ({ ...request, input: { ...request.input, targets: [] } })],
  [
    'export.create',
    (request) => ({
      ...request,
      input: { ...request.input, saveDialogRef: 'C:\\private\\export.json' },
    }),
  ],
  [
    'import.preview',
    (request) => ({ ...request, input: { openDialogRef: 'C:\\private\\import.json' } }),
  ],
  [
    'import.apply',
    (request) => ({ ...request, input: { ...request.input, approvalRef: undefined } }),
  ],
  ['backup.create', (request) => ({ ...request, input: { retentionDays: 0 } })],
  ['backup.restore', (request) => ({ ...request, input: { ...request.input, backupHash: 'abc' } })],
  [
    'vault.relocate',
    (request) => ({ ...request, input: { directory: 'C:\\private\\vault', ...request.input } }),
  ],
  [
    'record.trash',
    (request) => ({ ...request, input: { ...request.input, impactPreviewHash: 'abc' } }),
  ],
  [
    'record.restore',
    (request) => ({ ...request, input: { ...request.input, approvalRef: undefined } }),
  ],
  [
    'record.purge',
    (request) => ({ ...request, input: { ...request.input, confirmationPhrase: 'delete' } }),
  ],
  [
    'provider.configure',
    (request) => ({
      ...request,
      input: { ...request.input, endpoint: 'https://user:pass@api.example.com/v1' },
    }),
  ],
  [
    'provider.test.start',
    (request) => ({
      ...request,
      input: {
        ...request.input,
        limits: { ...(request.input.limits as Record<string, unknown>), maxRequests: 0 },
      },
    }),
  ],
  [
    'provider.remove',
    (request) => ({ ...request, input: { ...request.input, approvalRef: undefined } }),
  ],
  ['budget.preview', (request) => ({ ...request, input: { ...request.input, durationDays: 366 } })],
  [
    'budget.approve',
    (request) => ({ ...request, input: { ...request.input, proposalHash: 'abc' } }),
  ],
  ['budget.restrict', (request) => ({ ...request, input: { limits: {} } })],
  [
    'preferences.update',
    (request) => ({ ...request, input: { ...request.input, budgetRef: 'budget_1' } }),
  ],
  [
    'navigation.open',
    (request) => ({ ...request, target: { kind: 'source', path: 'C:\\secret' } }),
  ],
];

const remainingRequest = (action: string): RequestFixture => {
  const fixture = remainingActions.find(([name]) => name === action);
  if (!fixture) throw new Error(`Missing action fixture: ${action}`);
  return fixture[1];
};

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

  it('backs every catalogue action with exactly one request schema', () => {
    const schemaActions = actionRequestSchema.options.map((option) => option.shape.action.value);
    expect(schemaActions).toHaveLength(62);
    expect(new Set(schemaActions)).toEqual(new Set(Object.keys(ACTION_DEFINITIONS)));
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

  it('keeps local storage jobs nonbillable and provider tests billable', () => {
    for (const action of [
      'export.create',
      'import.apply',
      'backup.create',
      'backup.restore',
      'vault.relocate',
      'record.purge',
    ] as const) {
      expect(ACTION_DEFINITIONS[action]).toMatchObject({
        effect: 'job',
        billable: false,
        scope: 'local',
      });
    }
    expect(ACTION_DEFINITIONS['provider.test.start']).toMatchObject({
      effect: 'job',
      billable: true,
      humanOnly: true,
    });
  });

  it('preserves a versioned company research command without inventing authority', () => {
    expect(actionRequestSchema.parse(command)).toEqual(command);
  });

  it.each(newlyBackedActions)('accepts the bounded %s request shape', (_action, request) => {
    expect(actionRequestSchema.parse(request)).toEqual(request);
  });

  it('requires a bounded explicit focus object for discovery expansion', () => {
    const request = newlyBackedActions.find(([name]) => name === 'market.discovery.expand')?.[1];
    expect(request).toBeDefined();
    const input = request!.input as Record<string, unknown>;
    expect(
      actionRequestSchema.safeParse({ ...request, input: { ...input, focus: undefined } }).success,
    ).toBe(false);
    expect(
      actionRequestSchema.safeParse({ ...request, input: { ...input, limits: undefined } }).success,
    ).toBe(false);
    expect(
      actionRequestSchema.safeParse({ ...request, input: { ...input, focus: { tier: 9 } } })
        .success,
    ).toBe(false);
    expect(
      actionRequestSchema.safeParse({
        ...request,
        input: { ...input, focus: { cardType: 'made_up_role' } },
      }).success,
    ).toBe(false);
  });

  it.each(remainingActions)(
    'accepts the bounded remaining %s request shape',
    (_action, request) => {
      expect(actionRequestSchema.parse(request)).toEqual(request);
    },
  );

  it.each(remainingActions)(
    'keeps remaining %s strict at the envelope, target, and input boundaries',
    (_action, request) => {
      expect(actionRequestSchema.safeParse({ ...request, actor: 'owner' }).success).toBe(false);
      expect(
        actionRequestSchema.safeParse({
          ...request,
          target: { ...(request.target as object), filePath: '../vault.sqlite' },
        }).success,
      ).toBe(false);
      expect(
        actionRequestSchema.safeParse({
          ...request,
          input: { ...request.input, force: true },
        }).success,
      ).toBe(false);
    },
  );

  it.each(invalidRemainingActions)('rejects invalid bounded %s input', (_action, invalidate) => {
    const request = remainingRequest(_action);
    expect(actionRequestSchema.safeParse(invalidate(request)).success).toBe(false);
  });

  it('requires mutation revisions and idempotency while keeping local jobs nonbillable', () => {
    const baseEnvelopeActions = new Set([
      'monitor.preview',
      'connection.audit.list',
      'export.preview',
      'import.preview',
      'budget.preview',
      'navigation.open',
    ]);
    for (const [action, request] of remainingActions) {
      if (baseEnvelopeActions.has(action)) continue;
      expect(
        actionRequestSchema.safeParse({ ...request, expectedRevision: undefined }).success,
      ).toBe(false);
      expect(actionRequestSchema.safeParse({ ...request, idempotencyKey: undefined }).success).toBe(
        false,
      );
    }
    for (const [action, request] of remainingActions) {
      if (
        ![
          'export.create',
          'import.apply',
          'backup.create',
          'backup.restore',
          'vault.relocate',
          'record.purge',
        ].includes(action)
      )
        continue;
      expect(actionRequestSchema.safeParse({ ...request, policyRef: 'policy_1' }).success).toBe(
        false,
      );
      expect(actionRequestSchema.safeParse({ ...request, budgetRef: 'budget_1' }).success).toBe(
        false,
      );
    }
  });

  it('requires service-issued approvals for human-only additions', () => {
    const humanOnlyActions = new Set([
      'company.merge',
      'observation.correct',
      'observation.confirm',
      'monitor.enable',
      'connection.grant',
      'connection.revoke',
      'export.create',
      'import.apply',
      'backup.restore',
      'vault.relocate',
      'record.trash',
      'record.restore',
      'record.purge',
      'provider.configure',
      'provider.test.start',
      'provider.remove',
      'budget.approve',
      'navigation.open',
    ]);
    for (const [action, request] of remainingActions) {
      if (!humanOnlyActions.has(action)) continue;
      expect(
        actionRequestSchema.safeParse({
          ...request,
          input: { ...request.input, approvalRef: undefined },
        }).success,
      ).toBe(false);
    }
  });

  it('keeps reads on the base envelope and does not let a connection grant use wildcards', () => {
    const reads = new Set([
      'monitor.preview',
      'connection.audit.list',
      'export.preview',
      'import.preview',
      'budget.preview',
    ]);
    for (const [action, request] of remainingActions) {
      if (!reads.has(action)) continue;
      for (const field of [
        'idempotencyKey',
        'expectedRevision',
        'policyRef',
        'budgetRef',
        'force',
      ]) {
        expect(actionRequestSchema.safeParse({ ...request, [field]: 'unexpected' }).success).toBe(
          false,
        );
      }
    }
    const grant = remainingRequest('connection.grant');
    expect(
      actionRequestSchema.safeParse({
        ...grant,
        input: { ...grant.input, actions: ['company.get', 'company.research.start'] },
      }).success,
    ).toBe(false);
  });

  it('requires both merge revisions and the observed revision for human verification', () => {
    const merge = remainingRequest('company.merge');
    const confirm = remainingRequest('observation.confirm');
    expect(
      actionRequestSchema.safeParse({
        ...merge,
        input: { ...merge.input, mergeCompanyRevision: undefined },
      }).success,
    ).toBe(false);
    expect(actionRequestSchema.safeParse({ ...confirm, expectedRevision: undefined }).success).toBe(
      false,
    );
    expect(
      actionRequestSchema.safeParse({
        ...confirm,
        input: { ...confirm.input, user_verified: true },
      }).success,
    ).toBe(false);
  });

  it('requires policy and budget refs only when a connection grant permits jobs', () => {
    const grant = remainingRequest('connection.grant');
    const jobGrant = {
      ...grant,
      input: {
        ...grant.input,
        actions: ['company.research.start'],
        policyRef: 'policy_1',
        budgetRef: 'budget_1',
      },
    };
    expect(actionRequestSchema.safeParse(jobGrant).success).toBe(true);
    expect(
      actionRequestSchema.safeParse({
        ...jobGrant,
        input: { ...jobGrant.input, budgetRef: undefined },
      }).success,
    ).toBe(false);
  });

  it('permits selected cached search, comparison and run status grants', () => {
    const grant = remainingRequest('connection.grant');
    expect(
      actionRequestSchema.safeParse({
        ...grant,
        input: {
          ...grant.input,
          actions: ['library.search', 'comparison.get', 'run.get', 'run.events.list'],
        },
      }).success,
    ).toBe(true);
    expect(
      actionRequestSchema.safeParse({
        ...grant,
        input: { ...grant.input, actions: ['observation.confirm'] },
      }).success,
    ).toBe(false);
  });

  it('requires local endpoint permission and keeps provider secrets behind opaque handles', () => {
    const provider = remainingRequest('provider.configure');
    const localEndpoint = {
      ...provider,
      input: {
        ...provider.input,
        endpoint: 'http://127.0.0.1:11434/v1',
        localEndpointPermission: { acknowledged: true, policyRef: 'local_policy_1' },
      },
    };
    expect(actionRequestSchema.safeParse(localEndpoint).success).toBe(true);
    expect(
      actionRequestSchema.safeParse({
        ...localEndpoint,
        input: { ...localEndpoint.input, localEndpointPermission: undefined },
      }).success,
    ).toBe(false);
    for (const endpoint of ['not a URL', 'https://api.example.com/v1?key=raw-secret']) {
      expect(
        actionRequestSchema.safeParse({
          ...provider,
          input: { ...provider.input, endpoint },
        }).success,
      ).toBe(false);
    }
    expect(
      actionRequestSchema.safeParse({
        ...provider,
        input: { ...provider.input, secretInputRef: 'C:\\secrets\\provider-key.txt' },
      }).success,
    ).toBe(false);
    expect(
      actionRequestSchema.safeParse({
        ...provider,
        input: { ...provider.input, apiKey: 'raw-secret' },
      }).success,
    ).toBe(false);
  });

  it('keeps grant expiry, response size, IDs, and field selections finite', () => {
    const grant = remainingRequest('connection.grant');
    for (const input of [
      { ...grant.input, expiresInHours: 721 },
      { ...grant.input, maxResponseBytes: 1_000_001 },
      {
        ...grant.input,
        records: Array.from({ length: 21 }, (_, index) => ({
          kind: 'company',
          companyId: `co_${index}`,
          revision: 1,
        })),
      },
      { ...grant.input, fields: ['identity', '*'] },
    ]) {
      expect(actionRequestSchema.safeParse({ ...grant, input }).success).toBe(false);
    }
  });

  it('does not confuse public domain prefixes with private IPv6 endpoints', () => {
    const provider = remainingRequest('provider.configure');
    for (const endpoint of ['https://fcm.example.com/v1', 'https://fd.example.com/v1']) {
      expect(
        actionRequestSchema.safeParse({ ...provider, input: { ...provider.input, endpoint } })
          .success,
      ).toBe(true);
    }
  });

  it('rejects non-finite corrected observations', () => {
    const correction = remainingRequest('observation.correct');
    for (const correctedValue of [Infinity, -Infinity, NaN]) {
      expect(
        actionRequestSchema.safeParse({
          ...correction,
          input: { ...correction.input, status: 'supported', correctedValue },
        }).success,
      ).toBe(false);
    }
  });

  it('keeps provider tests paid, approved, and strictly bounded', () => {
    const providerTest = remainingRequest('provider.test.start');
    expect(actionRequestSchema.safeParse({ ...providerTest, policyRef: undefined }).success).toBe(
      false,
    );
    expect(actionRequestSchema.safeParse({ ...providerTest, budgetRef: undefined }).success).toBe(
      false,
    );
    expect(
      actionRequestSchema.safeParse({
        ...providerTest,
        input: {
          ...providerTest.input,
          limits: {
            ...(providerTest.input.limits as Record<string, unknown>),
            maxOutputTokens: 8001,
          },
        },
      }).success,
    ).toBe(false);
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
