import { z } from 'zod';
import {
  ACTION_DEFINITIONS,
  actionRequestSchema,
  researchRunStateSchema,
  scopeDraftSchema,
  selectedTargetsSchema,
  type ActionName,
} from './actions';

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const actions = Object.keys(ACTION_DEFINITIONS) as [ActionName, ...ActionName[]];
const targets = actionRequestSchema.options.map((request) => request.shape.target);
const target = z.union(
  targets as [(typeof targets)[number], (typeof targets)[number], ...(typeof targets)[number][]],
);
const receiptFields = {
  contractVersion: z.literal('1'),
  actionId: id,
  requestId: id,
  vaultId: id,
  action: z.enum(actions),
  target,
  acceptedAt: z.string().datetime(),
  resultingRevision: revision,
};
const createdKindSchema = z.enum([
  'market',
  'schedule',
  'grant',
  'connection',
  'budget',
  'tombstone',
]);
const createdKinds: Partial<Record<ActionName, z.infer<typeof createdKindSchema>>> = {
  'market.create': 'market',
  'monitor.enable': 'schedule',
  'connection.grant': 'grant',
  'provider.configure': 'connection',
  'budget.approve': 'budget',
  'record.trash': 'tombstone',
};

/** Shape only: the service must persist acceptance, dedupe and authorize before returning it. */
export const actionReceiptSchema = z
  .discriminatedUnion('effect', [
    z
      .object({
        ...receiptFields,
        effect: z.literal('job'),
        status: researchRunStateSchema,
        runId: id,
      })
      .strict(),
    z
      .object({
        ...receiptFields,
        effect: z.literal('write'),
        status: z.enum(['applied', 'pausing', 'paused', 'cancelling', 'cancelled']),
        runId: id.optional(),
        createdRecord: z.object({ kind: createdKindSchema, id, revision }).strict().optional(),
      })
      .strict(),
    z
      .object({ ...receiptFields, effect: z.literal('local'), status: z.literal('opened') })
      .strict(),
  ])
  .superRefine((receipt, context) => {
    const definition = ACTION_DEFINITIONS[receipt.action];
    const request = actionRequestSchema.options.find(
      (schema) => schema.shape.action.value === receipt.action,
    );
    if (
      definition.effect !== receipt.effect ||
      !request?.shape.target.safeParse(receipt.target).success
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Receipt effect and target must match its action',
      });
    }
    if (
      receipt.effect === 'job' &&
      receipt.action === 'run.resume' &&
      (!('runId' in receipt.target) || receipt.target.runId !== receipt.runId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Resume must address the existing run',
      });
    }
    if (receipt.effect === 'write') {
      const expectedKind = createdKinds[receipt.action];
      if (
        expectedKind
          ? receipt.createdRecord?.kind !== expectedKind
          : receipt.createdRecord !== undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Creating writes must identify their exact created record kind; other writes cannot invent one',
        });
      }
      const lifecycle = receipt.action === 'run.pause' || receipt.action === 'run.cancel';
      const statuses =
        receipt.action === 'run.pause' ? ['pausing', 'paused'] : ['cancelling', 'cancelled'];
      if (
        lifecycle
          ? !statuses.includes(receipt.status) ||
            !('runId' in receipt.target) ||
            receipt.target.runId !== receipt.runId
          : receipt.status !== 'applied' || receipt.runId !== undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Write receipt must preserve lifecycle acknowledgement semantics',
        });
      }
    }
  });
export type ActionReceipt = z.infer<typeof actionReceiptSchema>;

export const retainedEvidenceRefSchema = z
  .object({ sourceId: id, sourceRevision: revision, passageId: id })
  .strict();
