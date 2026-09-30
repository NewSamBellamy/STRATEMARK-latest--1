import { z } from 'zod';
import {
  actionRequestSchema,
  companySectionSchema,
  providerCapabilitySchema,
  researchRunStateSchema,
  scopeDraftSchema,
  selectedTargetsSchema,
  type ActionName,
} from './actions';
import { retainedEvidenceRefSchema, runOutputManifestSchema } from './action-results';
import {
  evidencePassageRecordSchema,
  numericObservationRecordSchema,
  sourceVersionRecordSchema,
} from './vault-evidence';

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().datetime({ offset: true });
const text = z.string().trim().min(1).max(20_000);
const label = z.string().trim().min(1).max(240);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const refs = z.array(retainedEvidenceRefSchema).max(100);
const gap = z
  .object({
    code: z.enum([
      'missing_evidence',
      'unsupported',
      'incompatible',
      'out_of_scope',
      'provider_failed',
      'budget_stopped',
      'ambiguous_identity',
      'incomplete',
    ]),
    recordId: id.optional(),
  })
  .strict();
const gaps = z.array(gap).max(100);
const warning = z.enum([
  'missing_evidence',
  'scope_review',
  'private_content',
  'unknown_price',
  'requires_key',
  'authority_disabled',
  'unsupported_schema',
  'missing_assets',
]);
const warnings = z.array(warning).max(8);
const entityRef = z.object({ companyId: id, revision }).strict();
const domain = z
  .string()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/i);
const role = z.enum(['company', 'infrastructure', 'distribution']);
const membership = z
  .object({
    marketId: id,
    companyId: id,
    revision,
    roles: z
      .array(role)
      .min(1)
      .max(3)
      .refine((items) => new Set(items).size === items.length),
    relevance: z
      .object({
        reason: text,
        basis: z.enum(['supported', 'human_judgment', 'unresolved']),
        evidenceRefs: refs,
      })
      .strict(),
  })
  .strict();
const section = z
  .object({
    section: companySectionSchema,
    blocks: z.array(z.object({ id, heading: label, text, evidenceRefs: refs }).strict()).max(100),
    state: z.enum(['available', 'partial', 'missing']),
    gaps,
  })
  .strict();
const fact = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('numeric'),
      label,
      observation: numericObservationRecordSchema.refine(
        (observation) => observation.support === 'supported' && observation.value !== null,
        'Card numbers must have retained support; disputes stay in the evidence view',
      ),
    })
    .strict(),
  z
    .object({
      kind: z.literal('text'),
      claimId: id,
      label,
      text,
      eventAt: timestamp.nullable(),
      evidenceRefs: refs.refine(
        (items) => items.length > 0,
        'Display facts require retained support',
      ),
    })
    .strict(),
]);
const finding = z
  .object({
    id,
    revision,
    kind: z.enum(['trend', 'culture', 'barrier', 'risk']),
    title: label,
    summary: text,
    companyIds: z.array(id).max(50),
    evidenceRefs: refs.refine((items) => items.length > 0),
    state: z.enum(['reported', 'supported', 'disputed', 'resolved']),
    eventAt: timestamp.nullable(),
  })
  .strict();
const comparison = z
  .object({
    companies: z
      .array(entityRef)
      .min(2)
      .max(6)
      .refine((items) => new Set(items.map((item) => item.companyId)).size === items.length),
    criteria: z
      .array(
        z
          .object({
            metricDefinitionId: id,
            label,
            state: z.enum(['comparable', 'incompatible', 'missing']),
            observationIds: z.array(id).max(12),
            reason: text,
          })
          .strict(),
      )
      .max(100),
    gaps,
  })
  .strict();
const monetaryValue = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    amountMinor: count,
    kind: z.enum(['known', 'estimated']),
  })
  .strict();
const usage = z
  .object({
    requests: count,
    inputTokens: count,
    outputTokens: count,
    cost: monetaryValue.nullable(),
    priceState: z.enum(['known', 'estimated', 'unknown']),
    inFlightMayBeBilled: z.boolean(),
  })
  .strict()
  .refine(
    (item) =>
      item.priceState === 'unknown'
        ? item.cost === null
        : item.cost !== null && item.cost.kind === item.priceState,
    'Unknown cost is not free; known and estimated amounts remain distinct',
  );
