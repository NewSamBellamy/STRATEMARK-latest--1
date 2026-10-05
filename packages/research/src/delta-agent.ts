/**
 * Incremental Delta Search Agent Deep Module (§3 Phase 5 & §4)
 *
 * Implements a Deep-Module Clean Architecture for targeted incremental research,
 * precision focus translation, snapshot diffing with strict exclusion clauses,
 * and stateful company card hydration under the Stratemark Multi-Agent Backend Specification.
 *
 * Deep Module Core Principles:
 *   1. High-Leverage Interfaces: `IncrementalDeltaAgent` and `expandDeckWithDeltaAgent`
 *      hide complex grounded discovery, normalization, snapshot diffing, 4-tier proxy estimation,
 *      5-tier provenance, and CMS scoring behind a simple, robust interface.
 *   2. Precision Focus Translation:
 *      - Translates `ExpandFocus` (tiers 1-8, card types, or free-text query) into targeted,
 *        grounded search queries with clear maturity-stage and role constraints.
 *   3. Snapshot Diffing & Strict Exclusion:
 *      - Normalizes company names (stripping corporate suffixes: Inc, LLC, Ltd, Corp, PLC, AG, etc.)
 *        and domain keys to construct comprehensive exclusion sets.
 *      - Ensures zero re-research or duplicate creation of existing deck entities.
 *   4. Full Subagent Hydration:
 *      - Integrates `hydrateCompanyCard` and `enrichCompanyWithProxies` from `./company-agent`.
 *      - Applies 4-tier proxy waterfall estimation (headcount, pricing footprint, funding dilution, honest null).
 *      - Computes deterministic CMS scores and conducts cohort/LLM tier reviews.
 *      - Strictly adheres to provenance rules and card taxonomy (Entity vs Signal cards).
 *   5. Grounding & Anti-Hallucination Discipline:
 *      - Zero fabricated figures or ungrounded companies.
 *      - Missing data is honestly reported as null / unknown with method notes.
 */

import {
  buildCmsInput,
  computeCms,
  isEntityCardType,
  CARD_TYPE_DESCRIPTIONS,
  CARD_TYPE_LABELS,
  TIER_BLURBS,
  TIER_LABELS,
  type CardType,
  type CardWithCompany,
  type ExpandFocus,
  type MaturityTier,
} from '@mi/contracts';
import {
  discoveryOutSchema,
  tierReviewOutSchema,
} from './schemas';
import {
  GROUNDED_SYSTEM,
  STRUCTURE_SYSTEM,
  structureDiscoveryPrompt,
  tierReviewPrompt,
  type DiscoveryFocus,
} from './prompts';
import { rootDomain, throwIfAborted } from './util';
import { hydrateCompanyCard } from './company-agent';
import type { OriginalSourceServices } from './original-source';
import type {
  Citation,
  CompanyCandidate,
  LlmClient,
  MarketPlan,
  OnResearchEvent,
} from './types';

// ============================================================================
// 1. Domain Types & State Contracts
// ============================================================================

export type EntityExclusionInput =
  | string[]
  | Array<{ name: string; domain?: string | null; websiteUrl?: string | null }>
  | Set<string>
  | {
      names?: string[];
      domains?: string[];
      companies?: Array<{ name: string; domain?: string | null; websiteUrl?: string | null }>;
      cards?: CardWithCompany[];
    };

export interface DeltaAgentContext {
  marketName: string;
  vertical: string;
  geography?: string | null;
  notes?: string | null;
  deckId?: string;
  deckUserValues?: number[];
}

export interface TranslatedFocus {
  focusPrompt: string;
  primaryCardType?: CardType;
  targetTier?: MaturityTier;
  discoveryFocus: DiscoveryFocus;
}

export interface DeltaExecutionStats {
  target: number;
  discoveredCount: number;
  deduplicatedCount: number;
  excludedCount: number;
  addedCount: number;
  focusPrompt: string;
  targetTier?: MaturityTier;
  primaryCardType?: CardType;
}

export interface DeltaSearchOptions {
  originalSources?: OriginalSourceServices;
  focus: ExpandFocus | string;
  target?: number;
  exclude?: EntityExclusionInput;
  signal?: AbortSignal;
  onEvent?: OnResearchEvent;
  customArrPerFte?: number;
  customFundingMultiplier?: number;
  includeUnknowns?: boolean;
  reviewTiers?: boolean;
}

