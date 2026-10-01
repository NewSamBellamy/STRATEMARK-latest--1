import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  DASHBOARD_TABS,
  ENTITY_CARD_TYPES,
  cardTypeSchema,
  cardSchema,
  companySchema,
  companyMetricSchema,
  deckSchema,
  marketSchema,
  viceClaimSchema,
  citationSchema,
  researchThreadSchema,
  isEntityCardType,
} from '@mi/contracts';
import { migrateSnapshot, REPO_SCHEMA_VERSION, type RepoSnapshot } from '@mi/research';
import { legacySnapshotSchema } from './storage';

type ErrorCode =
  | 'INVALID_JSON'
  | 'SOURCE_LIMIT'
  | 'DUPLICATE_MEMBER'
  | 'CREDENTIAL_FIELD'
  | 'UNSUPPORTED_FORMAT'
  | 'UNSUPPORTED_FIELD'
  | 'INVALID_RECORD'
  | 'DUPLICATE_ID'
  | 'MISSING_REFERENCE';

export class SnapshotInspectionError extends Error {
  constructor(
    readonly code: ErrorCode,
    location = 'snapshot',
  ) {
    // Location is a hardcoded family name, never a source value or JSON error payload.
    super(`Research inspection refused ${location}: ${code}. The original was not changed.`);
    this.name = 'SnapshotInspectionError';
  }
}

const arrayFamilies = [
  'markets',
  'decks',
  'companies',
  'metrics',
  'cards',
  'viceClaims',
  'reports',
  'briefings',
  'savedCards',
  'researchJobs',
  'threads',
] as const;
const mapFamilies = ['dashboards', 'companyMarket', 'opportunity'] as const;
const knownFields = new Set<string>(['schemaVersion', ...arrayFamilies, ...mapFamilies]);
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const at = z.string().datetime({ offset: true });
const citations = z.array(citationSchema.passthrough());
const report = z
  .object({
    id,
    kind: z.enum(['deck', 'company', 'site_audit']),
    subjectId: z.string().min(1),
    title: z.string(),
    markdown: z.string(),
    citations,
    createdAt: at,
    evidenceDigest: z.string().optional(),
    evidenceCitations: citations.optional(),
  })
  .passthrough();
const briefing = z
  .object({
    id,
    marketId: id,
    deckId: id,
    marketName: z.string(),
    generatedAt: at,
    windowHours: z.number().finite().positive(),
    headline: z.string(),
    updates: z.array(
      z
        .object({
          companyId: id.nullable(),
          companyName: z.string(),
          signal: z.enum(['high', 'notable']),
          oneLiner: z.string(),
          detail: z.string(),
          publishedDate: z.string().nullable(),
          citations,
        })
        .passthrough(),
    ),
    insights: z.array(z.string()),
  })
  .passthrough();
const partialCard = z
  .object({
    card: cardSchema.passthrough(),
    company: companySchema.passthrough().nullable(),
    metrics: z.array(companyMetricSchema.passthrough()),
    viceClaims: z.array(viceClaimSchema.passthrough()),
  })
  .passthrough();
// Older history can predate the richer job metadata. Present fields still validate.
const job = z
  .object({
    id,
    status: z.enum(['queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled']),
    stage: z.enum(['scope', 'catalog', 'summary', 'metrics', 'signals', 'dashboard']).optional(),
    brief: z.object({ prompt: z.string(), region: z.string().nullable() }).passthrough().optional(),
    market: marketSchema.passthrough().optional(),
    deck: deckSchema.passthrough().optional(),
    marketPlan: z
      .object({
        marketName: z.string(),
        vertical: z.string(),
        geography: z.string().nullable(),
        notes: z.string().nullable(),
        searchThemes: z.array(z.string()),
      })
      .passthrough()
      .optional(),
    catalog: z
      .array(
        z
          .object({
            name: z.string(),
            domain: z.string().nullable(),
            descriptor: z.string(),
            cardTypes: z.array(cardTypeSchema),
            primaryRole: z.enum(ENTITY_CARD_TYPES).optional(),
          })
          .passthrough(),
      )
      .optional(),
    catalogNames: z.array(z.string()).optional(),
    completedEntityNames: z.array(z.string()).optional(),
    partialCards: z.array(partialCard).optional(),
    warnings: z.array(z.string()).optional(),
    error: z.string().nullable().optional(),
    createdAt: at.optional(),
    updatedAt: at.optional(),
  })
  .passthrough();