const evidence = z.array(retainedEvidenceRefSchema).max(100);
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
const text = z.string().trim().min(1).max(20_000);
const resultReference = z.discriminatedUnion('action', [
  z
    .object({
      kind: z.literal('reference'),
      action: z.literal('company.get'),
      target: z.object({ companyId: id, marketId: id.optional() }).strict(),
      revision,
    })
    .strict(),
  z
    .object({
      kind: z.literal('reference'),
      action: z.literal('market.get'),
      target: z.object({ marketId: id }).strict(),
      revision,
    })
    .strict(),
  z
    .object({
      kind: z.literal('reference'),
      action: z.literal('report.get'),
      target: z.object({ reportId: id }).strict(),
      revision,
    })
    .strict(),
  z
    .object({
      kind: z.literal('reference'),
      action: z.literal('evidence.get'),
      target: z.union([
        z.object({ claimId: id }).strict(),
        z.object({ passageId: id }).strict(),
        z.object({ sourceId: id }).strict(),
      ]),
      revision,
    })
    .strict(),
]);
const result = z.union([
  resultReference,
  z.object({ kind: z.literal('no_result') }).strict(),
  z
    .object({
      kind: z.literal('scope_proposal'),
      proposalId: id,
      proposalHash: z.string().regex(/^[a-f0-9]{64}$/),
      scope: scopeDraftSchema,
    })
    .strict(),
  z.object({ kind: z.literal('answer'), answerId: id, text, citations: evidence }).strict(),
  z
    .object({
      kind: z.literal('comparison_explanation'),
      comparisonId: id,
      text,
      citations: evidence,
    })
    .strict(),
  z
    .object({
      kind: z.literal('support_check'),
      checks: z
        .array(
          z
            .object({
              observationId: id,
              status: z.enum(['supported', 'unsupported', 'inconclusive']),
              evidenceRefs: evidence,
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal('local_operation'),
      manifestId: id,
      manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
      operation: z.enum(['export', 'import', 'backup', 'restore', 'relocate', 'purge']),
      recordsAffected: z.number().int().min(0).max(10_000_000),
    })
    .strict(),
]);
const inputScope = z.union([
  selectedTargetsSchema,
  z
    .array(
      z
        .object({
          kind: z.literal('scope_draft'),
          requestId: id,
          payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    )
    .length(1),
]);

/** Current authorization must filter the manifest AND its transitive support on each read. */
export const runOutputManifestSchema = z
  .object({
    contractVersion: z.literal('1'),
    vaultId: id,
    runId: id,
    outputId: id,
    revision,
    observedAt: z.string().datetime(),
    status: z.enum(['completed', 'partial', 'failed']),
    originatingScope: inputScope,
    inputRevisions: inputScope,
    evidenceRefs: evidence,
    gaps,
    result,
  })
  .strict()
  .superRefine((output, context) => {
    if (output.status === 'completed' && output.result.kind === 'no_result') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Completed output must identify its result',
      });
    }
    if (output.status !== 'completed' && output.gaps.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Incomplete outputs must identify a gap',
      });
    }
    const retained = new Set(
      output.evidenceRefs.map((ref) => `${ref.sourceId}:${ref.sourceRevision}:${ref.passageId}`),
    );
    const citations =
      'citations' in output.result
        ? output.result.citations
        : output.result.kind === 'support_check'
          ? output.result.checks.flatMap((check) => check.evidenceRefs)
          : [];
    if (
      citations.some(
        (ref) => !retained.has(`${ref.sourceId}:${ref.sourceRevision}:${ref.passageId}`),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Citations must resolve to pinned manifest support',
      });
    }
    if (
      output.result.kind === 'support_check' &&
      output.result.checks.some(
        (check) => check.status === 'supported' && check.evidenceRefs.length === 0,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Supported checks require retained evidence',
      });
    }
    if (
      'citations' in output.result &&
      output.result.citations.length === 0 &&
      !output.gaps.some((item) => item.code === 'missing_evidence' || item.code === 'unsupported')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Unsourced prose must disclose missing support',
      });
    }
  });
export type RunOutputManifest = z.infer<typeof runOutputManifestSchema>;