export interface DeltaSearchResult {
  cards: CardWithCompany[];
  candidates: CompanyCandidate[];
  rejected: string[];
  citations: Citation[];
  stats: DeltaExecutionStats;
}

export interface ExpandDeckWithDeltaAgentArgs {
  originalSources?: OriginalSourceServices;
  client: LlmClient;
  marketName: string;
  vertical: string;
  geography?: string | null;
  focus?: ExpandFocus | string;
  focusPrompt?: string;
  excludeNames?: string[];
  excludeDomains?: string[];
  existingCompanies?: Array<{ name: string; domain?: string | null; websiteUrl?: string | null }>;
  existingCards?: CardWithCompany[];
  deckId?: string;
  deckUserValues?: number[];
  target?: number;
  onEvent?: OnResearchEvent;
  signal?: AbortSignal;
  customArrPerFte?: number;
  customFundingMultiplier?: number;
  includeUnknowns?: boolean;
  reviewTiers?: boolean;
}

// ============================================================================
// 2. Normalization & Identity Helpers
// ============================================================================

/**
 * Normalizes an entity name by stripping common corporate suffixes and non-alphanumerics.
 */
export function normalizeEntityName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(
      /\b(incorporated|corporation|company|limited|holdings|group|ventures|technologies|technology|enterprises|international|solutions|services|systems|software|labs|lab|gmbh|ag|sa|bv|sarl|pty|inc|llc|ltd|corp|plc|co)\b/gi,
      '',
    )
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Generates deduplication identity keys for an entity from its name and root domain.
 */
export function buildEntityIdentityKeys(name: string, domain?: string | null): string[] {
  const nameKey = normalizeEntityName(name);
  const rawDomain = domain ? rootDomain(domain) : null;
  const keys: string[] = [];
  if (nameKey) keys.push(nameKey);
  if (rawDomain) {
    keys.push(rawDomain);
    const parts = rawDomain.split('.');
    if (parts.length > 2) {
      const secondLevel = parts.slice(-2).join('.');
      if (!keys.includes(secondLevel)) {
        keys.push(secondLevel);
      }
    }
  }
  return keys;
}

/**
 * Builds an exclusion clause for grounded search prompts and a key set for candidate filtering.
 */
export function buildExclusionClause(input?: EntityExclusionInput): {
  exclusionText: string;
  keys: Set<string>;
  names: string[];
  count: number;
} {
  const keys = new Set<string>();
  const rawNames: string[] = [];

  if (!input) {
    return { exclusionText: '(none)', keys, names: [], count: 0 };
  }

  const addEntity = (name: string, domain?: string | null) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    rawNames.push(trimmed);
    const entityKeys = buildEntityIdentityKeys(trimmed, domain);
    for (const key of entityKeys) {
      keys.add(key);
    }
  };

  if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'string') {
        addEntity(item);
      } else if (item && typeof item === 'object') {
        addEntity(item.name, item.domain ?? item.websiteUrl);
      }
    }
  } else if (input instanceof Set) {
    for (const item of input) {
      addEntity(item);
    }
  } else if (typeof input === 'object') {
    if (input.names) {
      for (const name of input.names) addEntity(name);
    }
    if (input.domains) {
      for (const domain of input.domains) {
        const dKey = rootDomain(domain);
        if (dKey) keys.add(dKey);
      }
    }
    if (input.companies) {
      for (const c of input.companies) addEntity(c.name, c.domain ?? c.websiteUrl);
    }
    if (input.cards) {
      for (const cwc of input.cards) {
        if (cwc.company) {
          addEntity(cwc.company.name, cwc.company.websiteUrl);
        }
      }
    }
  }

  const distinctNames = Array.from(new Set(rawNames));
  const displayNames = distinctNames.slice(0, 40);
  const exclusionText =
    displayNames.length > 0
      ? displayNames.join(', ') + (distinctNames.length > 40 ? ', ...' : '')
      : '(none)';

  return {
    exclusionText,
    keys,
    names: distinctNames,
    count: distinctNames.length,
  };
}

// ============================================================================
// 3. Precision Focus Translation Engine
// ============================================================================

/**
 * Translates ExpandFocus or a free-text focus string into precision grounded search directives.
 */
