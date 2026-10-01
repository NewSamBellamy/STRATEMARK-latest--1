import { z } from 'zod';
import { cardTypeSchema, maturityTierSchema } from './schemas';

type ActionDefinition = {
  readonly id: string;
  readonly effect: 'read' | 'write' | 'job' | 'local';
  readonly billable: boolean;
  readonly scope: 'research:read' | 'research:write' | 'research:run' | 'monitor:manage' | 'local';
  readonly external: 'scoped' | 'optional' | 'human-approved' | 'reduce-only' | 'never';
  readonly humanOnly: boolean;
};

const define = (
  id: string,
  effect: ActionDefinition['effect'],
  scope: ActionDefinition['scope'],
  external: ActionDefinition['external'] = 'scoped',
  humanOnly = false,
  billable = effect === 'job',
): ActionDefinition => Object.freeze({ id, effect, scope, external, humanOnly, billable });

/** Catalogue ceilings are NOT grants. Trusted service authorization is still required. */
export const ACTION_DEFINITIONS = Object.freeze({
  'library.search': define('A01', 'read', 'research:read'),
  'market.list': define('A02', 'read', 'research:read'),
  'market.get': define('A03', 'read', 'research:read'),
  'company.get': define('A04', 'read', 'research:read'),
  'evidence.get': define('A05', 'read', 'research:read'),
  'scope.preview': define('A06', 'read', 'research:read', 'optional'),
  'scope.assist.start': define('A07', 'job', 'research:run'),
  'market.create': define('A08', 'write', 'research:write'),
  'market.scope.update': define('A09', 'write', 'research:write'),
  'company.resolve': define('A10', 'read', 'research:read'),
  'company.merge': define('A11', 'write', 'local', 'never', true),
  'membership.update': define('A12', 'write', 'research:write'),
  'saved.update': define('A13', 'write', 'research:write'),
  'market.research.start': define('A14', 'job', 'research:run'),
  'market.discovery.expand': define('A15', 'job', 'research:run'),
  'company.research.start': define('A16', 'job', 'research:run'),
  'finding.research.start': define('A17', 'job', 'research:run'),
  'answer.from_library.start': define('A18', 'job', 'research:run'),
  'answer.research.start': define('A19', 'job', 'research:run'),
  'comparison.get': define('A20', 'read', 'research:read'),
  'comparison.explain.start': define('A21', 'job', 'research:run'),
  'report.create.start': define('A22', 'job', 'research:run'),
  'report.get': define('A23', 'read', 'research:read'),
  'evidence.check.start': define('A24', 'job', 'research:run'),
  'observation.correct': define('A25', 'write', 'local', 'never', true),
  'observation.confirm': define('A26', 'write', 'local', 'never', true),
  'run.get': define('A27', 'read', 'research:read'),
  'run.events.list': define('A28', 'read', 'research:read'),
  'run.pause': define('A29', 'write', 'research:run'),
  'run.resume': define('A30', 'job', 'research:run'),
  'run.cancel': define('A31', 'write', 'research:run'),
  'run.retry': define('A32', 'job', 'research:run'),
  'updates.list': define('A33', 'read', 'research:read'),
  'updates.check.start': define('A34', 'job', 'research:run'),
  'monitor.preview': define('A35', 'read', 'research:read', 'optional'),
  'monitor.enable': define('A36', 'write', 'monitor:manage', 'human-approved', true),
  'monitor.update': define('A37', 'write', 'monitor:manage', 'reduce-only'),
  'monitor.disable': define('A38', 'write', 'monitor:manage'),
  'connection.grant': define('A39', 'write', 'local', 'never', true),
  'connection.revoke': define('A40', 'write', 'local', 'never', true),
  'connection.audit.list': define('A41', 'read', 'local', 'never'),
  'export.preview': define('A42', 'read', 'local', 'never'),
  'export.create': define('A43', 'job', 'local', 'never', true, false),
  'import.preview': define('A44', 'read', 'local', 'never'),
  'import.apply': define('A45', 'job', 'local', 'never', true, false),
  'backup.create': define('A46', 'job', 'local', 'never', false, false),
  'backup.restore': define('A47', 'job', 'local', 'never', true, false),
  'vault.relocate': define('A48', 'job', 'local', 'never', true, false),
  'record.trash': define('A49', 'write', 'local', 'never', true),
  'record.restore': define('A50', 'write', 'local', 'never', true),
  'record.purge': define('A51', 'job', 'local', 'never', true, false),
  'provider.status': define('A52', 'read', 'local', 'never'),
  'provider.configure': define('A53', 'write', 'local', 'never', true),
  'provider.test.start': define('A54', 'job', 'local', 'never', true),
  'provider.remove': define('A55', 'write', 'local', 'never', true),
  'budget.preview': define('A56', 'read', 'local', 'never'),
  'budget.approve': define('A57', 'write', 'local', 'never', true),
  'budget.restrict': define('A58', 'write', 'research:run', 'reduce-only'),
  'budget.get': define('A59', 'read', 'research:read'),
  'preferences.update': define('A60', 'write', 'local', 'never'),
  'vault.status': define('A61', 'read', 'local', 'never'),
  'navigation.open': define('A62', 'local', 'local', 'never', true),
});

export type ActionName = keyof typeof ACTION_DEFINITIONS;

