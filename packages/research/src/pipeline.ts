/**
 * The agentic research pipeline (a typed task graph, not literal LangGraph —
 * same idea, dependency-free and running in browser + Electron):
 *
 *   interpret ─▶ discover ─▶ enrich (fan-out, concurrency-gated) ─▶ score ─▶ assemble
 *                        └─▶ barriers ────────────────────────────────────┘
 *
 * "Every card is a search query": discovery is one grounded search; each company
 * is a grounded search (enrich) + a structuring pass; barriers are a grounded
 * search. Nothing factual comes from training data — only from grounded results,
 * and every figure is tagged verified / estimated / unknown with a citation.
 */
import type { infer as ZodInfer } from 'zod';
import {
  buildCmsInput,
  comparableMetricBasis,
  computeCms,
  type Card,
  type CardType,
  type CardWithCompany,
  type Company,
  type CompanyMetric,
  type Deck,
  type Market,
  type MaturityTier,
  isEntityCardType,
} from '@mi/contracts';
import {
  discoveryMinimumOutSchema,
  discoveryOutSchema,
  marketPlanOutSchema,
  tierReviewBatchOutSchema,
} from './schemas';
import {
  GROUNDED_SYSTEM,
  STRUCTURE_SYSTEM,
  discoverPrompt,
  type DiscoveryFocus,
  interpretMarketPrompt,
  structureDiscoveryPrompt,
  structureMarketPrompt,
  tierReviewBatchPrompt,
} from './prompts';
import type {
  CompanyCandidate,
  LlmClient,
  MarketPlan,
  OnResearchEvent,
  ResearchBrief,
  ResearchCoverage,
  RunResearchOptions,
} from './types';
import { faviconUrl } from './logos';
import {
  AbortError, mapWithConcurrency, rootDomain, slugify, throwIfAborted
} from './util';
import {
  hydrateCompanyCard,
  primaryEntityType,
  type HydrateCompanyCardResult,
} from './company-agent';
import { researchMarketSignals } from './signal-agents';
import { expandDeckWithDeltaAgent } from './delta-agent';
import type { OriginalSourceServices } from './original-source';

export interface ResearchResult {
  market: Market;
  deck: Deck;
  cards: CardWithCompany[];
}

export interface DeckStubsResult {
  plan: MarketPlan;
  market: Market;
  deck: Deck;
  candidates: CompanyCandidate[];
  cards: CardWithCompany[];
  rejected: string[];
  minimumCompaniesSatisfied: boolean;
}

export interface HydrateDeckCardsOptions {
  originalSources?: OriginalSourceServices;
  concurrency?: number;
  coverage?: Partial<ResearchCoverage>;
  signal?: AbortSignal;
  onEvent?: OnResearchEvent;
  onCardHydrated?: (result: HydrateCompanyCardResult) => Promise<void> | void;
  onMarketSignals?: (cards: CardWithCompany[]) => Promise<void> | void;
  existingCompletedCards?: CardWithCompany[];
}

const uid = (prefix: string, slug: string): string =>
  `${prefix}_${slug}_${Math.random().toString(36).slice(2, 7)}`;

const now = (): string => new Date().toISOString();

async function interpret(
  client: LlmClient,
  brief: ResearchBrief,
  signal?: AbortSignal,
): Promise<MarketPlan> {
  const grounded = await client.ground(interpretMarketPrompt(brief.prompt, brief.region), {
    system: GROUNDED_SYSTEM,
    signal,
  });
  const plan = await client.structure(
    structureMarketPrompt(grounded.text, brief.prompt),
    marketPlanOutSchema,
    {
    system: STRUCTURE_SYSTEM,
    signal,
    },
  );
  return {
    marketName: plan.marketName,
    vertical: plan.vertical,
    geography: plan.geography ?? brief.region,
    notes: plan.notes,
    searchThemes: plan.searchThemes,
    companyScope: brief.companyScope
      ? {
          mode: brief.companyScope.mode,
          names: brief.companyScope.mode === 'selected_only'
            ? [...new Set(brief.companyScope.names.map((name) => name.trim()).filter(Boolean))].slice(0, 30)
            : [],
        }
      : plan.companyScope,
  };
}

function identityKeys(name: string, domain: string | null): string[] {
  const nameKey = name
    .toLowerCase()
    .replace(
      /\b(incorporated|corporation|company|limited|holdings|group|inc|llc|ltd|corp|plc|ag)\b/g,
      '',
    )
    .replace(/[^a-z0-9]/g, '');
  const domainKey = domain ? rootDomain(domain) : null;
  return [nameKey, ...(domainKey ? [domainKey] : [])];
}

const DEFAULT_COVERAGE: ResearchCoverage = {
  // max raised 20 -> 30: the deck must never hard-stop while the user wants
  // more coverage; 'Hunt for more' can keep expanding to this ceiling.
  companies: { min: 10, target: 12, max: 30 },
  infrastructure: { min: 4, target: 6, max: 10 },
  distribution: { min: 2, target: 4, max: 10 },
  vice: { min: 4, target: 4, max: 10 },
  culture: { min: 4, target: 4, max: 10 },
  barrier: { min: 4, target: 6, max: 10 },
  insight: { min: 4, target: 6, max: 10 },
};

