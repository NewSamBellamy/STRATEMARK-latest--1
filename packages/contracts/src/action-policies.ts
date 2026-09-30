import { z } from 'zod';
import {
  ACTION_DEFINITIONS,
  grantedActionsSchema,
  selectedTargetsSchema,
  type ActionName,
} from './actions';

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const revision = z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const policyScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('records'), records: selectedTargetsSchema }).strict(),
  z
    .object({
      kind: z.literal('input_only'),
      action: z.enum(['scope.assist.start', 'provider.test.start']),
      requestId: id,
      payloadHash: sha256,
    })
    .strict(),
]);
const actionNames = Object.keys(ACTION_DEFINITIONS) as [ActionName, ...ActionName[]];
const uniqueArray = <T extends z.ZodTypeAny>(schema: T, min: number, max: number) =>
  z
    .array(schema)
    .min(min)
    .max(max)
    .refine((values) => new Set(values).size === values.length, 'Values must be unique');

const isAfter = (later: string, earlier: string): boolean =>
  Date.parse(later) > Date.parse(earlier);
const isWithin = (value: string, start: string, end: string): boolean => {
  const time = Date.parse(value);
  return time >= Date.parse(start) && time <= Date.parse(end);
};
const addTimeIssue = (context: z.RefinementCtx, path: string, message: string) =>
  context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

/** Shape only. Parsing does not authenticate an actor, authorize an action, or consume a challenge. */
export const approvalChallengeSchema = z
  .object({
    contractVersion: z.literal('1'),
    id,
    action: z.enum(actionNames),
    payloadSHA256: sha256,
    authenticatedActorRef: id,
    vaultId: id,
    vaultRevision: revision,
    targets: z.union([selectedTargetsSchema, z.tuple([])]),
    issuedAt: timestamp,
    expiresAt: timestamp,
    consumedAt: timestamp.nullable(),
  })
  .strict()
  .superRefine((challenge, context) => {
    if (!isAfter(challenge.expiresAt, challenge.issuedAt)) {
      addTimeIssue(context, 'expiresAt', 'Challenge expiry must follow issue time');
    }
    if (
      challenge.consumedAt !== null &&
      !isWithin(challenge.consumedAt, challenge.issuedAt, challenge.expiresAt)
    ) {
      addTimeIssue(context, 'consumedAt', 'Consumption must fall within the challenge window');
    }
  });
export type ApprovalChallenge = z.infer<typeof approvalChallengeSchema>;

/** Shape only. The service must authenticate the bound client and enforce revocation on use. */
export const connectionGrantSchema = z
  .object({
    contractVersion: z.literal('1'),
    id,
    revision,
    vaultId: id,
    clientBindingRef: id,
    actions: grantedActionsSchema,
    fields: uniqueArray(
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
      1,
      10,
    ),
    records: selectedTargetsSchema,
    maxResponseBytes: z.number().finite().int().min(1).max(1_000_000),
    issuedAt: timestamp,
    expiresAt: timestamp,
    revokedAt: timestamp.nullable(),
    policyRef: id.optional(),
    budgetRef: id.optional(),
  })
  .strict()
  .superRefine((grant, context) => {
    const durationMs = Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt);
    if (durationMs <= 0 || durationMs > 30 * 24 * 60 * 60 * 1000) {
      addTimeIssue(context, 'expiresAt', 'Grant expiry must be within 30 days of issue time');
    }
    if (grant.revokedAt !== null && Date.parse(grant.revokedAt) < Date.parse(grant.issuedAt)) {
      addTimeIssue(context, 'revokedAt', 'Revocation cannot predate issue time');
    }

    const hasJobRefs = grant.policyRef !== undefined && grant.budgetRef !== undefined;
    const hasPartialJobRefs = (grant.policyRef === undefined) !== (grant.budgetRef === undefined);
    const requiresJobRefs = grant.actions.some((action) => {
      const definition = ACTION_DEFINITIONS[action];
      return definition.effect === 'job' && definition.billable;
    });
    if (hasPartialJobRefs || hasJobRefs !== requiresJobRefs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['policyRef'],
        message:
          'Paid job grants require both policy and budget references, and other grants forbid them',
      });
    }
  });