const grantableNames = (Object.keys(ACTION_DEFINITIONS) as ActionName[]).filter((action) => {
  const definition = ACTION_DEFINITIONS[action];
  return definition.external !== 'never' && !definition.humanOnly;
}) as [ActionName, ...ActionName[]];
export const grantableActionSchema = z.enum(grantableNames);
export const grantedActionsSchema = z
  .array(grantableActionSchema)
  .min(1)
  .max(grantableNames.length)
  .refine((actions) => new Set(actions).size === actions.length, 'Granted actions must be unique');

// Opaque record IDs, never a filesystem path, URL, credential, or authority claim.
const recordId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const emptyInput = z.object({}).strict();
const marketTarget = z.object({ marketId: recordId }).strict();
const companyTarget = z.object({ companyId: recordId, marketId: recordId.optional() }).strict();
const runTarget = z.object({ runId: recordId }).strict();
const base = {
  contractVersion: z.literal('1'),
  requestId: recordId,
  vaultId: recordId,
};
const mutation = {
  ...base,
  idempotencyKey: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
  expectedRevision: revision,
};
const paid = { ...mutation, policyRef: recordId, budgetRef: recordId };

export const companySectionSchema = z.enum([
  'overview',
  'products',
  'metrics',
  'updates',
  'evidence',
]);
const sections = z
  .array(companySectionSchema)
  .min(1)
  .max(5)
  .refine((values) => new Set(values).size === values.length, 'Sections must be unique');
const snapshotInput = z.object({ revision: revision.optional() }).strict();

const companyResearchRequest = z
  .object({
    ...paid,
    action: z.literal('company.research.start'),
    target: companyTarget,
    input: z.object({ sections, mode: z.enum(['fill_gaps', 'refresh']) }).strict(),
  })
  .strict();
const marketResearchRequest = z
  .object({
    ...paid,
    action: z.literal('market.research.start'),
    target: marketTarget,
    input: z
      .object({
        scopeRevision: revision,
        depth: z.enum(['quick', 'standard', 'deep']),
        seedCompanyIds: z
          .array(recordId)
          .max(50)
          .refine((ids) => new Set(ids).size === ids.length, 'Seeds must be unique'),
        maxCompanies: z.number().int().min(1).max(50),
        maxSearchBatches: z.number().int().min(1).max(50),
      })
      .strict(),
  })
  .strict();
const companyReadRequest = z
  .object({
    ...base,
    action: z.literal('company.get'),
    target: companyTarget,
    input: snapshotInput.extend({ section: companySectionSchema.optional() }).strict(),
  })
  .strict();
const marketReadRequest = z
  .object({
    ...base,
    action: z.literal('market.get'),
    target: marketTarget,
    input: snapshotInput,
  })
  .strict();
const runReadRequest = z
  .object({
    ...base,
    action: z.literal('run.get'),
    target: runTarget,
    input: snapshotInput,
  })
  .strict();
const runEventsRequest = z
  .object({
    ...base,
    action: z.literal('run.events.list'),
    target: runTarget,
    input: z
      .object({ cursor: recordId.optional(), limit: z.number().int().min(1).max(100) })
      .strict(),
  })
  .strict();
const pauseRequest = z
  .object({
    ...mutation,
    action: z.literal('run.pause'),
    target: runTarget,
    input: emptyInput,
  })
  .strict();
const cancelRequest = z
  .object({
    ...mutation,
    action: z.literal('run.cancel'),
    target: runTarget,
    input: emptyInput,
  })
  .strict();
const resumeRequest = z
  .object({
    ...paid,
    action: z.literal('run.resume'),
    target: runTarget,
    input: emptyInput,
  })
  .strict();

function cachedRead<N extends ActionName, T extends z.ZodTypeAny, I extends z.ZodTypeAny>(
  action: N,
  target: T,
  input: I,
) {
  return z.object({ ...base, action: z.literal(action), target, input }).strict();
}

const pagination = {
  cursor: recordId.optional(),
  limit: z.number().int().min(1).max(100),
};
const uniqueIds = (min: number, max: number) =>
  z
    .array(recordId)
    .min(min)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, 'IDs must be unique');
const boundedText = z.string().trim().min(1).max(500);
const uniqueTexts = (max: number) =>
  z
    .array(z.string().trim().min(1).max(240))
    .max(max)
    .refine(
      (values) => new Set(values.map((value) => value.toLowerCase())).size === values.length,
      'Values must be unique',
    );
const domainHint = z
  .string()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/i);
export const scopeDraftSchema = z
  .object({
    goal: boundedText,
    inclusions: uniqueTexts(50),
    exclusions: uniqueTexts(50),
    region: z.string().trim().min(1).max(160).nullable(),
    depth: z.enum(['quick', 'standard', 'deep']),
    seeds: z
      .array(
        z
          .object({
            companyId: recordId.optional(),
            name: z.string().trim().min(1).max(160).optional(),
            domain: domainHint.optional(),
          })
          .strict()
          .refine(
            (seed) =>
              seed.companyId !== undefined || seed.name !== undefined || seed.domain !== undefined,
            'A seed needs an ID, name, or domain hint',
          ),
      )
      .max(50)
      .refine((seeds) => {
        // Equal names are not identity proof: retain ambiguous distinct hints.
        const keys = seeds.map((seed) =>
          JSON.stringify([
            seed.companyId ?? null,
            seed.name?.toLowerCase() ?? null,
            seed.domain?.toLowerCase() ?? null,
          ]),
        );
        return new Set(keys).size === keys.length;
      }, 'Exact duplicate seeds are not allowed'),
  })
  .strict();