function resolveCoverage(options?: Partial<RunResearchOptions>): ResearchCoverage {
  const requested = options?.coverage ?? {};
  const companies = requested.companies ?? DEFAULT_COVERAGE.companies;
  // The legacy option is a total entity target. Keep it as a safe override for
  // callers, but never let it reduce the hard company minimum.
  const targetCompanies = Math.max(options?.targetCompanies ?? companies.target, companies.min);
  return {
    ...DEFAULT_COVERAGE,
    ...requested,
    companies: {
      ...companies,
      target: targetCompanies,
      max: Math.max(companies.max, targetCompanies),
    },
  };
}

async function discover(
  client: LlmClient,
  plan: MarketPlan,
  target: number,
  signal?: AbortSignal,
  focus: DiscoveryFocus = 'all',
  excludeNames: string[] = [],
  searchAngle?: string,
  exactCompanyNames: string[] = [],
): Promise<{ candidates: CompanyCandidate[]; rejected: string[] }> {
  const grounded = await client.ground(
    discoverPrompt(plan, target, focus, excludeNames, searchAngle, exactCompanyNames),
    {
      system: GROUNDED_SYSTEM,
      signal,
    },
  );
  const structureOptions = { system: STRUCTURE_SYSTEM, signal };
  let out: { companies: ZodInfer<typeof discoveryOutSchema>['companies'] };
  if (focus === 'all' && target >= 10) {
    try {
      // The primary schema is intentionally strict: a successful primary pass is
      // already guaranteed to contain ten unique companies. Underfill is handled
      // by the bounded fallback below rather than by inventing rows.
    out = await client.structure(
      structureDiscoveryPrompt(grounded.text, focus, exactCompanyNames),
      discoveryMinimumOutSchema,
        structureOptions,
      );
    } catch (err) {
      // An abort is a decision, not a schema failure — never retry past it.
      if (err instanceof AbortError) throw err;
      out = await client.structure(
        structureDiscoveryPrompt(grounded.text, focus, exactCompanyNames),
        discoveryOutSchema,
        structureOptions,
      );
    }
  } else {
    out = await client.structure(
      structureDiscoveryPrompt(grounded.text, focus, exactCompanyNames),
      discoveryOutSchema,
      structureOptions,
    );
  }
  const seen = new Set(excludeNames.flatMap((name) => identityKeys(name, null)));
  const candidates: CompanyCandidate[] = [];
  const rejected: string[] = [];
  for (const c of out.companies ?? []) {
    const name = c.name.trim();
    if (
      exactCompanyNames.length > 0 &&
      !exactCompanyNames.some((requested) => {
        const requestedKey = identityKeys(requested, null)[0] ?? '';
        const candidateKey = identityKeys(name, null)[0] ?? '';
        return requestedKey.length >= 3 &&
          (candidateKey === requestedKey || candidateKey.startsWith(requestedKey));
      })
    ) continue;
    const domain = rootDomain(c.domain);
    const keys = identityKeys(name, domain);
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    const rawTypes = (c.cardTypes ?? []) as CardType[];
    const cardTypes: CardType[] = rawTypes.filter((t) => t !== 'barrier' && t !== 'insight');

    // A signal-only candidate is valid only when it resolves to a real operating
    // entity. Otherwise it is a topic dressed as a company and is rejected.
    let facets = cardTypes;
    if (facets.length > 0 && !facets.some(isEntityCardType)) {
      if (!domain) {
        rejected.push(name);
        continue;
      }
      facets = ['company', ...facets];
    }
    // An exact-name request is about entity identity, not a request to force
    // every named business into the current discovery role. In particular, a
    // named hyperscaler may correctly resolve as infrastructure; dropping it
    // here silently turns an exact comparison into a partial deck.
    if (exactCompanyNames.length === 0 && focus !== 'all' && !facets.includes(focus as CardType)) continue;
    const descriptor = c.descriptor ?? '';
    const focusRole = exactCompanyNames.length === 0 && (
      focus === 'company' || focus === 'infrastructure' || focus === 'distribution'
    ) ? focus : undefined;
    const primaryRole = c.primaryRole ?? primaryEntityType(facets, name, descriptor, focusRole);
    if (!facets.includes(primaryRole)) facets = [primaryRole, ...facets];

    candidates.push({
      name,
      domain,
      descriptor,
      primaryRole,
      cardTypes: facets.length ? facets : ['company'],
    });
  }
  return { candidates, rejected };
}

function mergeCandidates(
  existing: CompanyCandidate[],
  additions: CompanyCandidate[],
): CompanyCandidate[] {
  const seen = new Set(existing.flatMap((c) => identityKeys(c.name, c.domain)));
  const merged = [...existing];
  for (const candidate of additions) {
    const keys = identityKeys(candidate.name, candidate.domain);
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    merged.push(candidate);
  }
  return merged;
}

