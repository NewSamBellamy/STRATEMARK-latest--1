import { z } from 'zod';
import { retainedEvidenceRefSchema } from './action-results';

/** Record shape validation only; this does not authorize access, prove evidence true, or grant import authority. */
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().datetime();
const hash = z.string().regex(/^[a-f0-9]{64}$/);

/** Compare already-validated UTC record timestamps without losing submillisecond precision. */
export function compareRecordTimestamps(left: string, right: string): number {
  const leftSecond = Date.parse(`${left.slice(0, 19)}Z`);
  const rightSecond = Date.parse(`${right.slice(0, 19)}Z`);
  if (leftSecond !== rightSecond) return leftSecond < rightSecond ? -1 : 1;

  const leftFraction = /\.(\d+)Z$/.exec(left)?.[1] ?? '';
  const rightFraction = /\.(\d+)Z$/.exec(right)?.[1] ?? '';
  const width = Math.max(leftFraction.length, rightFraction.length);
  const normalizedLeft = leftFraction.padEnd(width, '0');
  const normalizedRight = rightFraction.padEnd(width, '0');
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
}

const recordVersionFields = {
  contractVersion: z.literal('1'),
  vaultId: id,
  id,
  revision,
  createdAt: timestamp,
  updatedAt: timestamp,
};

function versionedRecord<Fields extends z.ZodRawShape>(fields: Fields) {
  return z
    .object({ ...recordVersionFields, ...fields })
    .strict()
    .superRefine((record, context) => {
      if (compareRecordTimestamps(record.createdAt!, record.updatedAt!) > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['updatedAt'],
          message: 'updatedAt must not precede createdAt',
        });
      }
    });
}

export const recordVersionSchema = versionedRecord({});

const uniqueIds = z
  .array(id)
  .max(100)
  .superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: 'IDs must be unique',
        });
      }
      seen.add(value);
    });
  });

const visibilityScopeSchema = z.object({ marketIds: uniqueIds, companyIds: uniqueIds }).strict();
const safeHttpUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const authority = /^https?:\/\/([^/?#]*)/i.exec(value);
    return authority !== null && !(authority[1] ?? '').includes('@');
  }, 'URL must use HTTP(S) without credentials');
const originSchema = z.enum(['web', 'user_provided', 'imported']);

/** `id` and `revision` identify this source version and align with retained evidence references. */
export const sourceVersionRecordSchema = versionedRecord({
  canonicalUrl: safeHttpUrl.nullable(),
  originalUrl: safeHttpUrl.nullable(),
  contentHash: hash.nullable(),
  fetchedAt: timestamp,
  publishedAt: timestamp.nullable(),
  eventAt: timestamp.nullable(),
  retrievalStatus: z.enum(['retrieved', 'partial', 'failed', 'blocked']),
  origin: originSchema,
  visibilityScope: visibilityScopeSchema,
}).superRefine((source, context) => {
  if (
    (source.origin === 'web' && (source.canonicalUrl === null || source.originalUrl === null)) ||
    ((source.retrievalStatus === 'retrieved' || source.retrievalStatus === 'partial') &&
      source.contentHash === null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Web sources need attributable URLs; retained content needs a hash',
    });
  }
  if (compareRecordTimestamps(source.fetchedAt!, source.updatedAt!) > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fetchedAt'],
      message: 'fetchedAt must not follow updatedAt',
    });
  }
});

export const evidencePassageRecordSchema = versionedRecord({
  sourceId: id,
  sourceRevision: revision,
  text: z.string().trim().min(1).max(20_000),
  contentHash: hash,
  origin: originSchema,
  visibilityScope: visibilityScopeSchema,
});

const periodSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('instant'), at: timestamp }).strict(),
  z.object({ kind: z.literal('interval'), startAt: timestamp, endAt: timestamp }).strict(),
  z.object({ kind: z.literal('unknown') }).strict(),
]);
export const evidenceRefsSchema = z
  .array(retainedEvidenceRefSchema)
  .max(100)
  .superRefine((refs, context) => {
    const seen = new Set<string>();
    refs.forEach((ref, index) => {
      const key = JSON.stringify([ref.sourceId, ref.sourceRevision, ref.passageId]);
      if (seen.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: 'Evidence references must be unique',
        });
      }
      seen.add(key);
    });
  });

export const numericObservationRecordSchema = versionedRecord({
  companyId: id,
  metricDefinitionId: id,
  scope: z
    .object({ kind: z.enum(['company', 'market', 'segment', 'product', 'geography']), id })
    .strict(),
  unit: z.string().trim().min(1).max(64),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  period: periodSchema,
  value: z.union([z.number().finite(), z.null()]),
  support: z.enum(['reported', 'supported', 'conflicted', 'unknown']),
  evidenceRefs: evidenceRefsSchema,
}).superRefine((observation, context) => {
  if (
    (observation.support === 'supported' || observation.support === 'conflicted') &&
    observation.evidenceRefs.length === 0
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['evidenceRefs'],
      message: 'Supported or conflicted observations require retained evidence',
    });
  }
  if ((observation.support === 'unknown') !== (observation.value === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: 'Only unknown observations have a null value',
    });
  }
  if (
    observation.period.kind === 'interval' &&
    compareRecordTimestamps(observation.period.startAt, observation.period.endAt) > 0
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['period', 'endAt'],
      message: 'An interval must not end before it starts',
    });
  }
});

type NumericObservation = z.infer<typeof numericObservationRecordSchema>;
type ComparisonFields = Pick<
  NumericObservation,
  'companyId' | 'metricDefinitionId' | 'scope' | 'unit' | 'currency' | 'period'
>;

/** Stable identity for period-compatible comparisons; values and evidence are deliberately excluded. */
export function observationComparisonKey(observation: ComparisonFields): string | null {
  if (
    observation.period.kind === 'unknown' ||
    (observation.unit === 'money' && observation.currency === null)
  )
    return null;
  const normalizedTime = (value: string) =>
    value.replace(/\.(\d+)Z$/, (_match, fraction: string) => {
      const trimmed = fraction.replace(/0+$/, '');
      return `${trimmed ? `.${trimmed}` : ''}Z`;
    });
  const period =
    observation.period.kind === 'instant'
      ? ['instant', normalizedTime(observation.period.at)]
      : [
          'interval',
          normalizedTime(observation.period.startAt),
          normalizedTime(observation.period.endAt),
        ];
  return JSON.stringify([
    observation.companyId,
    observation.metricDefinitionId,
    observation.scope.kind,
    observation.scope.id,
    observation.unit,
    observation.currency,
    period,
  ]);
}