export type ConnectionGrant = z.infer<typeof connectionGrantSchema>;

const policyPurposes = z.enum([
  'scope_assistance',
  'market_research',
  'company_research',
  'finding_research',
  'answer',
  'comparison',
  'report',
  'support_check',
  'update_check',
  'provider_test',
]);

/** Shape only. The service must resolve each connection and reauthorize every egress request. */
export const egressPolicySchema = z
  .object({
    contractVersion: z.literal('1'),
    id,
    revision,
    vaultId: id,
    connectionIds: uniqueArray(id, 1, 20),
    modelCapabilities: uniqueArray(z.enum(['model', 'extraction', 'embedding']), 0, 3),
    retrievalCapabilities: uniqueArray(
      z.enum(['web_search', 'page_retrieval', 'native_grounding']),
      0,
      3,
    ),
    scope: policyScopeSchema,
    purposes: uniqueArray(policyPurposes, 1, 10),
    budgetRef: id,
    issuedAt: timestamp,
    expiresAt: timestamp,
  })
  .strict()
  .superRefine((policy, context) => {
    if (!isAfter(policy.expiresAt, policy.issuedAt)) {
      addTimeIssue(context, 'expiresAt', 'Policy expiry must follow issue time');
    }
    if (policy.modelCapabilities.length === 0 && policy.retrievalCapabilities.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['modelCapabilities'],
        message: 'At least one model or retrieval capability is required',
      });
    }
    if (policy.scope.kind === 'input_only') {
      const requiredPurpose =
        policy.scope.action === 'scope.assist.start' ? 'scope_assistance' : 'provider_test';
      if (policy.purposes.length !== 1 || policy.purposes[0] !== requiredPurpose) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['purposes'],
          message: 'Input-only policies must use the purpose bound to their action',
        });
      }
    }
  });
export type EgressPolicy = z.infer<typeof egressPolicySchema>;

const currencyLimit = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    amountMinor: z.number().finite().int().min(1).max(100_000_000_000),
  })
  .strict();

/** Shape only. Restored references need service reconciliation and fresh approval before activation. */
export const budgetPolicySchema = z
  .object({
    contractVersion: z.literal('1'),
    id,
    revision,
    vaultId: id,
    maxRequests: z.number().finite().int().min(1).max(100_000),
    maxInputTokens: z.number().finite().int().min(1).max(10_000_000),
    maxOutputTokens: z.number().finite().int().min(1).max(2_000_000),
    durationDays: z.number().finite().int().min(1).max(365),
    connectionIds: uniqueArray(id, 1, 20),
    scope: policyScopeSchema,
    currencyLimit: currencyLimit.optional(),
    priceHandling: z.enum(['reject_unknown', 'allow_unpriced']),
    issuedAt: timestamp,
    expiresAt: timestamp,
    state: z.enum(['active', 'stopped', 'reconciliation_required']),
    restoredFromRef: id.optional(),
  })
  .strict()
  .superRefine((policy, context) => {
    const durationMs = Date.parse(policy.expiresAt) - Date.parse(policy.issuedAt);
    if (durationMs <= 0 || durationMs > policy.durationDays * 24 * 60 * 60 * 1000) {
      addTimeIssue(context, 'expiresAt', 'Budget expiry must fit within its approved duration');
    }
    if (policy.currencyLimit !== undefined && policy.priceHandling !== 'reject_unknown') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceHandling'],
        message: 'Currency ceilings must reject routes with unknown prices',
      });
    }
    if (policy.restoredFromRef !== undefined && policy.state === 'active') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['state'],
        message: 'Restored budget references cannot activate without service reconciliation',
      });
    }
  });
export type BudgetPolicy = z.infer<typeof budgetPolicySchema>;