export function translateExpandFocus(
  focus: ExpandFocus | string,
  context?: { marketName?: string; vertical?: string; geography?: string | null },
): TranslatedFocus {
  if (typeof focus === 'string') {
    const trimmed = focus.trim();
    const lower = trimmed.toLowerCase();

    // Check for tier keywords (e.g. "tier 1", "the sandbox", "tier 8", "titans")
    const tierMatch = lower.match(/\b(tier\s*([1-8])|t([1-8]))\b/);
    if (tierMatch) {
      const rawTier = tierMatch[2] ?? tierMatch[3] ?? '0';
      const tierNum = Number.parseInt(rawTier, 10) as MaturityTier;
      if (tierNum >= 1 && tierNum <= 8) {
        return translateExpandFocus({ tier: tierNum }, context);
      }
    }

    if (lower.includes('sandbox') || lower.includes('pre-seed') || lower.includes('r&d')) {
      return translateExpandFocus({ tier: 1 }, context);
    }
    if (lower.includes('scrappy') || lower.includes('seed stage')) {
      return translateExpandFocus({ tier: 2 }, context);
    }
    if (lower.includes('emerging challenger') || lower.includes('series a')) {
      return translateExpandFocus({ tier: 3 }, context);
    }
    if (lower.includes('growth stage') || lower.includes('series b')) {
      return translateExpandFocus({ tier: 4 }, context);
    }
    if (lower.includes('disruptor')) {
      return translateExpandFocus({ tier: 5 }, context);
    }
    if (lower.includes('scale stage') || lower.includes('massive distribution')) {
      return translateExpandFocus({ tier: 6 }, context);
    }
    if (lower.includes('incumbent') || lower.includes('legacy')) {
      return translateExpandFocus({ tier: 7 }, context);
    }
    if (lower.includes('titan') || lower.includes('behemoth') || lower.includes('market leader')) {
      return translateExpandFocus({ tier: 8 }, context);
    }

    // Check for card type keywords
    if (lower.includes('infrastructure') || lower.includes('tooling') || lower.includes('compute') || lower.includes('chip') || lower.includes('platform')) {
      return translateExpandFocus({ cardType: 'infrastructure' }, context);
    }
    if (lower.includes('distribution') || lower.includes('channel') || lower.includes('marketplace') || lower.includes('integrator') || lower.includes('reseller')) {
      return translateExpandFocus({ cardType: 'distribution' }, context);
    }
    if (lower.includes('vice') || lower.includes('controversy') || lower.includes('lawsuit') || lower.includes('risk')) {
      return translateExpandFocus({ cardType: 'vice' }, context);
    }
    if (lower.includes('culture') || lower.includes('community') || lower.includes('open source') || lower.includes('mission')) {
      return translateExpandFocus({ cardType: 'culture' }, context);
    }

    return {
      focusPrompt: trimmed || 'notable operating companies missed in the initial pass',
      primaryCardType: 'company',
      discoveryFocus: 'all',
    };
  }

  // Handle structured ExpandFocus object
  if (focus.tier != null) {
    const tier = focus.tier;
    const label = TIER_LABELS[tier];
    const blurb = TIER_BLURBS[tier];

    let stageGuidance = '';
    switch (tier) {
      case 1:
        stageGuidance =
          'Focus specifically on pre-product, stealth, speculative R&D, university spin-outs, incubator-backed or pre-seed companies with <$1 ARR and <5 employees.';
        break;
      case 2:
        stageGuidance =
          'Focus specifically on early-stage, high-risk seed startups finding initial traction ($1-$1M ARR, 5-20 employees).';
        break;
      case 3:
        stageGuidance =
          'Focus specifically on emerging Series A startups with demonstrable product-market fit ($1M-$5M ARR, 20-75 employees).';
        break;
      case 4:
        stageGuidance =
          'Focus specifically on fast-scaling Series B/C growth companies backed by institutional venture capital ($5M-$20M ARR, 75-300 employees).';
        break;
      case 5:
        stageGuidance =
          'Focus specifically on high-growth market disruptors actively taking share and rewriting industry rules ($20M-$75M ARR, 300-1,000 employees).';
        break;
      case 6:
        stageGuidance =
          'Focus specifically on large, scaled enterprise companies with massive distribution and proven business models ($75M-$250M ARR, 1,000-5,000 employees).';
        break;
      case 7:
        stageGuidance =
          'Focus specifically on mature, highly profitable legacy incumbents and established industry stalwarts ($250M-$1B ARR, 5,000-10,000 employees).';
        break;
      case 8:
        stageGuidance =
          'Focus specifically on absolute market titans and multi-billion-dollar market leaders (>$1B ARR, >10,000 employees, public tech behemoths).';
        break;
    }

    const focusPrompt = `Tier ${tier} (${label} — "${blurb}"). ${stageGuidance}`;

    return {
      focusPrompt,
      targetTier: tier,
      primaryCardType: 'company',
      discoveryFocus: 'company',
    };
  }

  if (focus.cardType != null) {
    const cardType = focus.cardType;
    const label = CARD_TYPE_LABELS[cardType];
    const desc = CARD_TYPE_DESCRIPTIONS[cardType];

    let roleGuidance = '';
    if (cardType === 'infrastructure') {
      roleGuidance =
        'Find companies providing foundational infrastructure, tooling, developer platforms, compute, GPUs, data pipelines, or hardware upon which the market operates.';
    } else if (cardType === 'distribution') {
      roleGuidance =
        'Find companies providing distribution, marketplaces, aggregator channels, reseller networks, or retail integrations for this vertical.';
    } else if (cardType === 'vice') {
      roleGuidance =
        'Find operating companies in this market that have documented controversies, lawsuits, regulatory scrutiny, or integrity risks.';
    } else if (cardType === 'culture') {
      roleGuidance =
        'Find operating companies in this market known for outstanding community contributions, open source leadership, non-profit partnerships, or ethical governance.';
    } else {
      roleGuidance = desc;
    }

    const focusPrompt = `${label} entities: ${roleGuidance}`;

    return {
      focusPrompt,
      primaryCardType: cardType,
      discoveryFocus: isEntityCardType(cardType)
        ? (cardType as DiscoveryFocus)
        : 'all',
    };
  }

  return {
    focusPrompt: 'notable operating companies missed in the initial research pass',
    primaryCardType: 'company',
    discoveryFocus: 'all',
  };
}