export const selectedTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('market'), marketId: recordId, revision }).strict(),
  z
    .object({
      kind: z.literal('company'),
      companyId: recordId,
      marketId: recordId.optional(),
      revision,
    })
    .strict(),
  z.object({ kind: z.literal('finding'), findingId: recordId, revision }).strict(),
  z.object({ kind: z.literal('report'), reportId: recordId, revision }).strict(),
  z.object({ kind: z.literal('answer'), answerId: recordId, revision }).strict(),
  z.object({ kind: z.literal('comparison'), comparisonId: recordId, revision }).strict(),
]);
const selectedTargetId = (target: z.infer<typeof selectedTargetSchema>): string => {
  switch (target.kind) {
    case 'market':
      return target.marketId;
    case 'company':
      return target.companyId;
    case 'finding':
      return target.findingId;
    case 'report':
      return target.reportId;
    case 'answer':
      return target.answerId;
    case 'comparison':
      return target.comparisonId;
  }
};
export const selectedTargetsSchema = z
  .array(selectedTargetSchema)
  .min(1)
  .max(20)
  .refine(
    (targets) =>
      new Set(targets.map((target) => `${target.kind}:${selectedTargetId(target)}`)).size ===
      targets.length,
    'Selected targets must be unique',
  );
const companyRevisionTargetsSchema = z
  .array(z.object({ companyId: recordId, revision }).strict())
  .min(1)
  .max(50)
  .refine(
    (companies) => new Set(companies.map((company) => company.companyId)).size === companies.length,
    'Companies must be unique',
  );
const librarySearchRequest = cachedRead(
  'library.search',
  emptyInput,
  z
    .object({
      query: z.string().trim().min(1).max(500),
      kinds: z
        .array(z.enum(['market', 'company', 'finding', 'report']))
        .min(1)
        .max(4)
        .refine((kinds) => new Set(kinds).size === kinds.length, 'Kinds must be unique')
        .optional(),
      marketIds: uniqueIds(1, 50).optional(),
      savedOnly: z.boolean().optional(),
      ...pagination,
    })
    .strict(),
);
const marketListRequest = cachedRead(
  'market.list',
  emptyInput,
  z
    .object({
      savedOnly: z.boolean().optional(),
      ...pagination,
    })
    .strict(),
);
const evidenceReadRequest = cachedRead(
  'evidence.get',
  z.union([
    z.object({ claimId: recordId }).strict(),
    z.object({ sourceId: recordId }).strict(),
    z.object({ passageId: recordId }).strict(),
  ]),
  snapshotInput,
);
const resolveCompanyRequest = cachedRead(
  'company.resolve',
  emptyInput,
  z
    .object({
      names: z.array(z.string().trim().min(1).max(160)).max(20),
      // Identity hints are hostnames, not outbound URLs; this read never resolves DNS.
      domains: z
        .array(
          z
            .string()
            .max(253)
            .regex(
              /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/i,
            ),
        )
        .max(20),
      context: z.string().trim().min(1).max(500).optional(),
    })
    .strict()
    .refine(
      (input) => input.names.length + input.domains.length > 0,
      'At least one name or domain is required',
    ),
);
const comparisonReadRequest = cachedRead(
  'comparison.get',
  z.object({ companyIds: uniqueIds(2, 6) }).strict(),
  snapshotInput.extend({ metricProfileId: recordId.optional() }).strict(),
);
const reportReadRequest = cachedRead(
  'report.get',
  z.object({ reportId: recordId }).strict(),
  snapshotInput,
);
const updatesReadRequest = cachedRead(
  'updates.list',
  z.union([z.object({ companyId: recordId }).strict(), marketTarget]),
  z.object({ since: z.string().datetime({ offset: true }).optional(), ...pagination }).strict(),
);
const providerStatusRequest = cachedRead(
  'provider.status',
  z.object({ connectionId: recordId }).strict(),
  emptyInput,
);
const budgetReadRequest = cachedRead(
  'budget.get',
  z.object({ budgetId: recordId }).strict(),
  snapshotInput,
);
const vaultStatusRequest = cachedRead('vault.status', emptyInput, emptyInput);
const scopePreviewRequest = cachedRead('scope.preview', emptyInput, scopeDraftSchema);
const scopeAssistRequest = z
  .object({
    ...paid,
    action: z.literal('scope.assist.start'),
    target: emptyInput,
    input: scopeDraftSchema,
  })
  .strict();
const marketCreateRequest = z
  .object({
    ...mutation,
    action: z.literal('market.create'),
    target: emptyInput,
    input: scopeDraftSchema,
  })
  .strict();
const marketScopeUpdateRequest = z
  .object({
    ...mutation,
    action: z.literal('market.scope.update'),
    target: marketTarget,
    input: scopeDraftSchema,
  })
  .strict();