const page = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      items: z.array(item).max(100),
      limit: z.number().int().min(1).max(100),
      nextCursor: id.nullable(),
    })
    .strict()
    .refine(
      (value) => value.items.length <= value.limit,
      'A page cannot exceed its declared limit',
    );
const match = z
  .object({
    kind: z.enum(['market', 'company', 'finding', 'report']),
    id,
    revision,
    title: label,
    excerpt: text.nullable(),
    evidenceRefs: refs,
  })
  .strict();
const marketSummary = z
  .object({
    marketId: id,
    revision,
    name: label,
    companyCount: count,
    lastResearchedAt: timestamp.nullable(),
  })
  .strict();
const event = z
  .object({
    id,
    runId: id,
    sequence: count,
    occurredAt: timestamp,
    kind: z.enum([
      'accepted',
      'task_started',
      'retrieving',
      'checking_support',
      'synthesizing',
      'waiting',
      'checkpointed',
      'paused',
      'cancelled',
      'completed',
      'partial',
      'failed',
    ]),
    taskId: id.nullable(),
    recordRefs: z.array(z.object({ id, revision }).strict()).max(100),
  })
  .strict();
const update = z
  .object({
    id,
    revision,
    companyId: id,
    marketId: id.nullable(),
    title: label,
    summary: text,
    eventAt: timestamp.nullable(),
    observedAt: timestamp,
    beforeObservationIds: z.array(id).max(100),
    afterObservationIds: z.array(id).min(1).max(100),
    evidenceRefs: refs.refine((items) => items.length > 0),
  })
  .strict();
const audit = z
  .object({
    id,
    occurredAt: timestamp,
    action: label,
    outcome: z.enum(['allowed', 'denied', 'revoked']),
    disclosedRecords: z.array(z.object({ id, revision }).strict()).max(100),
    responseBytes: count,
  })
  .strict();
const freshness = z
  .object({
    state: z.enum(['fresh', 'stale', 'never_researched', 'unknown']),
    lastResearchedAt: timestamp.nullable(),
  })
  .strict();
const base = {
  contractVersion: z.literal('1'),
  requestId: id,
  vaultId: id,
  revision,
  observedAt: timestamp,
  freshness,
  evidenceRefs: refs,
  gaps,
};

function cachedResult<N extends ActionName, T extends z.ZodTypeAny>(action: N, data: T) {
  const request = actionRequestSchema.options.find((item) => item.shape.action.value === action);
  if (!request) throw new Error('Cached result action is absent from request catalogue');
  return z
    .object({ ...base, action: z.literal(action), target: request.shape.target, data })
    .strict();
}

