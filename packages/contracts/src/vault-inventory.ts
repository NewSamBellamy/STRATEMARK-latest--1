/** Retained inventory metadata, not identity proof or operational approval. */
import { z } from 'zod';
import { scopeDraftSchema } from './actions';
import { brandThemeSchema, scopeDefinitionSchema } from './schemas';
import { recordVersionSchema } from './vault-evidence';

const id = recordVersionSchema.innerType().shape.id;
const label = z.string().trim().min(1).max(240);
const domain = z
  .string()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/i);
const uniqueHints = (item: z.ZodString) =>
  z
    .array(item)
    .max(50)
    .refine(
      (items) => new Set(items.map((value) => value.toLowerCase())).size === items.length,
      'Identity hints must be unique',
    );
const webUrl = z
  .string()
  .max(8192)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  }, 'Profile URLs must be credential-free HTTP(S) references');

export const vaultCompanySchema = z
  .object({
    record: recordVersionSchema,
    name: label,
    officialDomain: domain.nullable(),
    // Optional for pre-context vault records; absence is not invented empty research.
    profile: z
      .object({
        oneLiner: z.string().max(20_000),
        hqLocation: z.string().max(500).nullable(),
        websiteUrl: webUrl.nullable(),
        logoUrl: webUrl.nullable(),
        brandTheme: brandThemeSchema.strict().nullable(),
      })
      .strict()
      .optional(),
    // Candidates only. Never use these fields alone to merge/rekey companies.
    identityHints: z
      .object({ aliases: uniqueHints(label), domains: uniqueHints(domain) })
      .strict()
      .optional(),
  })
  .strict();
export type VaultCompany = z.infer<typeof vaultCompanySchema>;

export const vaultMarketSchema = z
  .object({
    record: recordVersionSchema,
    name: label,
    scopeDraft: scopeDraftSchema.optional(),
    // Original framing is retained separately, not fabricated into confirmed scope.
    legacyScope: scopeDefinitionSchema.strict().optional(),
  })
  .strict();
export type VaultMarket = z.infer<typeof vaultMarketSchema>;

export const vaultMembershipSchema = z
  .object({
    record: recordVersionSchema,
    marketId: id,
    companyId: id,
    roles: z
      .array(z.enum(['company', 'infrastructure', 'distribution']))
      .min(1)
      .max(3)
      .refine((roles) => new Set(roles).size === roles.length),
  })
  .strict();
export type VaultMembership = z.infer<typeof vaultMembershipSchema>;