const membershipFitSchema = z.discriminatedUnion('basis', [
  z
    .object({
      basis: z.literal('evidence'),
      evidenceIds: uniqueIds(1, 20),
      reason: boundedText,
    })
    .strict(),
  z
    .object({
      basis: z.literal('human_judgment'),
      label: z.literal('Human judgment'),
      reason: boundedText,
    })
    .strict(),
]);
const membershipUpdateRequest = z
  .object({
    ...mutation,
    action: z.literal('membership.update'),
    target: z.object({ companyId: recordId, marketId: recordId }).strict(),
    input: z
      .object({
        // The envelope expectedRevision is the market precondition; this is the company precondition.
        companyRevision: revision,
        roles: z
          .array(z.enum(['company', 'infrastructure', 'distribution']))
          .min(1)
          .max(3)
          .refine((roles) => new Set(roles).size === roles.length, 'Roles must be unique'),
        fit: membershipFitSchema,
      })
      .strict(),
  })
  .strict();
const savedTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('market'), marketId: recordId }).strict(),
  z.object({ kind: z.literal('company'), companyId: recordId }).strict(),
  z.object({ kind: z.literal('finding'), findingId: recordId }).strict(),
  z.object({ kind: z.literal('report'), reportId: recordId }).strict(),
]);
const savedUpdateRequest = z
  .object({
    ...mutation,
    action: z.literal('saved.update'),
    target: savedTargetSchema,
    input: z.object({ saved: z.boolean() }).strict(),
  })
  .strict();
const marketDiscoveryExpandRequest = z
  .object({
    ...paid,
    action: z.literal('market.discovery.expand'),
    target: marketTarget,
    input: z
      .object({
        scopeRevision: revision,
        focus: z
          .object({
            tier: maturityTierSchema.optional(),
            cardType: cardTypeSchema.optional(),
          })
          .strict(),
        exclusions: uniqueTexts(50),
        maxCompanies: z.number().int().min(1).max(50),
        maxSearchBatches: z.number().int().min(1).max(50),
      })
      .strict(),
  })
  .strict();
const findingResearchRequest = z
  .object({
    ...paid,
    action: z.literal('finding.research.start'),
    target: marketTarget,
    input: z
      .object({
        scopeRevision: revision,
        kind: z.enum(['trend', 'culture', 'barrier', 'risk']),
        focus: boundedText.optional(),
        maxSearchBatches: z.number().int().min(1).max(10),
      })
      .strict(),
  })
  .strict();
const answerFromLibraryRequest = z
  .object({
    ...paid,
    action: z.literal('answer.from_library.start'),
    target: emptyInput,
    input: z
      .object({
        question: boundedText,
        targets: selectedTargetsSchema,
        maxEvidence: z.number().int().min(1).max(50),
      })
      .strict(),
  })
  .strict();
const webExpansionSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z
    .object({
      enabled: z.literal(true),
      maxSearchBatches: z.number().int().min(1).max(10),
      maxResultsPerBatch: z.number().int().min(1).max(20),
    })
    .strict(),
]);
const answerResearchRequest = z
  .object({
    ...paid,
    action: z.literal('answer.research.start'),
    target: emptyInput,
    input: z
      .object({
        question: boundedText,
        targets: selectedTargetsSchema,
        maxEvidence: z.number().int().min(1).max(50),
        webExpansion: webExpansionSchema,
      })
      .strict(),
  })
  .strict();
const comparisonWeightsSchema = z
  .array(z.object({ criterion: boundedText, weight: z.number().min(0).max(1) }).strict())
  .min(1)
  .max(12)
  .refine(
    (weights) =>
      new Set(weights.map(({ criterion }) => criterion.toLowerCase())).size === weights.length,
    'Weight criteria must be unique',
  )
  .refine(
    (weights) => Math.abs(weights.reduce((total, { weight }) => total + weight, 0) - 1) < 1e-6,
    'Weights must sum to one',
  );
const comparisonExplainRequest = z
  .object({
    ...paid,
    action: z.literal('comparison.explain.start'),
    target: emptyInput,
    input: z
      .object({
        companies: z
          .array(z.object({ companyId: recordId, revision }).strict())
          .min(2)
          .max(6)
          .refine(
            (companies) =>
              new Set(companies.map((company) => company.companyId)).size === companies.length,
            'Companies must be unique',
          ),
        goal: boundedText,
        weights: comparisonWeightsSchema.optional(),
      })
      .strict(),
  })
  .strict();
const reportCreateRequest = z
  .object({
    ...paid,
    action: z.literal('report.create.start'),
    target: emptyInput,
    input: z
      .object({
        targets: selectedTargetsSchema,
        templateId: recordId,
        templateVersion: z.string().trim().min(1).max(64),
      })
      .strict(),
  })
  .strict();
const evidenceCheckItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('claim'), claimId: recordId, revision }).strict(),
  z.object({ kind: z.literal('observation'), observationId: recordId, revision }).strict(),
]);
const retrievalScopeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('library_only') }).strict(),
  z
    .object({
      mode: z.literal('approved_web'),
      maxSearchBatches: z.number().int().min(1).max(10),
    })
    .strict(),
]);
const evidenceCheckRequest = z
  .object({
    ...paid,
    action: z.literal('evidence.check.start'),
    target: emptyInput,
    input: z
      .object({
        items: z.array(evidenceCheckItemSchema).min(1).max(50),
        retrievalScope: retrievalScopeSchema,
      })
      .strict()
      .refine(
        ({ items }) =>
          new Set(
            items.map(
              (item) => `${item.kind}:${item.kind === 'claim' ? item.claimId : item.observationId}`,
            ),
          ).size === items.length,
        'Evidence check items must be unique',
      ),
  })
  .strict();