export function selectCandidates(
  candidates: CompanyCandidate[],
  coverage: ResearchCoverage,
  maxCandidates = Number.POSITIVE_INFINITY,
): CompanyCandidate[] {
  const roles = ['company', 'infrastructure', 'distribution'] as const;
  const roleCoverage = {
    company: coverage.companies,
    infrastructure: coverage.infrastructure,
    distribution: coverage.distribution,
  };
  const groups = new Map(
    roles.map((role) => [
      role,
      candidates.filter(
        (c) => primaryEntityType(c.cardTypes, c.name, c.descriptor, c.primaryRole) === role,
      ),
    ]),
  );
  const selected: CompanyCandidate[] = [];
  for (const role of roles)
    selected.push(...(groups.get(role) ?? []).slice(0, roleCoverage[role].min));
  for (const role of roles) {
    const current = groups.get(role) ?? [];
    const already = new Set(selected.map((c) => identityKeys(c.name, c.domain)[0]));
    for (const candidate of current.slice(roleCoverage[role].min, roleCoverage[role].target)) {
      if (!already.has(identityKeys(candidate.name, candidate.domain)[0])) {
        selected.push(candidate);
        already.add(identityKeys(candidate.name, candidate.domain)[0]);
      }
    }
  }
  // Preserve signal-bearing entities while selecting the entity quotas. Signals
  // are facets on a company card, so dropping these candidates would make the
  // vice/culture minimum impossible even when discovery found credible evidence.
  for (const signalRole of ['vice', 'culture'] as const) {
    let count = selected.filter((c) => c.cardTypes.includes(signalRole)).length;
    if (count >= coverage[signalRole].min) continue;
    for (const candidate of candidates) {
      if (count >= coverage[signalRole].min) break;
      if (!candidate.cardTypes.includes(signalRole)) continue;
      const key = identityKeys(candidate.name, candidate.domain)[0]!;
      if (selected.some((c) => identityKeys(c.name, c.domain)[0] === key)) continue;
      selected.push(candidate);
      count += 1;
    }
  }
  const selectedKeys = new Set(
    selected.flatMap((candidate) => identityKeys(candidate.name, candidate.domain)),
  );
  for (const candidate of candidates) {
    if (selected.length >= maxCandidates) break;
    const keys = identityKeys(candidate.name, candidate.domain);
    if (keys.some((key) => selectedKeys.has(key))) continue;
    keys.forEach((key) => selectedKeys.add(key));
    selected.push(candidate);
  }
  return selected;
}

/** Phase 1 of deck construction: interpret the brief into a plan and the
 * durable market/deck rows. Exported so streaming callers can start their
 * hydration machinery before discovery begins. */
export async function interpretMarket(
  brief: ResearchBrief,
  client: LlmClient,
  signal?: AbortSignal,
): Promise<{ plan: MarketPlan; market: Market; deck: Deck }> {
  const plan = await interpret(client, brief, signal);
  const marketSlug = slugify(plan.marketName);
  const market: Market = {
    id: uid('mkt', marketSlug),
    name: plan.marketName,
    scopeDefinition: { vertical: plan.vertical, geography: plan.geography, notes: plan.notes },
    refreshCadence: 'weekly',
    createdAt: now(),
  };
  const deck: Deck = {
    id: uid('dck', marketSlug),
    marketId: market.id,
    createdAt: now(),
    lastRefreshedAt: now(),
  };
  return { plan, market, deck };
}

/** Phase 2 of deck construction: discover the market's entities. Streamed
 * variants hand each pass's NEW candidates to `onCandidates` so stubs can be
 * ingested and hydrated while later passes are still running. */
