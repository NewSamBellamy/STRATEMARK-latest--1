/** Consumed desktop research slice. Local approval does not grant external agents authority. */
import { z } from 'zod';
import { scopeDraftSchema } from './actions';
import { cardTypeSchema } from './schemas';
import type { ResearchProgress } from './repository';

export const nativeResearchLimitsSchema = z
  .object({
    maxRequests: z.number().int().min(1).max(500),
    maxInputTokens: z.number().int().min(1).max(5_000_000),
    maxOutputTokens: z.number().int().min(1).max(1_000_000),
    /** Explicit public page capture ceiling; absent on older approvals means zero. */
    maxSourceRequests: z.number().int().min(0).max(100).optional(),
  })
  .strict();
export const nativeResearchStartSchema = z
  .object({
    requestKey: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
    scope: scopeDraftSchema,
    maxCompanies: z.number().int().min(1).max(12),
    limits: nativeResearchLimitsSchema,
  })
  .strict();
export type NativeResearchStart = z.infer<typeof nativeResearchStartSchema>;
export type NativeResearchLimits = z.infer<typeof nativeResearchLimitsSchema>;

const taskId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
/** The selected queue is retained, not rediscovered when an attempt resumes. */
export const nativeResearchTaskSchema = z
  .object({
    companyId: taskId,
    candidate: z
      .object({
        name: z.string().min(1).max(240),
        domain: z.string().max(253).nullable(),
        descriptor: z.string().max(20_000),
        primaryRole: z.enum(['company', 'infrastructure', 'distribution']).optional(),
        cardTypes: z.array(cardTypeSchema).min(1).max(7),
        reportedValuation: z.number().finite().nonnegative().nullable().optional(),
        reportedArr: z.number().finite().nonnegative().nullable().optional(),
        reportedHeadcount: z.number().finite().nonnegative().nullable().optional(),
        fundingStage: z.string().max(500).nullable().optional(),
      })
      .strict(),
    status: z.enum(['queued', 'running', 'completed', 'failed']),
    attempts: z.number().int().min(0).max(500),
    cardIds: z
      .array(taskId)
      .max(7)
      .refine((ids) => new Set(ids).size === ids.length, 'Task card IDs must be unique'),
    error: z.string().max(20_000).nullable(),
  })
  .strict();
export type NativeResearchTask = z.infer<typeof nativeResearchTaskSchema>;

export interface NativeResearchRun {
  id: string;
  marketId: string;
  deckId: string;
  requestKey: string;
  requestFingerprint: string;
  /** Absent on older unclassified records, which remain read-only. */
  researchProvenance?: 'synthetic_fixture' | 'live_provider';
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  generation: number;
  scope: z.infer<typeof scopeDraftSchema>;
  maxCompanies: number;
  limits: NativeResearchLimits;
  usage: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    complete: boolean;
    sourceRequests?: number;
  };
  /** Absent before selection, and on records created before durable queues existed. */
  tasks?: NativeResearchTask[];
  createdAt: string;
  updatedAt: string;
  error: string | null;
}
export interface NativeResearchEvent {
  sequence: number;
  progress: ResearchProgress;
  createdAt: string;
}

/** Retained text is inspectable source material, not a semantically verified claim. */
export const nativeSourceEvidenceSchema = z
  .object({
    url: z
      .string()
      .url()
      .max(2048)
      .refine((value) => {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
      }, 'Source URL must be HTTP(S) without credentials'),
    title: z.string().max(5000),
    retrievalStatus: z.enum(['lead_only', 'retrieved', 'partial', 'failed', 'blocked']),
    fetchedAt: z.string().datetime().nullable(),
    text: z.string().trim().min(1).max(20_000).nullable(),
    sourceId: taskId.nullable(),
    sourceRevision: z.number().int().min(1).nullable(),
    passageId: taskId.nullable(),
    support: z.literal('unreviewed'),
  })
  .strict()
  .superRefine((source, context) => {
    const retained = ['retrieved', 'partial'].includes(source.retrievalStatus);
    if (
      retained &&
      (!source.text ||
        !source.fetchedAt ||
        !source.sourceId ||
        !source.sourceRevision ||
        !source.passageId)
    )
      context.addIssue({
        code: 'custom',
        message: 'Retained text needs its source, passage and capture identity.',
      });
    if (!retained && (source.text !== null || source.passageId !== null))
      context.addIssue({
        code: 'custom',
        message: 'Uncaptured or unavailable sources cannot claim retained passages.',
      });
    if (
      source.retrievalStatus === 'lead_only' &&
      [source.fetchedAt, source.sourceId, source.sourceRevision].some((value) => value !== null)
    )
      context.addIssue({
        code: 'custom',
        message: 'Uncaptured leads do not claim retained versions.',
      });
  });
export const nativeCardEvidenceSchema = z
  .object({
    cardId: taskId,
    sources: z.array(nativeSourceEvidenceSchema).max(20),
  })
  .strict();
export type NativeCardEvidence = z.infer<typeof nativeCardEvidenceSchema>;