const retryRequest = z
  .object({
    ...paid,
    action: z.literal('run.retry'),
    target: runTarget,
    input: z
      .object({
        selection: z.literal('failed_tasks'),
        tasks: z
          .array(z.object({ taskId: recordId, revision }).strict())
          .min(1)
          .max(20)
          .refine(
            (tasks) => new Set(tasks.map((task) => task.taskId)).size === tasks.length,
            'Retry tasks must be unique',
          ),
        maxAttempts: z.literal(1),
      })
      .strict(),
  })
  .strict();
const updatesCheckRequest = z
  .object({
    ...paid,
    action: z.literal('updates.check.start'),
    target: emptyInput,
    input: z
      .object({
        companies: companyRevisionTargetsSchema,
        focus: boundedText,
        maxSearchBatches: z.number().int().min(1).max(10),
      })
      .strict(),
  })
  .strict();

const sha256Hash = z.string().regex(/^[a-f0-9]{64}$/);
const approvalRef = recordId;
const mutationCommand = <N extends ActionName, T extends z.ZodTypeAny, I extends z.ZodTypeAny>(
  action: N,
  target: T,
  input: I,
) => z.object({ ...mutation, action: z.literal(action), target, input }).strict();
const cadenceSchema = z.enum(['daily', 'weekly']);
const monitorLimitsSchema = z
  .object({
    maxRequestsPerTick: z.number().int().min(1).max(100),
    maxInputTokensPerRequest: z.number().int().min(1).max(200_000),
    maxOutputTokensPerRequest: z.number().int().min(1).max(100_000),
    currencyLimit: z
      .object({
        currency: z.string().regex(/^[A-Z]{3}$/),
        amountMinor: z.number().int().min(1).max(1_000_000),
      })
      .strict(),
  })
  .strict();

const companyMergeRequest = mutationCommand(
  // expectedRevision guards the surviving company; mergeCompanyRevision guards the merged record.
  'company.merge',
  z
    .object({ companyId: recordId, mergeCompanyId: recordId })
    .strict()
    .refine((target) => target.companyId !== target.mergeCompanyId, {
      message: 'Companies to merge must be distinct',
      path: ['mergeCompanyId'],
    }),
  z
    .object({
      mergeCompanyRevision: revision,
      reviewedEvidenceIds: uniqueIds(1, 20),
      approvalRef,
    })
    .strict(),
);

const observationCorrectionRequest = mutationCommand(
  'observation.correct',
  z.object({ observationId: recordId }).strict(),
  z
    .object({
      correctedValue: z.union([z.number().finite(), z.string().trim().min(1).max(500), z.null()]),
      status: z.enum(['supported', 'unknown', 'rejected']),
      reason: boundedText,
      supportIds: uniqueIds(1, 20).optional(),
      approvalRef,
    })
    .strict()
    .refine(
      ({ correctedValue, status }) =>
        status === 'supported' ? correctedValue !== null : correctedValue === null,
      'Unknown and rejected corrections must carry a null value',
    ),
);
// The envelope expectedRevision is the observation revision bound by the approval challenge.
const observationConfirmRequest = mutationCommand(
  'observation.confirm',
  z.object({ observationId: recordId }).strict(),
  z.object({ supportIds: uniqueIds(1, 20), reason: boundedText, approvalRef }).strict(),
);

const monitorPreviewRequest = cachedRead(
  'monitor.preview',
  emptyInput,
  z
    .object({
      companies: companyRevisionTargetsSchema,
      cadence: cadenceSchema,
      limits: monitorLimitsSchema,
    })
    .strict(),
);
const monitorEnableRequest = mutationCommand(
  'monitor.enable',
  emptyInput,
  z
    .object({
      proposalId: recordId,
      proposalHash: sha256Hash,
      policyRef: recordId,
      budgetRef: recordId,
      approvalRef,
    })
    .strict(),
);
// These finite edit bounds do not prove a reduction. The service must compare the request with
// persisted schedule policy and require fresh human approval for any increase or scope expansion.
const monitorUpdateRequest = mutationCommand(
  'monitor.update',
  z.object({ scheduleId: recordId }).strict(),
  z
    .object({
      changes: z
        .object({
          companies: companyRevisionTargetsSchema.optional(),
          cadence: cadenceSchema.optional(),
          limits: monitorLimitsSchema.optional(),
        })
        .strict()
        .refine((changes) => Object.values(changes).some((value) => value !== undefined)),
      approvalRef: approvalRef.optional(),
    })
    .strict(),
);
const monitorDisableRequest = mutationCommand(
  'monitor.disable',
  z.object({ scheduleId: recordId }).strict(),
  z.object({ activeRunHandling: z.enum(['allow_finish', 'cancel']) }).strict(),
);