// ============================================================================
// 4. IncrementalDeltaAgent Deep Module Class
// ============================================================================

export class IncrementalDeltaAgent {
  private client: LlmClient;
  private context: DeltaAgentContext;

  constructor(client: LlmClient, context?: Partial<DeltaAgentContext>) {
    this.client = client;
    this.context = {
      marketName: context?.marketName ?? 'General Market',
      vertical: context?.vertical ?? 'Technology',
      geography: context?.geography ?? null,
      notes: context?.notes ?? null,
      deckId: context?.deckId ?? '',
      deckUserValues: context?.deckUserValues ?? [],
    };
  }

  /**
   * Update the agent's research context.
   */
  setContext(context: Partial<DeltaAgentContext>): this {
    this.context = { ...this.context, ...context };
    return this;
  }

  /**
   * Retrieve the current context.
   */
  getContext(): DeltaAgentContext {
    return { ...this.context };
  }

  /**
   * Builds an exclusion clause for prompt formatting and identity key matching.
   */
  buildExclusionClause(input?: EntityExclusionInput) {
    return buildExclusionClause(input);
  }

  /**
   * Translates a focus directive into precision search prompts.
   */
  translateFocus(focus: ExpandFocus | string): TranslatedFocus {
    return translateExpandFocus(focus, {
      marketName: this.context.marketName,
      vertical: this.context.vertical,
      geography: this.context.geography,
    });
  }