// No query can dispatch work. These shapes are not authorization or evidence adjudication.
const variants = [
  cachedResult('library.search', page(match)),
  cachedResult('market.list', page(marketSummary)),
  cachedResult(
    'market.get',
    z
      .object({
        marketId: id,
        name: label,
        scope: scopeDraftSchema,
        scopeRevision: revision,
        memberships: z.array(membership).max(100),
        findings: z.array(finding).max(100),
        state: z.enum(['empty', 'partial', 'ready']),
      })
      .strict(),
  ),
  cachedResult(
    'company.get',
    z
      .object({
        companyId: id,
        identity: z
          .object({
            name: label,
            purpose: text.nullable(),
            domains: z.array(domain).max(20),
            logoAssetHash: hash.nullable(),
          })
          .strict(),
        memberships: z.array(membership).max(100),
        facts: z.array(fact).max(3),
        sections: z.array(section).max(5),
        state: z.enum(['sparse', 'partial', 'ready']),
      })
      .strict(),
  ),
  cachedResult(
    'evidence.get',
    z
      .object({
        sources: z.array(sourceVersionRecordSchema).max(100),
        passages: z.array(evidencePassageRecordSchema).max(100),
        observations: z.array(numericObservationRecordSchema).max(100),
        state: z.enum(['available', 'partial', 'missing']),
      })
      .strict(),
  ),
  cachedResult(
    'scope.preview',
    z
      .object({
        scope: scopeDraftSchema,
        seeds: z
          .array(
            z
              .object({
                index: z.number().int().min(0).max(49),
                status: z.enum(['resolved', 'ambiguous', 'out_of_scope', 'unresolved']),
                candidates: z.array(entityRef).max(20),
                reason: text,
              })
              .strict(),
          )
          .max(50),
        warnings,
      })
      .strict(),
  ),
  cachedResult(
    'company.resolve',
    z
      .object({
        candidates: z
          .array(
            z
              .object({
                companyId: id,
                revision,
                name: label,
                domains: z.array(domain).max(20),
                matchBasis: z.enum(['exact_domain', 'alias_evidence', 'name_candidate']),
                evidenceRefs: refs,
              })
              .strict(),
          )
          .max(100),
        unresolved: z
          .array(
            z
              .object({
                name: label.nullable(),
                domain: domain.nullable(),
                reason: z.enum(['no_match', 'ambiguous', 'out_of_scope']),
              })
              .strict(),
          )
          .max(40),
      })
      .strict(),
  ),
  cachedResult('comparison.get', comparison),
  cachedResult(
    'report.get',
    z
      .object({
        reportId: id,
        title: label,
        templateId: id,
        templateVersion: label,
        inputRevisions: selectedTargetsSchema,
        sections: z.array(z.object({ heading: label, text, evidenceRefs: refs }).strict()).max(100),
        state: z.enum(['complete', 'incomplete']),
      })
      .strict(),
  ),
  cachedResult(
    'run.get',
    z
      .object({
        runId: id,
        status: researchRunStateSchema,
        tasks: z
          .array(
            z
              .object({
                taskId: id,
                revision,
                status: researchRunStateSchema,
                attempt: count,
                checkpointRef: id.nullable(),
              })
              .strict(),
          )
          .max(100),
        outputs: z.array(runOutputManifestSchema).max(100),
        usage,
      })
      .strict(),
  ),
  cachedResult('run.events.list', page(event)),
  cachedResult('updates.list', page(update)),
  cachedResult(
    'monitor.preview',
    z
      .object({
        cadence: z.enum(['daily', 'weekly']),
        companies: z.array(entityRef).min(1).max(50),
        execution: z.literal('desktop_session_only'),
        willRunWhileClosed: z.literal(false),
        maxRequestsPerTick: z.number().int().min(1).max(100),
        warnings,
      })
      .strict(),
  ),
  cachedResult('connection.audit.list', page(audit)),
  cachedResult(
    'export.preview',
    z
      .object({
        previewId: id,
        previewHash: hash,
        format: z.enum(['json', 'markdown', 'csv']),
        recordCount: count,
        assetCount: count,
        estimatedBytes: count,
        includesSecrets: z.literal(false),
        warnings,
      })
      .strict(),
  ),
  cachedResult(
    'import.preview',
    z
      .object({
        previewId: id,
        previewHash: hash,
        schemaVersion: z.number().int().min(1),
        recordCount: count,
        assetCount: count,
        state: z.enum(['valid', 'invalid', 'schema_too_new', 'missing_assets']),
        operationalAuthority: z.literal('disabled'),
        warnings,
      })
      .strict(),
  ),
  cachedResult(
    'provider.status',
    z
      .object({
        connectionId: id,
        configured: z.boolean(),
        secretStatus: z.enum(['configured', 'missing', 'session_only', 'unavailable']),
        capabilities: z
          .array(providerCapabilitySchema)
          .max(4)
          .refine((items) => new Set(items).size === items.length),
        testStatus: z.enum(['untested', 'passed', 'failed', 'expired']),
      })
      .strict(),
  ),
  cachedResult(
    'budget.preview',
    z
      .object({
        proposalId: id,
        proposalHash: hash,
        requiresApproval: z.literal(true),
        priceState: z.enum(['known', 'estimated', 'unknown']),
        estimatedCost: monetaryValue.nullable(),
        warnings,
      })
      .strict(),
  ),
  cachedResult(
    'budget.get',
    z
      .object({
        budgetId: id,
        status: z.enum(['active', 'disabled', 'exhausted', 'expired', 'reconciliation_required']),
        usage,
        remainingRequests: count.nullable(),
        expiresAt: timestamp.nullable(),
      })
      .strict(),
  ),
  cachedResult(
    'vault.status',
    z
      .object({
        schemaVersion: z.number().int().min(1),
        state: z.enum([
          'ready',
          'read_only',
          'migration_required',
          'schema_too_new',
          'unavailable',
        ]),
        writerGeneration: revision,
        serviceMode: z.enum(['desktop', 'supervised_mcp', 'unavailable']),
        monitoringAvailable: z.boolean(),
      })
      .strict(),
  ),
] as const;