const connectionGrantRequest = mutationCommand(
  'connection.grant',
  emptyInput,
  z
    .object({
      // The trusted service must match this handle to the authenticated client; it is not identity.
      clientBindingRef: recordId,
      records: selectedTargetsSchema,
      actions: grantedActionsSchema,
      fields: z
        .array(
          z.enum([
            'identity',
            'overview',
            'metrics',
            'observations',
            'evidence',
            'sources',
            'updates',
            'findings',
            'reports',
            'freshness',
          ]),
        )
        .min(1)
        .max(10)
        .refine((fields) => new Set(fields).size === fields.length),
      maxResponseBytes: z.number().int().min(1).max(1_000_000),
      expiresInHours: z.number().int().min(1).max(720),
      policyRef: recordId.optional(),
      budgetRef: recordId.optional(),
      approvalRef,
    })
    .strict()
    .superRefine((input, context) => {
      const permitsJobs = input.actions.some((action) => ACTION_DEFINITIONS[action].billable);
      if (permitsJobs && (!input.policyRef || !input.budgetRef)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Job grants require policy and budget references',
        });
      }
      if (!permitsJobs && (input.policyRef || input.budgetRef)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Read-only grants cannot carry job authority',
        });
      }
    }),
);
const connectionRevokeRequest = mutationCommand(
  'connection.revoke',
  z.object({ grantId: recordId }).strict(),
  z.object({ approvalRef }).strict(),
);
const connectionAuditRequest = cachedRead(
  'connection.audit.list',
  z.object({ grantId: recordId }).strict(),
  z.object(pagination).strict(),
);

const exportPreviewRequest = cachedRead(
  'export.preview',
  emptyInput,
  z
    .object({
      targets: selectedTargetsSchema,
      format: z.enum(['json', 'markdown', 'csv']),
      evidenceDepth: z.enum(['none', 'summary', 'supporting']),
    })
    .strict(),
);
const exportCreateRequest = mutationCommand(
  'export.create',
  emptyInput,
  z
    .object({
      previewId: recordId,
      previewHash: sha256Hash,
      saveDialogRef: recordId,
      approvalRef,
    })
    .strict(),
);
const importPreviewRequest = cachedRead(
  'import.preview',
  emptyInput,
  z.object({ openDialogRef: recordId }).strict(),
);
const importApplyRequest = mutationCommand(
  'import.apply',
  emptyInput,
  z.object({ previewId: recordId, previewHash: sha256Hash, approvalRef }).strict(),
);
const backupCreateRequest = mutationCommand(
  'backup.create',
  emptyInput,
  z.object({ retentionDays: z.number().int().min(1).max(3650) }).strict(),
);
const backupRestoreRequest = mutationCommand(
  'backup.restore',
  emptyInput,
  z.object({ backupHandle: recordId, backupHash: sha256Hash, approvalRef }).strict(),
);
const vaultRelocateRequest = mutationCommand(
  'vault.relocate',
  emptyInput,
  z.object({ directoryDialogRef: recordId, approvalRef }).strict(),
);

const recordTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('market'), marketId: recordId }).strict(),
  z.object({ kind: z.literal('company'), companyId: recordId }).strict(),
  z.object({ kind: z.literal('finding'), findingId: recordId }).strict(),
  z.object({ kind: z.literal('report'), reportId: recordId }).strict(),
  z.object({ kind: z.literal('answer'), answerId: recordId }).strict(),
  z.object({ kind: z.literal('comparison'), comparisonId: recordId }).strict(),
  z.object({ kind: z.literal('claim'), claimId: recordId }).strict(),
  z.object({ kind: z.literal('observation'), observationId: recordId }).strict(),
  z.object({ kind: z.literal('source'), sourceId: recordId }).strict(),
  z.object({ kind: z.literal('passage'), passageId: recordId }).strict(),
]);
const recordTrashRequest = mutationCommand(
  'record.trash',
  recordTargetSchema,
  z.object({ impactPreviewId: recordId, impactPreviewHash: sha256Hash, approvalRef }).strict(),
);
const recordRestoreRequest = mutationCommand(
  'record.restore',
  z.object({ tombstoneId: recordId }).strict(),
  z.object({ approvalRef }).strict(),
);
const recordPurgeRequest = mutationCommand(
  'record.purge',
  z.object({ tombstoneId: recordId }).strict(),
  z.object({ confirmationPhrase: z.literal('PURGE'), approvalRef }).strict(),
);

export const providerCapabilitySchema = z.enum(['model', 'search', 'extraction', 'embedding']);
const providerCapabilitiesSchema = z
  .array(providerCapabilitySchema)
  .min(1)
  .max(4)
  .refine((capabilities) => new Set(capabilities).size === capabilities.length);
const providerEndpointSchema = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    try {
      const endpoint = new URL(value);
      const hasEmbeddedCredential = [...endpoint.searchParams.keys()].some((key) =>
        /^(?:key|api[-_]?key|token|access[-_]?token|password|secret|authorization)$/i.test(key),
      );
      return (
        ['http:', 'https:'].includes(endpoint.protocol) &&
        endpoint.username === '' &&
        endpoint.password === '' &&
        endpoint.hash === '' &&
        !hasEmbeddedCredential
      );
    } catch {
      return false;
    }
  }, 'Endpoint must use HTTP(S) and contain no embedded credentials');