  /**
   * Executes an incremental delta search pass with full snapshot diffing and subagent hydration.
   */
  async searchDelta(options: DeltaSearchOptions): Promise<DeltaSearchResult> {
    const emit: OnResearchEvent = options.onEvent ?? (() => {});
    const target = Math.max(1, options.target ?? 3);
    throwIfAborted(options.signal);

    // 1. Translate Focus Directive
    const translated = this.translateFocus(options.focus);
    const plan: MarketPlan = {
      marketName: this.context.marketName,
      vertical: this.context.vertical,
      geography: this.context.geography ?? null,
      notes: this.context.notes ?? null,
      searchThemes: [translated.focusPrompt],
    };

    // 2. Build Exclusion Clause & Identity Key Set
    const exclusion = buildExclusionClause(options.exclude);

    await emit({
      type: 'status',
      step: 'discover',
      message: `Hunting: ${translated.focusPrompt}`,
    });

    // 3. Grounded Discovery Pass
    const groundPrompt = [
      `Market: ${plan.marketName} — ${plan.vertical}${plan.geography ? ` in ${plan.geography}` : ''}.`,
      `Focus / Search Angle: ${translated.focusPrompt}`,
      `Using Google Search, find up to ${target} REAL operating companies matching this focus.`,
      `Exclude these already-known companies: ${exclusion.exclusionText}.`,
      `STRICT: include ONLY actual operating companies/organizations — no government agencies, trade bodies, news publications, blogs, or abstract topics. Every company must be an active commercial business entity.`,
    ].join('\n');

    const grounded = await this.client.ground(groundPrompt, {
      system: GROUNDED_SYSTEM,
      signal: options.signal,
    });

    throwIfAborted(options.signal);

    // 4. Structured JSON Extraction
    const structured = await this.client.structure(
      structureDiscoveryPrompt(grounded.text, translated.discoveryFocus),
      discoveryOutSchema,
      { system: STRUCTURE_SYSTEM, signal: options.signal },
    );

    // 5. Diffing, Filtering & Candidate Deduplication
    const seenBatchKeys = new Set<string>();
    const candidates: CompanyCandidate[] = [];
    const rejected: string[] = [];
    let excludedCount = 0;
    let deduplicatedCount = 0;

    for (const c of structured.companies ?? []) {
      const name = c.name.trim();
      const domain = rootDomain(c.domain);
      const keys = buildEntityIdentityKeys(name, domain);

      // Check against existing deck exclusion set
      if (keys.some((key) => exclusion.keys.has(key))) {
        excludedCount += 1;
        continue;
      }

      // Check against current batch duplicates
      if (keys.some((key) => seenBatchKeys.has(key))) {
        deduplicatedCount += 1;
        continue;
      }

      keys.forEach((key) => seenBatchKeys.add(key));

      // Resolve roles and card types
      const rawTypes = (c.cardTypes ?? []) as CardType[];
      const validTypes = rawTypes.filter(
        (t): t is 'company' | 'infrastructure' | 'distribution' | 'culture' | 'vice' =>
          t !== 'barrier' && t !== 'insight',
      );

      let facets = validTypes;
      if (facets.length > 0 && !facets.some(isEntityCardType)) {
        if (!domain) {
          rejected.push(name);
          continue;
        }
        facets = ['company', ...facets];
      }

      const entityRole =
        translated.primaryCardType && isEntityCardType(translated.primaryCardType)
          ? (translated.primaryCardType as 'company' | 'infrastructure' | 'distribution')
          : undefined;

      const primaryRole: 'company' | 'infrastructure' | 'distribution' =
        entityRole ??
        c.primaryRole ??
        (facets.find(isEntityCardType) as 'company' | 'infrastructure' | 'distribution' | undefined) ??
        'company';

      if (!facets.includes(primaryRole)) {
        facets = [primaryRole, ...facets];
      }

      candidates.push({
        name,
        domain,
        descriptor: c.descriptor ?? '',
        primaryRole,
        cardTypes: facets.length > 0 ? facets : [primaryRole],
      });

      if (candidates.length >= target) {
        break;
      }
    }

    await emit({ type: 'candidates', candidates });

    // 6. Full Subagent Hydration via CompanyAgent
    const resultCards: CardWithCompany[] = [];
    const allCitations: Citation[] = [...grounded.citations];

    for (const candidate of candidates) {
      throwIfAborted(options.signal);

      await emit({
        type: 'status',
        step: 'enrich',
        message: `Researched ${candidate.name}`,
      });

      // Hydrate via deep module company-agent
      const hydration = await hydrateCompanyCard({
        originalSources: options.originalSources,
        candidate,
        client: this.client,
        plan,
        deckId: this.context.deckId,
        deckUserValues: this.context.deckUserValues,
        signal: options.signal,
        includeUnknowns: options.includeUnknowns ?? true,
        customArrPerFte: options.customArrPerFte,
        customFundingMultiplier: options.customFundingMultiplier,
      });

      allCitations.push(...hydration.citations);

      // Perform tier review if candidate was scored and tier review is enabled
      if (
        !options.originalSources &&
        options.reviewTiers !== false &&
        hydration.cmsResult.baseTier != null &&
        hydration.cmsResult.finalTier != null
      ) {
        try {
          const evidence = hydration.metrics
            .map((m) => `${m.metricType}: ${m.value ?? 'unknown'} (${m.confidence})`)
            .join('; ');

          const review = await this.client.structure(
            tierReviewPrompt(
              hydration.company.name,
              hydration.cmsResult.baseTier,
              evidence,
            ),
            tierReviewOutSchema,
            { system: STRUCTURE_SYSTEM, signal: options.signal },
          );

          if (review.nudge !== 0 || review.reason) {
            const adjusted = computeCms(
              buildCmsInput(hydration.metrics),
              { deckUserValues: this.context.deckUserValues ?? [] },
              { nudge: review.nudge, nudgeReason: review.reason },
            );
            hydration.cmsResult = adjusted;
            hydration.card.tier = adjusted.finalTier;
            hydration.card.tierReason = review.reason ?? null;

            for (const cwc of hydration.cards) {
              if (isEntityCardType(cwc.card.cardType)) {
                cwc.card.tier = adjusted.finalTier;
                cwc.card.tierReason = review.reason ?? null;
              }
            }
          }
        } catch {
          // Graceful fallback to deterministic base tier
        }
      }

      // If targeted cardType was specified, ensure proper tagging on entity cards
      if (translated.primaryCardType && translated.primaryCardType !== 'company') {
        for (const cwc of hydration.cards) {
          if (cwc.card.cardType === 'company' && isEntityCardType(translated.primaryCardType)) {
            cwc.card.cardType = translated.primaryCardType;
          }
        }
      }

      // Collect emitted cards
      for (const cwc of hydration.cards) {
        resultCards.push(cwc);
        await emit({ type: 'card', card: cwc });
      }
    }

    const stats: DeltaExecutionStats = {
      target,
      discoveredCount: structured.companies?.length ?? 0,
      deduplicatedCount,
      excludedCount,
      addedCount: resultCards.length,
      focusPrompt: translated.focusPrompt,
      targetTier: translated.targetTier,
      primaryCardType: translated.primaryCardType,
    };

    return {
      cards: resultCards,
      candidates,
      rejected,
      citations: allCitations,
      stats,
    };
  }