export async function discoverMarket(
  client: LlmClient,
  plan: MarketPlan,
  coverage: ResearchCoverage,
  signal?: AbortSignal,
  catalogMax = 50,
  catalogPasses = plan.searchThemes.length,
  onCandidates?: (batch: CompanyCandidate[]) => void,
): Promise<{
  candidates: CompanyCandidate[];
  rejected: string[];
  minimumCompaniesSatisfied: boolean;
}> {
  // Stream the SELECTION delta, not the raw discovery delta: selectCandidates
  // is monotonic-append on a growing candidate list (role minimums, targets and
  // the catalogMax cap only ever add), so everything streamed here is within
  // the final selection. Streaming raw candidates would hydrate entities the
  // catalog cap drops — pure spend with no card to show for it.
  const emitSelectionDelta = (previousSelected: CompanyCandidate[]) => {
    if (!onCandidates) return previousSelected;
    const selectedNow = selectCandidates(candidates, coverage, catalogMax);
    const known = new Set(previousSelected.map((c) => identityKeys(c.name, c.domain)[0]));
    const fresh = selectedNow.filter((c) => !known.has(identityKeys(c.name, c.domain)[0]));
    if (fresh.length) onCandidates(fresh);
    return selectedNow;
  };
  let candidates: CompanyCandidate[] = [];
  let selectedSoFar: CompanyCandidate[] = [];
  const rejected: string[] = [];
  const initial = await discover(
    client,
    plan,
    Math.min(
      catalogMax,
      coverage.companies.target + coverage.infrastructure.target + coverage.distribution.target,
    ),
    signal,
  );
  candidates = mergeCandidates(candidates, initial.candidates);
  selectedSoFar = emitSelectionDelta(selectedSoFar);
  rejected.push(...initial.rejected);

  const countRole = (role: 'company' | 'infrastructure' | 'distribution') =>
    candidates.filter(
      (c) => primaryEntityType(c.cardTypes, c.name, c.descriptor, c.primaryRole) === role,
    ).length;
  const countSignal = (role: 'vice' | 'culture') =>
    candidates.filter((c) => c.cardTypes.includes(role)).length;
  // Role-coverage fallbacks are deliberately INDEPENDENT of catalog search
  // angles. They used to sit behind `catalogPasses > 0`, which is derived from
  // `plan.searchThemes.length` — so any plan whose interpreter returned no
  // search themes (schemas.ts defaults searchThemes to []) silently skipped
  // every fallback pass and shipped a deck with zero infrastructure and zero
  // distribution entities. Coverage minimums are a contract, not an optimization.
  const fallbackPasses: { role: DiscoveryFocus; needed: number; target: number }[] = [
    { role: 'company', needed: coverage.companies.min, target: coverage.companies.target },
    {
      role: 'infrastructure',
      needed: coverage.infrastructure.min,
      target: coverage.infrastructure.target,
    },
    {
      role: 'distribution',
      needed: coverage.distribution.min,
      target: coverage.distribution.target,
    },
    { role: 'vice', needed: coverage.vice.min, target: coverage.vice.target },
    { role: 'culture', needed: coverage.culture.min, target: coverage.culture.target },
  ];
  for (const pass of fallbackPasses) {
    const current =
      pass.role === 'vice' || pass.role === 'culture'
        ? countSignal(pass.role)
        : countRole(pass.role as 'company' | 'infrastructure' | 'distribution');
    if (current >= pass.needed) continue;
    const fallback = await discover(
      client,
      plan,
      Math.min(pass.target, pass.needed - current + 2),
      signal,
      pass.role,
      candidates.map((c) => c.name),
    );
    candidates = mergeCandidates(candidates, fallback.candidates);
    selectedSoFar = emitSelectionDelta(selectedSoFar);
    rejected.push(...fallback.rejected);
  }

  // Catalog expansion searches each market angle independently. Stop when the
  // market has stopped yielding new identities twice in a row or the safety cap
  // is reached; this makes the census broad without turning one deck into an
  // unbounded free-tier job.
  let noGrowth = 0;
  for (const angle of plan.searchThemes.slice(0, catalogPasses)) {
    if (candidates.length >= catalogMax || noGrowth >= 2) break;
    const before = candidates.length;
    const pass = await discover(
      client,
      plan,
      Math.min(8, catalogMax - candidates.length),
      signal,
      'all',
      candidates.map((candidate) => candidate.name),
      angle,
    );
    candidates = mergeCandidates(candidates, pass.candidates);
    selectedSoFar = emitSelectionDelta(selectedSoFar);
    rejected.push(...pass.rejected);
    noGrowth = candidates.length === before ? noGrowth + 1 : 0;
  }

  const selected = selectCandidates(candidates, coverage, catalogMax);
  const companyNames = selected
    .filter(
      (candidate) =>
        primaryEntityType(
          candidate.cardTypes,
          candidate.name,
          candidate.descriptor,
          candidate.primaryRole,
        ) === 'company',
    )
    .map((candidate) => identityKeys(candidate.name, candidate.domain)[0]);
  const minimumCompaniesSatisfied = new Set(companyNames).size >= coverage.companies.min;
  return { candidates: selected, rejected, minimumCompaniesSatisfied };
}

/** Back-compat alias: discoverMarket is the same phase under its original name. */
export const discoverWithCoverage = discoverMarket;

/**
 * Review the whole cohort's tiers in ONE call.
 *
 * Replaces one structure call per company (10 calls on a 10-company deck → 1).
 * That matters against a 15 RPM free-tier ceiling, and it makes the ranking
 * better: the model compares companies against each other rather than judging
 * each in isolation. Falls back to "no nudges" on any failure — the
 * deterministic base tier is always a valid answer.
 */