const readVariantSchema = z.discriminatedUnion('action', variants);
export const CACHED_READ_ACTIONS = Object.freeze(
  variants.map((schema) => schema.shape.action.value),
);
export type CachedReadResult = z.infer<typeof readVariantSchema>;

function nestedEvidence(value: unknown): z.infer<typeof retainedEvidenceRefSchema>[] {
  if (Array.isArray(value)) return value.flatMap(nestedEvidence);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === 'evidenceRefs' ? refs.parse(child) : nestedEvidence(child),
  );
}

// Also bind content identity, dates and transitive citation shapes within the reply.
export const cachedReadResultSchema = readVariantSchema.superRefine((value, context) => {
  const fail = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  const researchedAt = value.freshness.lastResearchedAt;
  if (
    (value.freshness.state === 'fresh' || value.freshness.state === 'stale') &&
    researchedAt === null
  )
    fail('Researched freshness requires its actual date');
  if (value.freshness.state === 'never_researched' && researchedAt !== null)
    fail('Never-researched data cannot carry a research date');
  if (researchedAt && Date.parse(researchedAt) > Date.parse(value.observedAt))
    fail('Research date cannot be in the future of the read');
  const evidenceKey = (ref: z.infer<typeof retainedEvidenceRefSchema>) =>
    `${ref.sourceId}:${ref.sourceRevision}:${ref.passageId}`;
  const retained = new Set(value.evidenceRefs.map(evidenceKey));
  if (nestedEvidence(value.data).some((ref) => !retained.has(evidenceKey(ref))))
    fail('Result citations must occur in its retained evidence manifest');
  if (
    value.action === 'company.get' &&
    'companyId' in value.target &&
    value.data.companyId !== value.target.companyId
  )
    fail('Company content must match target');
  if (value.action === 'company.get') {
    if (
      value.data.memberships.some(
        (item) =>
          item.companyId !== value.data.companyId ||
          ('marketId' in value.target &&
            value.target.marketId !== undefined &&
            item.marketId !== value.target.marketId),
      )
    )
      fail('Memberships must belong to the selected company and requested market');
    if (
      new Set(
        value.data.facts.map((item) =>
          item.kind === 'numeric' ? item.observation.id : item.claimId,
        ),
      ).size !== value.data.facts.length ||
      new Set(value.data.sections.map((item) => item.section)).size !== value.data.sections.length
    )
      fail('Facts and primary sections cannot be duplicated');
    if (
      value.data.facts.some(
        (item) =>
          item.kind === 'numeric' &&
          (item.observation.companyId !== value.data.companyId ||
            item.observation.vaultId !== value.vaultId),
      )
    )
      fail('Card observations must belong to the selected company and vault');
    if (
      value.data.state === 'ready' &&
      value.data.facts.length === 0 &&
      !value.data.sections.some(
        (item) =>
          item.state === 'available' && item.blocks.some((block) => block.evidenceRefs.length > 0),
      )
    )
      fail('Ready company requires useful supported content');
  }
  if (
    value.action === 'market.get' &&
    'marketId' in value.target &&
    value.data.marketId !== value.target.marketId
  )
    fail('Market content must match target');
  if (
    value.action === 'market.get' &&
    (value.data.memberships.some((item) => item.marketId !== value.data.marketId) ||
      new Set(value.data.memberships.map((item) => item.companyId)).size !==
        value.data.memberships.length)
  )
    fail('Deck memberships must be unique and belong to this market');
  if (
    value.action === 'report.get' &&
    'reportId' in value.target &&
    value.data.reportId !== value.target.reportId
  )
    fail('Report content must match target');
  if (
    value.action === 'report.get' &&
    value.data.state === 'complete' &&
    (value.data.sections.length === 0 ||
      value.data.sections.some((item) => item.evidenceRefs.length === 0) ||
      value.gaps.length > 0)
  )
    fail('Complete report requires retained support and no unresolved gaps');
  if (
    value.action === 'run.get' &&
    'runId' in value.target &&
    (value.data.runId !== value.target.runId ||
      value.data.outputs.some(
        (output) => output.runId !== value.data.runId || output.vaultId !== value.vaultId,
      ))
  )
    fail('Run content and outputs must match their vault/run');
  if (value.action === 'run.events.list' && 'runId' in value.target) {
    const runId = value.target.runId;
    if (value.data.items.some((item) => item.runId !== runId))
      fail('Event stream must belong to the requested run');
  }
  if (value.action === 'comparison.get' && 'companyIds' in value.target) {
    const companyIds = value.target.companyIds;
    if (
      value.data.companies.length !== companyIds.length ||
      value.data.companies.some((item) => !companyIds.includes(item.companyId))
    )
      fail('Comparison must cover exactly the requested companies');
  }
  if (
    value.action === 'provider.status' &&
    'connectionId' in value.target &&
    value.data.connectionId !== value.target.connectionId
  )
    fail('Provider status must match target');
  if (
    value.action === 'budget.get' &&
    'budgetId' in value.target &&
    value.data.budgetId !== value.target.budgetId
  )
    fail('Budget content must match target');
  if (
    value.action === 'budget.preview' &&
    (value.data.priceState === 'unknown'
      ? value.data.estimatedCost !== null
      : value.data.estimatedCost === null)
  )
    fail('Budget preview must preserve unknown pricing');
  if (
    value.action === 'vault.status' &&
    value.data.monitoringAvailable &&
    (value.data.serviceMode !== 'desktop' || value.data.state !== 'ready')
  )
    fail('Monitoring needs an active ready desktop service');
  if (value.action === 'evidence.get') {
    const records = [...value.data.sources, ...value.data.passages, ...value.data.observations];
    if (records.some((item) => item.vaultId !== value.vaultId))
      fail('Evidence records must belong to the requested vault');
    const sourceKeys = new Set(value.data.sources.map((item) => `${item.id}:${item.revision}`));
    if (
      value.data.passages.some((item) => !sourceKeys.has(`${item.sourceId}:${item.sourceRevision}`))
    )
      fail('Retained passages must identify a returned source version');
    const passageKeys = new Set(
      value.data.passages.map((item) => `${item.sourceId}:${item.sourceRevision}:${item.id}`),
    );
    if (
      value.data.observations
        .flatMap((item) => item.evidenceRefs)
        .some((item) => !passageKeys.has(evidenceKey(item)))
    )
      fail('Observation support must resolve to retained passages');
  }
});

/** Correlation only. The trusted service must enforce grants and transitive disclosure. */
export function cachedReadMatchesRequest(requestValue: unknown, resultValue: unknown): boolean {
  const request = actionRequestSchema.safeParse(requestValue);
  const result = cachedReadResultSchema.safeParse(resultValue);
  if (!request.success || !result.success) return false;
  const input = request.data.input;
  const sameTarget =
    JSON.stringify(Object.entries(request.data.target).sort()) ===
    JSON.stringify(Object.entries(result.data.target).sort());
  return (
    request.data.action === result.data.action &&
    request.data.requestId === result.data.requestId &&
    request.data.vaultId === result.data.vaultId &&
    sameTarget &&
    (!('revision' in input) ||
      input.revision === undefined ||
      input.revision === result.data.revision) &&
    (!('limit' in input) ||
      !('limit' in result.data.data) ||
      input.limit === result.data.data.limit)
  );
}