const isLocalEndpoint = (value: string): boolean => {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname === '::1' ||
      hostname === '::' ||
      hostname === '0.0.0.0'
    ) {
      return true;
    }
    const octets = hostname.split('.').map(Number);
    if (
      octets.length !== 4 ||
      octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
    ) {
      return (
        !hostname.includes('.') ||
        (hostname.includes(':') &&
          (hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:')))
      );
    }
    const first = octets[0] ?? -1;
    const second = octets[1] ?? -1;
    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    );
  } catch {
    return false;
  }
};
// This recognizes conventional local hosts without DNS; the trusted service must resolve and
// recheck the actual destination before connecting. A permission reference never grants access.
const providerProtocolSchema = z.enum([
  'openai_chat_completions',
  'openai_responses',
  'gemini_native',
]);
const localEndpointPermissionSchema = z
  .object({ acknowledged: z.literal(true), policyRef: recordId })
  .strict();
// A freshly typed secret is represented only by its trusted input handle, never by key material.
const providerConfigureRequest = mutationCommand(
  'provider.configure',
  emptyInput,
  z
    .object({
      endpoint: providerEndpointSchema,
      protocol: providerProtocolSchema,
      capabilities: providerCapabilitiesSchema,
      secretInputRef: recordId,
      localEndpointPermission: localEndpointPermissionSchema.optional(),
      approvalRef,
    })
    .strict()
    .superRefine((input, context) => {
      if (isLocalEndpoint(input.endpoint) && !input.localEndpointPermission) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['localEndpointPermission'],
          message: 'Local endpoints require explicit permission and a policy reference',
        });
      }
    }),
);
const providerTestRequest = z
  .object({
    ...paid,
    action: z.literal('provider.test.start'),
    target: z.object({ connectionId: recordId }).strict(),
    input: z
      .object({
        limits: z
          .object({
            maxRequests: z.number().int().min(1).max(3),
            maxInputTokens: z.number().int().min(1).max(40_000),
            maxOutputTokens: z.number().int().min(1).max(8_000),
          })
          .strict(),
        capabilities: providerCapabilitiesSchema,
        approvalRef,
      })
      .strict(),
  })
  .strict();
const providerRemoveRequest = mutationCommand(
  'provider.remove',
  z.object({ connectionId: recordId }).strict(),
  z.object({ approvalRef }).strict(),
);

const currencyLimitSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    amountMinor: z.number().int().min(1).max(100_000_000_000),
  })
  .strict();
const budgetPreviewRequest = cachedRead(
  'budget.preview',
  emptyInput,
  z
    .object({
      connectionIds: uniqueIds(1, 5),
      targets: selectedTargetsSchema,
      limits: z
        .object({
          maxRequests: z.number().int().min(1).max(100_000),
          maxInputTokens: z.number().int().min(1).max(10_000_000),
          maxOutputTokens: z.number().int().min(1).max(2_000_000),
        })
        .strict(),
      durationDays: z.number().int().min(1).max(365),
      currencyLimit: currencyLimitSchema.optional(),
      priceHandling: z.enum(['reject_unknown', 'allow_unpriced']),
    })
    .strict()
    .refine(
      ({ currencyLimit, priceHandling }) => !currencyLimit || priceHandling === 'reject_unknown',
      'A currency ceiling must reject routes with unknown prices',
    ),
);
const budgetApproveRequest = mutationCommand(
  'budget.approve',
  emptyInput,
  z.object({ proposalId: recordId, proposalHash: sha256Hash, approvalRef }).strict(),
);
// Bounds do not establish that a limit is lower than persisted authority. The service must compare
// every field to the stored budget and authorize any increase separately.
const budgetRestrictRequest = mutationCommand(
  'budget.restrict',
  z.object({ budgetId: recordId }).strict(),
  z
    .object({
      limits: z
        .object({
          maxRequests: z.number().int().min(0).max(100_000).optional(),
          maxInputTokens: z.number().int().min(0).max(10_000_000).optional(),
          maxOutputTokens: z.number().int().min(0).max(2_000_000).optional(),
          maxAmountMinor: z.number().int().min(0).max(100_000_000_000).optional(),
        })
        .strict()
        .refine((limits) => Object.values(limits).some((value) => value !== undefined))
        .optional(),
      stop: z.literal(true).optional(),
      approvalRef: approvalRef.optional(),
    })
    .strict()
    .refine((input) => input.limits !== undefined || input.stop === true),
);
const preferencesUpdateRequest = mutationCommand(
  'preferences.update',
  emptyInput,
  z
    .object({
      viewMode: z.enum(['cards', 'table', 'compact']).optional(),
      sortBy: z.enum(['name', 'freshness', 'updated']).optional(),
      metricProfileId: recordId.optional(),
    })
    .strict()
    .refine((preferences) => Object.values(preferences).some((value) => value !== undefined)),
);

const navigationTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('vault') }).strict(),
  z.object({ kind: z.literal('source'), sourceId: recordId }).strict(),
  z
    .object({
      kind: z.literal('record'),
      recordType: z.enum([
        'market',
        'company',
        'finding',
        'report',
        'answer',
        'comparison',
        'claim',
        'observation',
      ]),
      recordId,
    })
    .strict(),
]);
const navigationOpenRequest = z
  .object({
    ...base,
    action: z.literal('navigation.open'),
    target: navigationTargetSchema,
    input: z.object({ approvalRef }).strict(),
  })
  .strict();