export async function reviewTiersBatch(
  client: LlmClient,
  marketName: string,
  rows: { name: string; baseTier: MaturityTier; evidence: string }[],
  signal?: AbortSignal,
): Promise<Map<string, { nudge: -1 | 0 | 1; reason: string | null }>> {
  const out = new Map<string, { nudge: -1 | 0 | 1; reason: string | null }>();
  if (rows.length === 0) return out;
  try {
    const res = await client.structure(
      tierReviewBatchPrompt(marketName, rows),
      tierReviewBatchOutSchema,
      { system: STRUCTURE_SYSTEM, signal },
    );
    const byName = new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.name]));
    for (const r of res.reviews ?? []) {
      const key = byName.get((r.name ?? '').trim().toLowerCase());
      if (key) out.set(key, { nudge: r.nudge ?? 0, reason: r.reason ?? null });
    }
  } catch (err) {
    // A failed review must never fail the deck, but a cancelled run must stop:
    // swallowing the abort here kept the pipeline scoring tiers after cancel.
    if (err instanceof AbortError) throw err;
    /* otherwise keep the deterministic tiers */
  }
  return out;
}

/**
 * Market-level cards: structural barriers to entry AND the non-obvious dynamics
 * worth remembering (Insight cards). Delegated to the `signal-agents` deep module.
 */
export async function researchMarketCards(
  client: LlmClient,
  plan: MarketPlan,
  deckId: string,
  signal?: AbortSignal,
): Promise<CardWithCompany[]> {
  return researchMarketSignals(client, plan, deckId, { signal });
}

/**
 * Targeted micro-research to fill a gap in an existing deck (intelligent empty
 * states): delegates to the Incremental Delta Search Agent (`expandDeckWithDeltaAgent`).
 * Returns fully-assembled cards; the caller stamps deckId and ingests.
 */
export async function expandDeckResearch(args: {
  originalSources?: OriginalSourceServices;
  client: LlmClient;
  marketName: string;
  vertical: string;
  geography: string | null;
  focusPrompt: string;
  excludeNames: string[];
  deckId: string;
  deckUserValues: number[];
  target?: number;
  onEvent?: OnResearchEvent;
  signal?: AbortSignal;
}): Promise<CardWithCompany[]> {
  return expandDeckWithDeltaAgent({
    originalSources: args.originalSources,
    client: args.client,
    marketName: args.marketName,
    vertical: args.vertical,
    geography: args.geography,
    focusPrompt: args.focusPrompt,
    excludeNames: args.excludeNames,
    deckId: args.deckId,
    deckUserValues: args.deckUserValues,
    target: args.target,
    onEvent: args.onEvent,
    signal: args.signal,
  });
}

/**
 * Instant Deck Fast-Boot: Discovers initial candidate stubs (~2-3s).
 * Returns market, deck, candidates, and stub cards with placeholders so
 * UI can navigate immediately.
 */
