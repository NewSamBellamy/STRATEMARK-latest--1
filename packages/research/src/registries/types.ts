/**
 * Free, keyless structured-registry adapters — shared types.
 *
 * Product law: never fabricate. Every fact carries an exact value, unit, asOf
 * (or null + `undated`), a human-visible record URL and a methodNote naming the
 * registry. No fact is ever returned for an entity whose identity is not
 * confirmed by the adapter's own evidence rule.
 */
import type { MetricType } from '@mi/contracts';

export type RegistryId = 'wikidata' | 'brreg' | 'fr-entreprises';

/** `revenue` is not (yet) a contracts MetricType, so it is carried as its own key. */
export type RegistryMetricKey = MetricType | 'revenue';

/** What we already know about the company before asking registries. */
export interface EntityIdentity {
  name: string;
  /** Known website host or URL (example.com, www.example.com, https://example.com/x). */
  domain?: string | null;
  /** ISO 3166-1 alpha-2, upper-case. */
  country?: string | null;
  /** Usually learned from a JSON-LD sameAs link on the company's own homepage. */
  wikidataQid?: string | null;
  lei?: string | null;
  orgnr?: string | null;
  siren?: string | null;
  ticker?: string | null;
}

/** How the registry record was tied to the entity. */
export type IdentityEvidence =
  | { kind: 'domain-match'; domain: string; matchedOn: string }
  | { kind: 'jsonld-sameas'; qid: string }
  | { kind: 'exact-legal-name'; legalName: string }
  | { kind: 'name-and-domain'; legalName: string; domain: string };

export interface RegistryFact {
  registry: RegistryId;
  metric: RegistryMetricKey;
  /** The contracts MetricType when one exists (employees), else null (revenue). */
  metricType: MetricType | null;
  /** Exact point value; null when the registry only publishes a band. */
  value: number | null;
  /** Headcount band (INSEE). `max: null` = open-ended ("10 000 and over"). */
  band: { min: number; max: number | null } | null;
  /** 'employees' for headcounts, otherwise ISO 4217 code in the NATIVE currency. */
  unit: string;
  /** Date as the registry states it (YYYY, YYYY-MM or YYYY-MM-DD), or null. */
  asOf: string | null;
  /** True when asOf is null — wiring must flag, not invent, a date. */
  undated: boolean;
  /** Human-visible page for this specific record. */
  sourceUrl: string;
  /** Machine/API record URL when it differs from sourceUrl. */
  apiUrl?: string;
  /** Registry's own cited reference (Wikidata P854) when present. */
  referenceUrl?: string | null;
  /** Display label, e.g. "100–199 employees (INSEE band, 2023)". */
  label?: string;
  /** False for bands: wiring must not print a single point number on a card face. */
  cardFaceSafe: boolean;
  /** Names the registry + record, e.g. "Wikidata Q123 (P1128 number of employees)". */
  methodNote: string;
  identity: IdentityEvidence;
}

/** Identity extras learned for free while confirming the entity. */
export interface IdentityEnrichment {
  wikidataQid?: string;
  lei?: string;
  orgnr?: string;
  siren?: string;
  ticker?: string;
  logoUrl?: string;
  website?: string;
  sameAs?: string[];
  foundingDate?: string;
}

export type AdapterStatusKind = 'matched' | 'no-match' | 'error' | 'skipped';

export interface AdapterStatus {
  registry: RegistryId;
  status: AdapterStatusKind;
  reason?: string;
  ms?: number;
}

export interface RegistryContext {
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
}

export interface AdapterResult {
  status: 'matched' | 'no-match';
  reason?: string;
  facts: RegistryFact[];
  enrichment: IdentityEnrichment;
}

export interface RegistrySource {
  id: RegistryId;
  applies(identity: EntityIdentity): boolean;
  lookup(identity: EntityIdentity, ctx: RegistryContext): Promise<AdapterResult>;
}

export interface RegistryLookupResult {
  facts: RegistryFact[];
  enrichment: IdentityEnrichment;
  statuses: AdapterStatus[];
}

export function noMatch(reason: string): AdapterResult {
  return { status: 'no-match', reason, facts: [], enrichment: {} };
}