const extraSchemas = {
  reports: report,
  briefings: briefing,
  savedCards: z.object({ cardId: id, savedAt: at }).passthrough(),
  researchJobs: job,
  threads: researchThreadSchema.passthrough(),
};
const credentialFields = new Set([
  'apikey',
  'accesskey',
  'secretkey',
  'privatekey',
  'accesstoken',
  'refreshtoken',
  'token',
  'password',
  'credentials',
  'authorization',
  'clientsecret',
]);

/** Bound/inspect lexical structure before JSON.parse can silently discard duplicate members. */
function inspectJson(json: string) {
  if (json.length > 50 * 1024 * 1024 || Buffer.byteLength(json, 'utf8') > 50 * 1024 * 1024)
    throw new SnapshotInspectionError('SOURCE_LIMIT');
  if (Buffer.from(json, 'utf8').toString('utf8') !== json)
    throw new SnapshotInspectionError('INVALID_JSON');
  const stack: { kind: 'object' | 'array'; keys: Set<string> }[] = [];
  let tokens = 0;
  for (let i = 0; i < json.length; i += 1) {
    const char = json[i];
    if (char === '"') {
      const start = i;
      let closed = false;
      for (i += 1; i < json.length; i += 1) {
        if (json[i] === '\\') i += 1;
        else if (json[i] === '"') {
          closed = true;
          break;
        }
      }
      if (!closed) throw new SnapshotInspectionError('INVALID_JSON');
      let next = i + 1;
      while (/\s/.test(json[next] ?? '') && next < json.length) next += 1;
      const parent = stack.at(-1);
      if (json[next] === ':' && parent?.kind === 'object') {
        let key: string;
        try {
          key = JSON.parse(json.slice(start, i + 1)) as string;
        } catch {
          throw new SnapshotInspectionError('INVALID_JSON');
        }
        if (parent.keys.has(key)) throw new SnapshotInspectionError('DUPLICATE_MEMBER');
        parent.keys.add(key);
        if (credentialFields.has(key.replace(/[_-]/g, '').toLowerCase()))
          throw new SnapshotInspectionError('CREDENTIAL_FIELD');
      }
      tokens += 1;
    } else if (char === '{' || char === '[') {
      stack.push({ kind: char === '{' ? 'object' : 'array', keys: new Set() });
      if (stack.length > 64) throw new SnapshotInspectionError('SOURCE_LIMIT');
      tokens += 1;
    } else if (char === '}' || char === ']') stack.pop();
    else if (char === ',') tokens += 1;
    if (tokens > 200_000) throw new SnapshotInspectionError('SOURCE_LIMIT');
  }
  try {
    return JSON.parse(json, (_key, value: unknown) => {
      if (typeof value === 'number' && !Number.isFinite(value))
        throw new SnapshotInspectionError('INVALID_RECORD');
      return value;
    }) as unknown;
  } catch (error) {
    if (error instanceof SnapshotInspectionError) throw error;
    throw new SnapshotInspectionError('INVALID_JSON');
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validate(schema: z.ZodTypeAny, value: unknown, family: string) {
  if (!schema.safeParse(value).success) throw new SnapshotInspectionError('INVALID_RECORD', family);
}
function uniqueIds(rows: readonly { id: string }[], family: string) {
  const ids = new Set<string>();
  for (const row of rows) {
    validate(id, row.id, family);
    if (ids.has(row.id)) throw new SnapshotInspectionError('DUPLICATE_ID', family);
    ids.add(row.id);
  }
  return ids;
}
function reference(ids: ReadonlySet<string>, value: string, family: string) {
  if (!ids.has(value)) throw new SnapshotInspectionError('MISSING_REFERENCE', family);
}
function domain(url: string | null) {
  const value = url?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed.hostname
          .toLowerCase()
          .replace(/^www\./, '')
          .replace(/\.$/, '')
      : null;
  } catch {
    return null;
  }
}

/**
 * Internal, offline A44 preparation only. No files, provider calls or vault writes.
 * snapshot/originalJson are local staging inputs, NOT renderer/MCP read results or
 * runnable repository hydration. canApply stays false until full staged retention,
 * asset checks and the trusted approval/cutover boundary exist.
 */
export function inspectLegacySnapshot(json: string) {
  const raw = inspectJson(json);
  if (!object(raw)) throw new SnapshotInspectionError('UNSUPPORTED_FORMAT');
  const version = Object.hasOwn(raw, 'schemaVersion') ? raw.schemaVersion : 1;
  if (
    REPO_SCHEMA_VERSION !== 2 ||
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > 2
  )
    throw new SnapshotInspectionError('UNSUPPORTED_FORMAT');
  if (Object.keys(raw).some((key) => !knownFields.has(key)))
    throw new SnapshotInspectionError('UNSUPPORTED_FIELD');
  for (const family of arrayFamilies) {
    if (raw[family] !== undefined && !Array.isArray(raw[family]))
      throw new SnapshotInspectionError('INVALID_RECORD', family);
  }
  for (const family of mapFamilies) {
    if (raw[family] !== undefined && !object(raw[family]))
      throw new SnapshotInspectionError('INVALID_RECORD', family);
  }
  for (const [family, schema] of Object.entries(extraSchemas)) {
    const rows = raw[family] as unknown[] | undefined;
    for (const row of rows ?? []) validate(schema, row, family);
  }
  validate(legacySnapshotSchema, raw, 'snapshot');
  let snapshot: RepoSnapshot;
  try {
    // Validation must not substitute the schema's parsed output: nested legacy
    // fields can carry research meaning absent from today's display contract.
    snapshot = migrateSnapshot(raw as unknown as RepoSnapshot).snapshot;
  } catch {
    throw new SnapshotInspectionError('INVALID_RECORD');
  }

  const markets = uniqueIds(snapshot.markets, 'markets');
  const decks = uniqueIds(snapshot.decks, 'decks');
  const companies = uniqueIds(snapshot.companies, 'companies');
  uniqueIds(snapshot.metrics, 'metrics');
  const cards = uniqueIds(snapshot.cards, 'cards');
  uniqueIds(snapshot.viceClaims, 'viceClaims');
  const reports = uniqueIds(snapshot.reports, 'reports');
  uniqueIds(snapshot.briefings, 'briefings');
  uniqueIds(snapshot.researchJobs, 'researchJobs');
  uniqueIds(snapshot.threads, 'threads');
  uniqueIds(
    snapshot.savedCards.map((row) => ({ id: row.cardId })),
    'savedCards',
  );
  const deckById = new Map(snapshot.decks.map((row) => [row.id, row]));
  const cardById = new Map(snapshot.cards.map((row) => [row.id, row]));
  for (const row of snapshot.decks) reference(markets, row.marketId, 'decks');
  for (const row of snapshot.metrics) reference(companies, row.companyId, 'metrics');
  for (const row of snapshot.cards) {
    reference(decks, row.deckId, 'cards');
    if (row.companyId !== null) reference(companies, row.companyId, 'cards');
    if (isEntityCardType(row.cardType) && row.companyId === null)
      throw new SnapshotInspectionError('MISSING_REFERENCE', 'cards');
  }
  for (const row of snapshot.viceClaims) reference(cards, row.cardId, 'viceClaims');
  for (const row of snapshot.savedCards) reference(cards, row.cardId, 'savedCards');
  for (const row of snapshot.reports) {
    if (row.kind === 'deck') reference(decks, row.subjectId, 'reports');
    if (row.kind === 'company') reference(companies, row.subjectId, 'reports');
    // A site-audit subject can be an external URL, not a fabricated company ID.
  }
  for (const row of snapshot.briefings) {
    reference(markets, row.marketId, 'briefings');
    reference(decks, row.deckId, 'briefings');
    if (deckById.get(row.deckId)?.marketId !== row.marketId)
      throw new SnapshotInspectionError('MISSING_REFERENCE', 'briefings');
    for (const update of row.updates)
      if (update.companyId !== null) reference(companies, update.companyId, 'briefings');
  }
  for (const row of snapshot.threads) {
    if (row.scope.deckId !== null) reference(decks, row.scope.deckId, 'threads');
    if (row.scope.companyId) reference(companies, row.scope.companyId, 'threads');
    for (const cardId of row.scope.cardIds ?? []) {
      reference(cards, cardId, 'threads');
      if (row.scope.deckId !== null && cardById.get(cardId)?.deckId !== row.scope.deckId)
        throw new SnapshotInspectionError('MISSING_REFERENCE', 'threads');
    }
    if (row.reportId) reference(reports, row.reportId, 'threads');
    if (row.semanticMemory) {
      if (row.semanticMemory.threadId !== row.id)
        throw new SnapshotInspectionError('MISSING_REFERENCE', 'threads');
      uniqueIds(row.semanticMemory.distilledFacts, 'threads');
      for (const fact of row.semanticMemory.distilledFacts)
        if (fact.companyId) reference(companies, fact.companyId, 'threads');
    }
    uniqueIds(row.messages, 'threads');
  }
  // Uncommitted partial company/deck/market records can live ONLY inside a job.
  // Validate those links locally without promoting them into the main inventory.
  for (const row of snapshot.researchJobs) {
    uniqueIds(
      row.partialCards.map((partial) => partial.card),
      'researchJobs',
    );
    const jobMarkets = new Set(markets),
      jobDecks = new Set(decks);
    if (row.market) jobMarkets.add(row.market.id);
    if (row.deck) {
      jobDecks.add(row.deck.id);
      reference(jobMarkets, row.deck.marketId, 'researchJobs');
    }
    const jobCompanies = new Set(companies);
    for (const partial of row.partialCards)
      if (partial.company) jobCompanies.add(partial.company.id);
    const jobCards = new Set(cards);
    for (const partial of row.partialCards) jobCards.add(partial.card.id);
    for (const partial of row.partialCards) {
      reference(jobDecks, partial.card.deckId, 'researchJobs');
      if (partial.card.companyId !== null)
        reference(jobCompanies, partial.card.companyId, 'researchJobs');
      if (partial.company && partial.card.companyId !== partial.company.id)
        throw new SnapshotInspectionError('MISSING_REFERENCE', 'researchJobs');
      for (const metric of partial.metrics)
        reference(jobCompanies, metric.companyId, 'researchJobs');
      for (const claim of partial.viceClaims) reference(jobCards, claim.cardId, 'researchJobs');
    }
  }
  let dashboardTabs = 0;
  for (const [companyId, tabs] of Object.entries(snapshot.dashboards)) {
    reference(companies, companyId, 'dashboards');
    if (!object(tabs)) throw new SnapshotInspectionError('INVALID_RECORD', 'dashboards');
    for (const [tab, cached] of Object.entries(tabs)) {
      if (!(DASHBOARD_TABS as readonly string[]).includes(tab))
        throw new SnapshotInspectionError('UNSUPPORTED_FIELD', 'dashboards');
      if (!object(cached) || !Object.hasOwn(cached, 'content'))
        throw new SnapshotInspectionError('INVALID_RECORD', 'dashboards');
      validate(at, cached.lastRefreshedAt, 'dashboards');
      dashboardTabs += 1;
    }
  }
  for (const [marketId, cached] of Object.entries(snapshot.opportunity)) {
    reference(markets, marketId, 'opportunity');
    validate(
      z.object({ markdown: z.string(), citations, at }).passthrough(),
      cached,
      'opportunity',
    );
  }

  type Role = (typeof ENTITY_CARD_TYPES)[number];
  const membershipByKey = new Map<
    string,
    { companyId: string; marketId: string; roles: Role[]; basis: 'card_link' | 'legacy_name' }
  >();
  const linkedCompanies = new Set<string>();
  for (const row of snapshot.cards) {
    if (!isEntityCardType(row.cardType) || row.companyId === null) continue;
    const marketId = deckById.get(row.deckId)!.marketId;
    const key = `${row.companyId}\0${marketId}`;
    const existing = membershipByKey.get(key);
    const roles = new Set<Role>([...(existing?.roles ?? []), row.cardType as Role]);
    membershipByKey.set(key, {
      companyId: row.companyId,
      marketId,
      roles: ENTITY_CARD_TYPES.filter((role) => roles.has(role)),
      basis: 'card_link',
    });
    linkedCompanies.add(row.companyId);
  }
  let unresolvedCompanyMarketCount = 0;
  const marketsByName = new Map<string, string[]>();
  for (const row of snapshot.markets) {
    const group = marketsByName.get(row.name) ?? [];
    group.push(row.id);
    marketsByName.set(row.name, group);
  }
  for (const [companyId, marketName] of Object.entries(snapshot.companyMarket)) {
    reference(companies, companyId, 'companyMarket');
    if (linkedCompanies.has(companyId)) continue;
    const candidates = marketsByName.get(marketName) ?? [];
    if (candidates.length !== 1) {
      unresolvedCompanyMarketCount += 1;
      continue;
    }
    const marketId = candidates[0]!;
    membershipByKey.set(`${companyId}\0${marketId}`, {
      companyId,
      marketId,
      roles: ['company'],
      basis: 'legacy_name',
    });
  }
  const identityReview: { companyIds: string[]; reason: 'same_name' | 'same_domain' }[] = [];
  for (const reason of ['same_name', 'same_domain'] as const) {
    const groups = new Map<string, string[]>();
    for (const row of snapshot.companies) {
      const key =
        reason === 'same_name'
          ? row.name.trim().normalize('NFKC').toLowerCase()
          : domain(row.websiteUrl);
      if (key) {
        const group = groups.get(key) ?? [];
        group.push(row.id);
        groups.set(key, group);
      }
    }
    for (const companyIds of groups.values())
      if (companyIds.length > 1) identityReview.push({ companyIds, reason });
  }
  let attributedAttestationCount = 0;
  const logos = new Set<string>();
  const pending: unknown[] = [raw];
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) for (const item of value) pending.push(item);
    else if (object(value)) {
      if (value.confidence === 'user_verified' || value.userVerified === true)
        attributedAttestationCount += 1;
      if (typeof value.logoUrl === 'string' && value.logoUrl) logos.add(value.logoUrl);
      for (const item of Object.values(value)) pending.push(item);
    }
  }
  const counts = {
    ...Object.fromEntries(arrayFamilies.map((family) => [family, snapshot[family].length])),
    ...Object.fromEntries(
      mapFamilies.map((family) => [family, Object.keys(snapshot[family]).length]),
    ),
    dashboardTabs,
  } as Record<
    (typeof arrayFamilies)[number] | (typeof mapFamilies)[number] | 'dashboardTabs',
    number
  >;
  return {
    source: {
      schemaVersion: version,
      byteLength: Buffer.byteLength(json, 'utf8'),
      sha256: createHash('sha256').update(json).digest('hex'),
    },
    appliedVersions: version === 1 ? [1] : [],
    originalJson: json,
    snapshot,
    counts,
    memberships: [...membershipByKey.values()],
    identityReview,
    review: {
      activeJobCount: snapshot.researchJobs.filter(
        (row) => row.status === 'queued' || row.status === 'running' || row.status === 'cancelling',
      ).length,
      attributedAttestationCount,
      externalLogoCount: logos.size,
      unresolvedCompanyMarketCount,
      supportedPassageCount: 0,
    },
    warnings: [
      'authority_disabled',
      'missing_evidence',
      'scope_review',
      ...(logos.size ? ['missing_assets'] : []),
    ],
    proposedAuthority: {
      runnableJobs: 0,
      schedules: 0,
      grants: 0,
      budgetApprovals: 0,
      localAttestations: 0,
      requiresFreshApproval: true,
    },
    canApply: false,
  } as const;
}