export async function discoverDeckStubs(
  brief: ResearchBrief,
  client: LlmClient,
  options: Partial<RunResearchOptions> = {},
): Promise<DeckStubsResult> {
  const emit: OnResearchEvent = options.onEvent ?? (() => {});
  const signal = options.signal;
  const coverage = resolveCoverage(options);

  await emit({ type: 'status', step: 'interpret', message: 'Understanding the market…' });
  const { plan, market, deck } = await interpretMarket(brief, client, signal);
  // The interpreted trio streams before discovery so streamed stubs carry
  // real deck ids while fallback passes are still running.
  options.onInterpreted?.({ plan, market, deck });
  await emit({ type: 'market', market: plan });

  await emit({
    type: 'status',
    step: 'discover',
    message: 'Discovering companies via 3-vector Google ADK topology mapping…',
  });

  let candidates: CompanyCandidate[] = [];
  let rejected: string[] = [];
  let minimumCompaniesSatisfied = false;

  // Streaming: each discovery pass hands its NEW entities to the caller as
  // ingestible stub cards (stable ids, deduped by identity) while the next
  // pass is still running.
  const streamed: Array<{ stub: CardWithCompany; candidate: CompanyCandidate }> = [];
  const streamedKeys = new Set<string>();
  const streamStubs = (batch: CompanyCandidate[]) => {
    if (!options.onStubs) return;
    const fresh = batch.filter((candidate) => {
      const key = identityKeys(candidate.name, candidate.domain)[0]!;
      if (streamedKeys.has(key)) return false;
      streamedKeys.add(key);
      return true;
    });
    for (const candidate of fresh) {
      const entry = { stub: buildStubCard(candidate, deck), candidate };
      streamed.push(entry);
      options.onStubs([entry]);
    }
  };

  const exactCompanyNames = plan.companyScope?.mode === 'selected_only'
    ? [...new Set(plan.companyScope.names.map((name) => name.trim()).filter(Boolean))].slice(0, 30)
    : [];
  let marketMinimumSatisfied = false;
  if (exactCompanyNames.length > 0) {
    const discovery = await discover(
        client,
        plan,
        exactCompanyNames.length,
        signal,
        'company',
        [],
        undefined,
        exactCompanyNames,
      )
    candidates = discovery.candidates;
    rejected = discovery.rejected;
    streamStubs(candidates);
  } else {
    const discovery = await discoverMarket(
        client,
        plan,
        coverage,
        signal,
        options.catalogMax ?? 50,
        options.catalogPasses ?? 0,
        (batch) => streamStubs(batch),
      );
    candidates = discovery.candidates;
    rejected = discovery.rejected;
    marketMinimumSatisfied = discovery.minimumCompaniesSatisfied;
  }
  minimumCompaniesSatisfied = exactCompanyNames.length > 0
    ? exactCompanyNames.every((requested) => {
        const requestedKey = identityKeys(requested, null)[0] ?? '';
        return requestedKey.length >= 3 && candidates.some((candidate) =>
          (identityKeys(candidate.name, null)[0] ?? '').startsWith(requestedKey),
        );
      })
    : marketMinimumSatisfied;
  if (rejected.length > 0) {
    await emit({
      type: 'warning',
      message: `Skipped ${rejected.length} result${rejected.length === 1 ? '' : 's'} that ${rejected.length === 1 ? 'was' : 'were'} a topic rather than a company: ${rejected.join(', ')}.`,
    });
  }
  if (!minimumCompaniesSatisfied) {
    await emit({
      type: 'warning',
      message: exactCompanyNames.length > 0
        ? `Exact company scope was not fully resolved. Verified ${candidates.length} of ${exactCompanyNames.length} requested companies; no substitutes were added.`
        : `Primary discovery remained below the ${coverage.companies.min}-company minimum after bounded fallback passes. The deck will continue with sourced entities only.`,
    });
  }
  const roleCounts = {
    company: candidates.filter(
      (c) => primaryEntityType(c.cardTypes, c.name, c.descriptor, c.primaryRole) === 'company',
    ).length,
    infrastructure: candidates.filter(
      (c) =>
        primaryEntityType(c.cardTypes, c.name, c.descriptor, c.primaryRole) === 'infrastructure',
    ).length,
    distribution: candidates.filter(
      (c) =>
        primaryEntityType(c.cardTypes, c.name, c.descriptor, c.primaryRole) === 'distribution',
    ).length,
    vice: candidates.filter((c) => c.cardTypes.includes('vice')).length,
    culture: candidates.filter((c) => c.cardTypes.includes('culture')).length,
  };
  if (exactCompanyNames.length === 0) {
    for (const [role, count] of Object.entries(roleCounts)) {
      const minimum = coverage[role as keyof typeof coverage]?.min;
      if (minimum != null && count < minimum) {
        await emit({
          type: 'warning',
          message: `Coverage shortfall for ${role}: found ${count}, minimum is ${minimum}. No unsupported entities were invented.`,
        });
      }
    }
  }
  await emit({ type: 'candidates', candidates });

  // Finalize stub cards: reuse streamed stubs (their ids are already ingested
  // by the caller — new ids would duplicate companies) and build any that
  // were never streamed.
  const stubBySource = new Map(
    streamed.map((entry) => [identityKeys(entry.candidate.name, entry.candidate.domain)[0]!, entry.stub]),
  );
  const stubCards = candidates.map(
    (candidate) => stubBySource.get(identityKeys(candidate.name, candidate.domain)[0]!) ?? buildStubCard(candidate, deck),
  );

  return {
    plan,
    market,
    deck,
    candidates,
    cards: stubCards,
    rejected,
    minimumCompaniesSatisfied,
  };
}

/** Phase 3 of deck construction: candidates → ingestible placeholder cards.
 * Reuses stubs already built during streaming when the caller passes them. */
export function buildStubs(candidates: CompanyCandidate[], deck: Deck): CardWithCompany[] {
  return candidates.map((candidate) => buildStubCard(candidate, deck));
}

/** One candidate → one ingestible placeholder card with stable ids. Extracted
 * so discovery can stream stubs mid-flight and the final deck can reuse them. */
