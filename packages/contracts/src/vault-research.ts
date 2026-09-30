/** Retained research shapes. Validation does not adjudicate prose or confer local authority. */
import { z } from 'zod';
import { evidenceRefsSchema, recordVersionSchema } from './vault-evidence';

const id = recordVersionSchema.innerType().shape.id;
const revision = recordVersionSchema.innerType().shape.revision.min(1);
const record = recordVersionSchema.refine(
  (value) => value.revision >= 1,
  'Saved records start at revision 1',
);
const origin = z.enum(['web', 'user_provided', 'imported']);
const scope = z.object({ kind: z.enum(['company', 'market']), id }).strict();
const text = z.string().trim().min(1).max(20_000);
const title = z.string().trim().min(1).max(240);
const eventAt = z.string().datetime().nullable();
const gaps = z
  .array(
    z.enum([
      'missing_evidence',
      'unsupported',
      'incompatible',
      'out_of_scope',
      'provider_failed',
      'budget_stopped',
      'ambiguous_identity',
      'incomplete',
    ]),
  )
  .max(8)
  .refine((items) => new Set(items).size === items.length, 'Gaps must be unique');

export const claimRecordSchema = z
  .object({
    record,
    companyId: id,
    scope,
    text,
    eventAt,
    origin,
    support: z.enum(['reported', 'supported', 'disputed', 'unknown']),
    evidenceRefs: evidenceRefsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scope.kind === 'company' && value.scope.id !== value.companyId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Company scope must match its claim company',
      });
    if (['supported', 'disputed'].includes(value.support) && value.evidenceRefs.length === 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Supported or disputed claims need retained evidence',
      });
    if (value.origin === 'imported' && !['reported', 'unknown'].includes(value.support))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Imported attribution is not local support verification',
      });
  });
export type ClaimRecord = z.infer<typeof claimRecordSchema>;

export const findingRecordSchema = z
  .object({
    record,
    marketId: id,
    kind: z.enum(['trend', 'culture', 'barrier', 'risk']),
    title,
    summary: text,
    companyIds: z
      .array(id)
      .max(50)
      .refine((items) => new Set(items).size === items.length, 'Company IDs must be unique'),
    eventAt,
    origin,
    state: z.enum(['reported', 'supported', 'disputed', 'resolved']),
    riskStatus: z.enum(['allegation', 'established_event', 'ongoing', 'resolved']).nullable(),
    evidenceRefs: evidenceRefsSchema.refine(
      (items) => items.length > 0,
      'Findings need their own retained support',
    ),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.kind === 'risk') !== (value.riskStatus !== null))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only risks require a stated risk status',
      });
    const importedResolution =
      value.origin === 'imported' && value.state === 'reported' && value.riskStatus === 'resolved';
    if (
      value.kind === 'risk' &&
      !importedResolution &&
      (value.state === 'resolved') !== (value.riskStatus === 'resolved')
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Risk resolution must be explicit and consistent',
      });
    if (value.origin === 'imported' && value.state !== 'reported')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Imported findings remain attributed reports until checked locally',
      });
  });
export type FindingRecord = z.infer<typeof findingRecordSchema>;

const inputPin = z
  .object({
    kind: z.enum(['company', 'market', 'claim', 'observation', 'finding', 'report']),
    id,
    revision,
  })
  .strict();
export const reportRecordSchema = z
  .object({
    record,
    scope,
    title,
    markdown: z.string().min(1).max(200_000),
    origin,
    status: z.enum(['completed', 'partial', 'failed']),
    inputRevisions: z
      .array(inputPin)
      .max(100)
      .refine(
        (items) =>
          new Set(items.map((item) => `${item.kind}:${item.id}:${item.revision}`)).size ===
          items.length,
        'Input revisions must be unique',
      ),
    evidenceRefs: evidenceRefsSchema,
    gaps,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === 'completed' &&
      (value.evidenceRefs.length === 0 ||
        value.inputRevisions.length === 0 ||
        value.gaps.length !== 0)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Completed reports need pinned inputs, retained support and no undisclosed gaps',
      });
    if (value.status !== 'completed' && value.gaps.length === 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Incomplete reports must disclose their gaps',
      });
    if (
      value.origin === 'imported' &&
      (value.status === 'completed' || !value.gaps.includes('missing_evidence'))
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Imported reports cannot mint local support or conceal unvalidated evidence',
      });
  });
export type ReportRecord = z.infer<typeof reportRecordSchema>;
