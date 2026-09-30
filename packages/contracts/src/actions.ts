import { z } from 'zod';

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