function buildStubCard(candidate: CompanyCandidate, deck: Deck): CardWithCompany {
  const slug = slugify(candidate.name);
  const companyId = uid('cmp', slug);
  const domain = candidate.domain ? rootDomain(candidate.domain) ?? candidate.domain : null;
  const website = candidate.domain ? `https://${candidate.domain}` : null;
  const logoUrl =
    faviconUrl(domain) ??
    faviconUrl('example.com') ??
    'https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://example.com&size=128';
  const company: Company = {
    id: companyId,
    name: candidate.name,
    oneLiner: candidate.descriptor || '',
    logoUrl,
    hqLocation: null,
    websiteUrl: website,
    brandTheme: {
      primary: '#4f46e5',
      secondary: '#a5b4fc',
      accent: '#f59e0b',
      text: '#0f172a',
      background: '#ffffff',
      fontFamily: null,
      source: 'default',
    },
  };
  const primaryRole =
    candidate.primaryRole ??
    primaryEntityType(candidate.cardTypes, candidate.name, candidate.descriptor);
  const cardId = uid('crd', `${slugify(candidate.name)}-${primaryRole}`);
  const isValuationReported = candidate.reportedValuation != null;
  const isArrReported = candidate.reportedArr != null;
  const isHeadcountReported = candidate.reportedHeadcount != null;
  const initialMetrics: CompanyMetric[] = [];
  if (isHeadcountReported && candidate.reportedHeadcount != null) {
    initialMetrics.push({
      id: uid('met', `${companyId}-employees`),
      companyId,
      metricType: 'employees' as const,
      value: candidate.reportedHeadcount,
      confidence: 'verified' as const,
      source: 'Reported in search grounding results',
      methodNote: 'Disclosed team headcount',
      capturedAt: new Date().toISOString(),
      citations: [],
    });
  }
  if (isArrReported && candidate.reportedArr != null) {
    initialMetrics.push({
      id: uid('met', `${companyId}-arr`),
      companyId,
      metricType: 'arr' as const,
      value: candidate.reportedArr,
      confidence: 'verified' as const,
      source: 'Reported in search grounding results',
      methodNote: 'Disclosed annual revenue/run-rate',
      capturedAt: new Date().toISOString(),
      citations: [],
    });
  }
  if (isValuationReported && candidate.reportedValuation != null) {
    initialMetrics.push({
      id: uid('met', `${companyId}-valuation`),
      companyId,
      metricType: 'valuation' as const,
      value: candidate.reportedValuation,
      confidence: 'verified' as const,
      source: 'Reported in search grounding results',
      methodNote: 'Disclosed valuation/market cap',
      capturedAt: new Date().toISOString(),
      citations: [],
    });
  }

  const card: Card = {
    id: cardId,
    deckId: deck.id,
    companyId: company.id,
    cardType: primaryRole,
    title: null,
    summary: candidate.descriptor || null,
    tier: null,
    tierReason: null,
    citations: [],
    keyPoints: [],
    createdAt: now(),
  };
  return {
    card,
    company,
    metrics: initialMetrics,
    viceClaims: [],
  };
}

/**
 * Continual Background Hydration: Asynchronously enriches candidate entities with
 * 4-tier proxy estimation, CMS scoring, and runs macro signal agents.
 */
export async function hydrateDeckCards(
  plan: MarketPlan,
  deck: Deck,
  candidates: CompanyCandidate[],
  client: LlmClient,
  options: HydrateDeckCardsOptions = {},
): Promise<CardWithCompany[]> {
  const emit: OnResearchEvent = options.onEvent ?? (() => {});
  const signal = options.signal;
  const coverage = resolveCoverage(options as RunResearchOptions);
  const concurrency = options.concurrency ?? 3;
  const completedCards = options.existingCompletedCards ?? [];

  // Concurrently run market signals alongside entity enrichment via Promise.all
  const [marketCards, entityCards] = await Promise.all([
    (async () => {
      // A resume whose signals already landed must not re-buy them: the pass
      // is a pair (barrier + insight), so both present means both are kept.
      const resumedSignals = completedCards.filter(
        (c) => c.card.cardType === 'barrier' || c.card.cardType === 'insight',
      );
      const signalsDone =
        resumedSignals.some((c) => c.card.cardType === 'barrier') &&
        resumedSignals.some((c) => c.card.cardType === 'insight');
      if (signalsDone) {
        await emit({
          type: 'status',
          step: 'barriers',
          message: 'Barriers and insights already researched — keeping them.',
        });
        // Completed cards flow through the final return; returning them here
        // too would double-count them.
        return [];
      }
      await emit({
        type: 'status',
        step: 'barriers',
        message: 'Identifying barriers and market insights…',
      });
      try {
        const mc = await researchMarketSignals(client, plan, deck.id, {
          signal,
          coverage,
        });
        for (const cardType of ['barrier', 'insight'] as const) {
          const count = mc.filter((card) => card.card.cardType === cardType).length;
          if (count < coverage[cardType].min) {
            await emit({
              type: 'warning',
              message: `Coverage shortfall for ${cardType}: found ${count}, minimum is ${coverage[cardType].min}. No unsupported market claims were invented.`,
            });
          }
        }
        for (const b of mc) {
          await emit({ type: 'card', card: b });
        }
        await options.onMarketSignals?.(mc);
        return mc;
      } catch (err) {
        // Same rule: degrade on real failure, stop on cancellation. Previously
        // an abort here let entity enrichment carry on burning search quota.
        if (err instanceof AbortError) throw err;
        await emit({
          type: 'warning',
          message: 'Could not research market-level barriers and insights.',
        });
        return [];
      }
    })(),

    (async () => {
      await emit({
        type: 'status',
        step: 'enrich',
        message: 'Researching company summaries and headline metrics…',
      });
      let done = 0;
      const hydratedResults = (
        await mapWithConcurrency(
          candidates,
          concurrency,
          async (candidate) => {
            throwIfAborted(signal);
            try {
              const result = await hydrateCompanyCard({
                originalSources: options.originalSources,
                recoverMissingMetrics: true,
                candidate,
                client,
                plan,
                deckId: deck.id,
                signal,
              });
              done += 1;
              await emit({
                type: 'status',
                step: 'enrich',
                message: `Researched ${candidate.name} (${done}/${candidates.length})`,
                progress: done / candidates.length,
              });
              await options.onCardHydrated?.(result);
              return result;
            } catch (error) {
              if (signal?.aborted) throw error;
              await emit({
                type: 'warning',
                message: `Could not enrich ${candidate.name}; preserving the rest of the deck. ${error instanceof Error ? error.message : 'Research failed.'}`,
              });
              return null;
            }
          },
          signal,
        )
      ).filter((entry): entry is HydrateCompanyCardResult => entry !== null);

      await emit({ type: 'status', step: 'score', message: 'Scoring maturity tiers…' });

      // Score: relative user values across the whole deck
      const allMetrics = [
        ...completedCards.flatMap((card) => card.metrics),
        ...hydratedResults.flatMap((entry) => entry.metrics),
      ];
      const deckUserValues = allMetrics
        .filter(
          (metric) =>
            metric.metricType === 'users' &&
            comparableMetricBasis(metric) &&
            metric.confidence !== 'unknown' &&
            metric.value !== null,
        )
        .map((metric) => metric.value as number);

      // Deterministic base tiers first, then ONE cohort-wide review pass.
      const baseTiers = new Map<string, MaturityTier>();
      const reviewRows: { name: string; baseTier: MaturityTier; evidence: string }[] = [];
      for (const r of hydratedResults) {
        if (!r.candidate.cardTypes.some(isEntityCardType)) continue;
        const base = computeCms(buildCmsInput(r.metrics), { deckUserValues });
        if (base.finalTier == null) continue;
        baseTiers.set(r.company.id, base.finalTier);
        reviewRows.push({
          name: r.company.name,
          baseTier: base.finalTier,
          evidence: r.metrics
            .map((m) => `${m.metricType}: ${m.value ?? 'unknown'} (${m.confidence})`)
            .join('; '),
        });
      }

      const reviews = await reviewTiersBatch(client, plan.marketName, reviewRows, signal);

      const assembledCompanyCards: CardWithCompany[] = [];
      for (const r of hydratedResults) {
        const primaryEntity = primaryEntityType(
          r.candidate.cardTypes,
          r.candidate.name,
          r.candidate.descriptor,
          r.candidate.primaryRole,
        );
        let tier: MaturityTier | null = null;
        let tierReason: string | null = null;
        if (r.candidate.cardTypes.some(isEntityCardType) && baseTiers.has(r.company.id)) {
          const review = reviews.get(r.company.name) ?? { nudge: 0 as const, reason: null };
          const scored = computeCms(
            buildCmsInput(r.metrics),
            { deckUserValues },
            { nudge: review.nudge },
          );
          tier = scored.finalTier;
          tierReason = review.reason;
        }

        for (const cwc of r.cards) {
          if (cwc.card.cardType === primaryEntity) {
            cwc.card.tier = tier;
            cwc.card.tierReason = tierReason;
          }
          assembledCompanyCards.push(cwc);
          await emit({ type: 'card', card: cwc });
        }
      }

      return assembledCompanyCards;
    })(),
  ]);

  return [...completedCards, ...entityCards, ...marketCards];
}

