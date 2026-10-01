/** Bounded source-linked notes, not canonical claims or verification authority. */
import { z } from 'zod';

export const researchBriefSectionSchema = z.enum(['overview', 'offering', 'position', 'updates']);
export const researchBriefCitationSchema = z
  .object({
    title: z.string().max(5000),
    url: z
      .string()
      .url()
      .max(2048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
        } catch {
          return false;
        }
      }, 'Research source must be credential-free HTTP(S)'),
  })
  .strict();
export const researchBriefBlockSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
    text: z.string().trim().min(1).max(2000),
    kind: z.enum(['reported', 'analysis', 'estimate']),
    support: z.literal('unreviewed'),
    /** Reported event/measurement period; never fabricated from the capture date. */
    timeWindow: z.string().trim().min(1).max(240).nullable(),
    citations: z.array(researchBriefCitationSchema).max(3),
    method: z.string().trim().min(1).max(500).nullable().optional(),
    assumptions: z.array(z.string().trim().min(1).max(500)).max(6).optional(),
  })
  .strict()
  .superRefine((block, context) => {
    if (block.kind === 'reported' && !block.citations.length)
      context.addIssue({
        code: 'custom',
        message: 'Reported notes require their own source links',
      });
    if (block.kind === 'estimate' && (!block.method || !block.assumptions?.length))
      context.addIssue({
        code: 'custom',
        message: 'Estimated notes require a method and explicit assumptions',
      });
  });
export const researchBriefSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            section: researchBriefSectionSchema,
            blocks: z.array(researchBriefBlockSchema).min(1).max(6),
          })
          .strict(),
      )
      .min(1)
      .max(4)
      .refine(
        (sections) => new Set(sections.map((section) => section.section)).size === sections.length,
        'Research sections must be unique',
      ),
    openQuestions: z.array(z.string().trim().min(1).max(500)).max(8),
    limitations: z.array(z.string().trim().min(1).max(500)).max(8),
  })
  .strict()
  .refine((brief) => {
    const blocks = brief.sections.flatMap((section) => section.blocks);
    return new Set(blocks.map((block) => block.id)).size === blocks.length;
  }, 'Research note identities must be unique')
  .refine(
    (brief) => new TextEncoder().encode(JSON.stringify(brief)).byteLength <= 128 * 1024,
    'Retained research brief exceeds the 128 KiB limit',
  );
export type ResearchBrief = z.infer<typeof researchBriefSchema>;
