/**
 * Zod validation schemas for all Electron IPC channel parameters.
 *
 * Every payload crossing the IPC boundary from the sandboxed renderer into
 * the Electron main process is parsed and strictly validated before reaching
 * the repository or disk storage.
 */
import { z } from 'zod';
import {
  refreshCadenceSchema,
  scopeDefinitionSchema,
  cardTypeSchema,
  maturityTierSchema,
  dashboardTabSchema,
  metricTypeSchema,
  userFootprintBasisSchema,
} from '@mi/contracts';

export {
  refreshCadenceSchema,
  scopeDefinitionSchema,
  cardTypeSchema,
  maturityTierSchema,
  dashboardTabSchema,
  metricTypeSchema,
  userFootprintBasisSchema,
};

export const createMarketInputSchema = z.object({
  name: z.string().min(1),
  scopeDefinition: scopeDefinitionSchema,
  refreshCadence: refreshCadenceSchema,
});

export const deckResearchBriefSchema = z.object({
  prompt: z.string().min(1),
  region: z.string().nullable().optional().default(null),
});

export const verifyMetricInputSchema = z.object({
  companyId: z.string().min(1),
  metricType: metricTypeSchema,
  metricId: z.string().optional(),
  userBasis: userFootprintBasisSchema.optional(),
  correction: z
    .object({
      value: z.number(),
      citations: z.array(z.object({ title: z.string(), url: z.string() })),
      rationale: z.string().nullable().optional(),
      asOf: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const cardFilterSchema = z
  .object({
    cardType: cardTypeSchema.optional(),
    tier: maturityTierSchema.optional(),
  })
  .optional();

export const deepDiveInputSchema = z.object({
  companyId: z.string().nullable().optional().default(null),
  companyName: z.string().min(1),
  topic: z.string().min(1),
  context: z.string().nullable().optional().default(null),
});

export const factCheckInputSchema = z.object({
  claim: z.string().min(1),
  companyName: z.string().nullable().optional().default(null),
  context: z.string().nullable().optional().default(null),
  companyId: z.string().nullable().optional(),
  metricId: z.string().nullable().optional(),
  metricType: metricTypeSchema.nullable().optional(),
  userBasis: userFootprintBasisSchema.optional(),
  storedValue: z.number().nullable().optional(),
});

export const reportRequestSchema = z.object({
  kind: z.enum(['deck', 'company']),
  subjectId: z.string().min(1),
  focus: z.string().nullable().optional().default(null),
  threadId: z.string().nullable().optional().default(null),
});

export const expandFocusSchema = z.object({
  tier: maturityTierSchema.optional(),
  cardType: cardTypeSchema.optional(),
});

export const overrideMetricInputSchema = z.object({
  companyId: z.string().min(1),
  metricType: metricTypeSchema,
  metricId: z.string().optional(),
  value: z.number().nullable(),
  note: z.string().nullable().optional().default(null),
  userBasis: userFootprintBasisSchema.optional(),
});

export const researchScopeSchema = z.object({
  kind: z.enum(['deck', 'company', 'cards', 'datapoint']),
  deckId: z.string().nullable().optional().default(null),
  companyId: z.string().nullable().optional().default(null),
  cardIds: z.array(z.string()).optional().default([]),
  subject: z.string().nullable().optional().default(null),
});

export const askResearchInputSchema = z.object({
  threadId: z.string().optional(),
  scope: researchScopeSchema.optional(),
  question: z.string().min(1),
});

export const listResearchThreadsFilterSchema = z
  .object({
    deckId: z.string().optional(),
    companyId: z.string().optional(),
  })
  .optional();