/** Run the full deck-research pipeline. Streams progress via `onEvent`. */
export async function runDeckResearch(
  brief: ResearchBrief,
  client: LlmClient,
  options: RunResearchOptions,
): Promise<ResearchResult> {
  const emit: OnResearchEvent = options.onEvent ?? (() => {});
  const signal = options.signal;
  const coverage = resolveCoverage(options);
  // Default concurrency to 3 for higher data throughput and fast fan-out deck generation
  const concurrency = options.concurrency ?? 3;
  let plan: MarketPlan;
  let candidates: CompanyCandidate[];
  let market: Market;
  let deck: Deck;
  let completedCards: CardWithCompany[] = [];

  if (options.resume) {
    plan = options.resume.plan;
    market = options.resume.market;
    deck = options.resume.deck;
    completedCards = [...options.resume.completedCards];
    candidates = [...options.resume.candidates];
    const completedNames = new Set(
      completedCards
        .filter((entry) => entry.company)
        .map((entry) => entry.company!.name.toLowerCase()),
    );
    candidates = candidates.filter(
      (candidate) => !completedNames.has(candidate.name.toLowerCase()),
    );
    await emit({
      type: 'status',
      step: 'enrich',
      message: `Resuming research with ${candidates.length} remaining players…`,
    });
    await emit({ type: 'market', market: plan });
    await emit({ type: 'candidates', candidates: [...options.resume.candidates] });
  } else {
    const stubs = await discoverDeckStubs(brief, client, options);
    plan = stubs.plan;
    market = stubs.market;
    deck = stubs.deck;
    candidates = stubs.candidates;
  }

  const cards = await hydrateDeckCards(plan, deck, candidates, client, {
    originalSources: options.originalSources,
    concurrency,
    coverage,
    signal,
    onEvent: emit,
    existingCompletedCards: completedCards,
  });

  await emit({ type: 'done', total: cards.length });
  return { market, deck, cards };
}