  /**
   * Convenience method to expand a deck and return the resulting CardWithCompany items.
   */
  async expandDeck(options: DeltaSearchOptions): Promise<CardWithCompany[]> {
    const result = await this.searchDelta(options);
    return result.cards;
  }
}

// ============================================================================
// 5. Standalone Helper Interface
// ============================================================================

/**
 * Top-level helper to execute delta research in a single function call.
 */
export async function expandDeckWithDeltaAgent(
  args: ExpandDeckWithDeltaAgentArgs,
): Promise<CardWithCompany[]> {
  const agent = new IncrementalDeltaAgent(args.client, {
    marketName: args.marketName,
    vertical: args.vertical,
    geography: args.geography,
    deckId: args.deckId,
    deckUserValues: args.deckUserValues,
  });

  const excludeItems: Array<{ name: string; domain?: string | null }> = [];
  if (args.excludeNames) {
    for (const name of args.excludeNames) {
      excludeItems.push({ name });
    }
  }
  if (args.excludeDomains) {
    for (const domain of args.excludeDomains) {
      excludeItems.push({ name: '', domain });
    }
  }
  if (args.existingCompanies) {
    for (const c of args.existingCompanies) {
      excludeItems.push({ name: c.name, domain: c.domain ?? c.websiteUrl });
    }
  }
  if (args.existingCards) {
    for (const cwc of args.existingCards) {
      if (cwc.company) {
        excludeItems.push({ name: cwc.company.name, domain: cwc.company.websiteUrl });
      }
    }
  }

  const focusInput: ExpandFocus | string =
    args.focus ?? (args.focusPrompt || 'notable companies missed in the initial pass');

  const result = await agent.searchDelta({
    originalSources: args.originalSources,
    focus: focusInput,
    target: args.target ?? 3,
    exclude: excludeItems,
    signal: args.signal,
    onEvent: args.onEvent,
    customArrPerFte: args.customArrPerFte,
    customFundingMultiplier: args.customFundingMultiplier,
    includeUnknowns: args.includeUnknowns,
    reviewTiers: args.reviewTiers,
  });

  return result.cards;
}