/** Only schema-backed actions parse. Parsing is not authorization or job acceptance. */
export const actionRequestSchema = z.discriminatedUnion('action', [
  companyResearchRequest,
  marketResearchRequest,
  companyReadRequest,
  marketReadRequest,
  runReadRequest,
  runEventsRequest,
  pauseRequest,
  cancelRequest,
  resumeRequest,
  librarySearchRequest,
  marketListRequest,
  evidenceReadRequest,
  resolveCompanyRequest,
  comparisonReadRequest,
  reportReadRequest,
  updatesReadRequest,
  providerStatusRequest,
  budgetReadRequest,
  vaultStatusRequest,
  scopePreviewRequest,
  scopeAssistRequest,
  marketCreateRequest,
  marketScopeUpdateRequest,
  membershipUpdateRequest,
  savedUpdateRequest,
  marketDiscoveryExpandRequest,
  findingResearchRequest,
  answerFromLibraryRequest,
  answerResearchRequest,
  comparisonExplainRequest,
  reportCreateRequest,
  evidenceCheckRequest,
  retryRequest,
  updatesCheckRequest,
  companyMergeRequest,
  observationCorrectionRequest,
  observationConfirmRequest,
  monitorPreviewRequest,
  monitorEnableRequest,
  monitorUpdateRequest,
  monitorDisableRequest,
  connectionGrantRequest,
  connectionRevokeRequest,
  connectionAuditRequest,
  exportPreviewRequest,
  exportCreateRequest,
  importPreviewRequest,
  importApplyRequest,
  backupCreateRequest,
  backupRestoreRequest,
  vaultRelocateRequest,
  recordTrashRequest,
  recordRestoreRequest,
  recordPurgeRequest,
  providerConfigureRequest,
  providerTestRequest,
  providerRemoveRequest,
  budgetPreviewRequest,
  budgetApproveRequest,
  budgetRestrictRequest,
  preferencesUpdateRequest,
  navigationOpenRequest,
]);
export type ActionRequest = z.infer<typeof actionRequestSchema>;
export type SchemaBackedActionName = ActionRequest['action'];

export const researchRunStateSchema = z.enum([
  'queued',
  'running',
  'pausing',
  'paused',
  'cancelling',
  'cancelled',
  'completed',
  'partial',
  'failed',
]);
export type ResearchRunState = z.infer<typeof researchRunStateSchema>;

const nextRunStates: Readonly<Record<ResearchRunState, readonly ResearchRunState[]>> = {
  queued: ['running', 'pausing', 'cancelling', 'failed'],
  running: ['pausing', 'cancelling', 'completed', 'partial', 'failed'],
  pausing: ['paused', 'cancelling', 'failed'],
  paused: ['queued', 'cancelling'],
  cancelling: ['cancelled'],
  cancelled: [],
  completed: [],
  partial: [],
  failed: [],
};

/** Pure lifecycle rule only. Runtime must separately prove quiescence/fencing before acknowledgement. */
export function isResearchRunTransitionAllowed(
  from: ResearchRunState,
  to: ResearchRunState,
): boolean {
  return nextRunStates[from]?.includes(to) ?? false;
}

export const actionErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'NOT_FOUND_OR_NOT_ALLOWED',
  'REVISION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'CONSENT_REQUIRED',
  'BUDGET_REQUIRED',
  'BUDGET_EXCEEDED',
  'PRICE_UNKNOWN',
  'CAPABILITY_UNSUPPORTED',
  'PROVIDER_UNAVAILABLE',
  'RATE_LIMITED',
  'CANCELLED',
  'VAULT_BUSY',
  'STORAGE_FAILURE',
  'MIGRATION_REQUIRED',
  'SCHEMA_TOO_NEW',
]);
const actionNames = Object.keys(ACTION_DEFINITIONS) as [ActionName, ...ActionName[]];

/** UI resolves static, localized copy from code. Never return a provider exception or raw input. */
export const actionFailureSchema = z
  .object({
    contractVersion: z.literal('1'),
    requestId: recordId,
    code: actionErrorCodeSchema,
    retryable: z.boolean(),
    nextAction: z.enum(actionNames).nullable(),
  })
  .strict();
export type ActionFailure = z.infer<typeof actionFailureSchema>;

const receipt = {
  contractVersion: z.literal('1'),
  actionId: recordId,
  requestId: recordId,
  vaultId: recordId,
  acceptedAt: z.string().datetime(),
  resultingRevision: revision,
  status: researchRunStateSchema,
  runId: recordId,
};

/** Caller may expose a receipt only after acceptance has been persisted by the service. */
export const researchActionReceiptSchema = z
  .discriminatedUnion('action', [
    z
      .object({ ...receipt, action: z.literal('company.research.start'), target: companyTarget })
      .strict(),
    z
      .object({ ...receipt, action: z.literal('market.research.start'), target: marketTarget })
      .strict(),
    z.object({ ...receipt, action: z.literal('run.resume'), target: runTarget }).strict(),
  ])
  .refine((value) => !('runId' in value.target) || value.target.runId === value.runId, {
    message: 'Receipt must address its target run',
    path: ['runId'],
  });
export type ResearchActionReceipt = z.infer<typeof researchActionReceiptSchema>;
