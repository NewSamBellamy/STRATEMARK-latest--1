/**
 * Discovery Agent — the three-vector market topology mapper.
 *
 * A market is not a flat list of rivals. It is a supply chain, and a deck that
 * only enumerates competitors misses the companies that actually decide the
 * market's shape. So discovery fans out along three orthogonal vectors:
 *
 *   · `core_operators`        — who sells into this market
 *   · `infrastructure_supply` — who supplies the market's compute and tooling
 *   · `distribution_channel`  — who reaches the market's customers
 *
 * The three run as an ADK ParallelAgent (independent branches, no shared state
 * during execution), then converge through a deterministic merge that dedupes
 * on normalized identity keys. Merging is the interesting half: NVIDIA turns up
 * under both operators and infrastructure, and the deck needs one entity with
 * two facets, not two cards fighting over the same company.
 *
 * Anti-fabrication: this agent only ever *narrows* the grounded model output —
 * it drops unusable rows and never synthesizes a company to hit a target count.
 * A sparse vector is reported honestly as sparse.
 */
import {
  DISCOVERY_VECTORS,
  type CardType,
  type DiscoveryVector,
} from '@mi/contracts';
import { discoveryOutSchema } from '../schemas';
import { isPlaceholderCompany } from '../placeholder-names';
import {
  GROUNDED_SYSTEM,
  STRUCTURE_SYSTEM,
  discoverPrompt,
  structureDiscoveryPrompt,
  type DiscoveryFocus,
} from '../prompts';
import { rootDomain, throwIfAborted } from '../util';
import { buildEntityIdentityKeys, normalizeEntityName } from '../delta-agent';
import type { Citation, CompanyCandidate, LlmClient, MarketPlan } from '../types';
import type { AdkSpan, AdkTelemetryHub } from './telemetry';
import type { AdkTaskNode } from './task-graph';

// ============================================================================
// 1. Vector configuration
// ============================================================================

/** Each vector reuses the pipeline's existing, tuned discovery prompt focus. */
export const VECTOR_FOCUS: Record<DiscoveryVector, DiscoveryFocus> = {
  core_operators: 'company',
  infrastructure_supply: 'infrastructure',
  distribution_channel: 'distribution',
};

/** The primary role a vector's findings default to when the model omits one. */
export const VECTOR_PRIMARY_ROLE: Record<
  DiscoveryVector,
  'company' | 'infrastructure' | 'distribution'
> = {
  core_operators: 'company',
  infrastructure_supply: 'infrastructure',
  distribution_channel: 'distribution',
};

/**
 * Default per-vector targets. Weighted toward operators because that is the
 * deck's spine; the other two vectors are context, not filler.
 */
export const DEFAULT_VECTOR_TARGETS: Record<DiscoveryVector, number> = {
  core_operators: 12,
  infrastructure_supply: 5,
  distribution_channel: 3,
};

export const VECTOR_SEARCH_ANGLES: Record<DiscoveryVector, string> = {
  core_operators: 'the companies whose core product is sold into this market, across all maturity stages',
  infrastructure_supply: 'the compute, hardware, tooling, and platform suppliers this market depends on',
  distribution_channel: 'the marketplaces, resellers, channel partners, and integrators that reach this market',
};

// ============================================================================
// 2. Result contracts
// ============================================================================

export interface TopologyCandidate extends CompanyCandidate {
  /** The vector that first surfaced this entity. */
  vector: DiscoveryVector;
  /** Every vector that surfaced it — evidence of cross-market gravity. */
  vectors: DiscoveryVector[];
  /** Normalized keys used for dedupe and downstream exclusion sets. */
  identityKeys: string[];
}

export interface VectorDiscoveryResult {
  vector: DiscoveryVector;
  candidates: TopologyCandidate[];
  citations: Citation[];
  /** Rows the model returned that were unusable (no name, obvious junk). */
  rejected: number;
}

export interface MarketTopology {
  candidates: TopologyCandidate[];
  byVector: Record<DiscoveryVector, TopologyCandidate[]>;
  citations: Citation[];
  duplicatesMerged: number;
  /** Vectors that returned nothing — surfaced rather than quietly padded. */
  emptyVectors: DiscoveryVector[];
}

export interface DiscoveryAgentOptions {
  client: LlmClient;
  plan: MarketPlan;
  telemetry: AdkTelemetryHub;
  parentSpan?: AdkSpan | null;
  signal?: AbortSignal;
  /** Override per-vector target counts. */
  targets?: Partial<Record<DiscoveryVector, number>>;
  /** Entity names already in the deck; excluded from the prompt. */
  exclude?: readonly string[];
  /** Restrict the run to a subset of vectors. */
  vectors?: readonly DiscoveryVector[];
}

// ============================================================================
// 3. Single-vector agent
// ============================================================================

function isUsableName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 1 && trimmed.length < 120 && !isPlaceholderCompany(trimmed);
}

function toCandidate(
  row: {
    name: string;
    domain: string | null;
    descriptor: string;
    primaryRole: 'company' | 'infrastructure' | 'distribution' | null;
    cardTypes: CardType[];
  },
  vector: DiscoveryVector,
): TopologyCandidate {
  const domain = rootDomain(row.domain);
  const primaryRole = row.primaryRole ?? VECTOR_PRIMARY_ROLE[vector];
  const cardTypes = row.cardTypes.length > 0 ? row.cardTypes : [primaryRole];
  return {
    name: row.name.trim(),
    domain,
    descriptor: row.descriptor,
    primaryRole,
    cardTypes,
    vector,
    vectors: [vector],
    identityKeys: buildEntityIdentityKeys(row.name, domain),
  };
}

/**
 * Run one discovery vector: a grounded search pass followed by a structuring
 * pass. Two calls, mirroring the pipeline's existing contract that facts may
 * only enter through grounded search, never from model recall.
 */
export async function runDiscoveryVector(
  vector: DiscoveryVector,
  options: DiscoveryAgentOptions,
): Promise<VectorDiscoveryResult> {
  const { client, plan, telemetry, signal } = options;
  const target = options.targets?.[vector] ?? DEFAULT_VECTOR_TARGETS[vector];
  const focus = VECTOR_FOCUS[vector];

  const span = telemetry.startSpan(`discovery.${vector}`, 'llm', {
    parent: options.parentSpan ?? null,
    branchSegment: vector,
    attributes: { vector, target, focus },
  });

  try {
    throwIfAborted(signal);

    span.toolCall('llm.ground', { vector });
    const grounded = await client.ground(
      discoverPrompt(plan, target, focus, [...(options.exclude ?? [])], VECTOR_SEARCH_ANGLES[vector]),
      { system: GROUNDED_SYSTEM, signal },
    );
    span.toolResult('llm.ground', {
      vector,
      citations: grounded.citations.length,
      queries: grounded.queries.length,
    });

    throwIfAborted(signal);

    span.toolCall('llm.structure', { vector });
    const structured = await client.structure(
      structureDiscoveryPrompt(grounded.text, focus),
      discoveryOutSchema,
      { system: STRUCTURE_SYSTEM, signal },
    );
    span.toolResult('llm.structure', { vector, rows: structured.companies.length });

    const candidates: TopologyCandidate[] = [];
    let rejected = 0;
    for (const row of structured.companies) {
      if (!isUsableName(row.name) || isPlaceholderCompany(row.name, row.descriptor)) {
        rejected += 1;
        continue;
      }
      candidates.push(toCandidate(row, vector));
    }

    span.chunk(`${vector}: ${candidates.length} candidates`, {
      vector,
      found: candidates.length,
      rejected,
    });
    span.end({ vector, found: candidates.length, rejected });

    return { vector, candidates, citations: grounded.citations, rejected };
  } catch (err) {
    span.fail(err, { vector });
    throw err;
  }
}

// ============================================================================
// 4. Parallel fan-out + deterministic merge
// ============================================================================

function mergeCandidate(existing: TopologyCandidate, incoming: TopologyCandidate): TopologyCandidate {
  const cardTypes = new Set<CardType>([...existing.cardTypes, ...incoming.cardTypes]);
  const vectors = new Set<DiscoveryVector>([...existing.vectors, ...incoming.vectors]);
  return {
    ...existing,
    // Keep the richer descriptor and any domain we managed to resolve.
    descriptor: existing.descriptor.length >= incoming.descriptor.length
      ? existing.descriptor
      : incoming.descriptor,
    domain: existing.domain ?? incoming.domain,
    cardTypes: [...cardTypes],
    vectors: [...vectors],
    identityKeys: [...new Set([...existing.identityKeys, ...incoming.identityKeys])],
  };
}

/**
 * Merge vector results into one topology.
 *
 * Dedupe is by normalized name *or* shared identity key, so "Acme Inc." and
 * "Acme" on the same domain collapse into a single entity that carries both
 * roles rather than appearing twice in the deck.
 */
export function mergeTopology(results: readonly VectorDiscoveryResult[]): MarketTopology {
  const merged = new Map<string, TopologyCandidate>();
  const keyIndex = new Map<string, string>();
  const citations: Citation[] = [];
  const seenCitations = new Set<string>();
  let duplicatesMerged = 0;

  for (const result of results) {
    for (const citation of result.citations) {
      if (seenCitations.has(citation.url)) continue;
      seenCitations.add(citation.url);
      citations.push(citation);
    }

    for (const candidate of result.candidates) {
      const primaryKey = normalizeEntityName(candidate.name);
      let targetKey: string | undefined =
        merged.has(primaryKey) ? primaryKey : keyIndex.get(primaryKey);

      if (targetKey === undefined) {
        for (const key of candidate.identityKeys) {
          const hit = keyIndex.get(key);
          if (hit !== undefined) {
            targetKey = hit;
            break;
          }
        }
      }

      if (targetKey !== undefined) {
        const existing = merged.get(targetKey);
        if (existing !== undefined) {
          merged.set(targetKey, mergeCandidate(existing, candidate));
          duplicatesMerged += 1;
          continue;
        }
      }

      merged.set(primaryKey, candidate);
      keyIndex.set(primaryKey, primaryKey);
      for (const key of candidate.identityKeys) keyIndex.set(key, primaryKey);
    }
  }

  const candidates = [...merged.values()];
  const byVector = {} as Record<DiscoveryVector, TopologyCandidate[]>;
  for (const vector of DISCOVERY_VECTORS) {
    byVector[vector] = candidates.filter((candidate) => candidate.vectors.includes(vector));
  }

  const emptyVectors = results
    .filter((result) => result.candidates.length === 0)
    .map((result) => result.vector);

  return { candidates, byVector, citations, duplicatesMerged, emptyVectors };
}

/**
 * Map the market's topology across all three vectors in parallel.
 *
 * A single failing vector does not sink discovery: the run continues with the
 * vectors that succeeded and records the gap in the trace, because two thirds
 * of a topology is a usable deck and an exception is not.
 */
export async function mapMarketTopology(options: DiscoveryAgentOptions): Promise<MarketTopology> {
  const { telemetry } = options;
  const vectors = options.vectors ?? DISCOVERY_VECTORS;

  const span = telemetry.startSpan('discovery_agent', 'parallel', {
    parent: options.parentSpan ?? null,
    branchSegment: 'discovery',
    attributes: { vectors: [...vectors] },
  });

  const settled = await Promise.allSettled(
    vectors.map((vector) => runDiscoveryVector(vector, { ...options, parentSpan: span })),
  );

  const results: VectorDiscoveryResult[] = [];
  const failedVectors: string[] = [];
  for (let index = 0; index < settled.length; index += 1) {
    const outcome = settled[index];
    const vector = vectors[index];
    if (outcome === undefined || vector === undefined) continue;
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value);
    } else {
      failedVectors.push(vector);
      span.event('error', `vector ${vector} failed`, { vector }, { severity: 'warn' });
    }
  }

  if (results.length === 0) {
    const err = new Error('All discovery vectors failed; no market topology could be mapped.');
    span.fail(err);
    throw err;
  }

  const topology = mergeTopology(results);
  span.end({
    candidates: topology.candidates.length,
    duplicatesMerged: topology.duplicatesMerged,
    failedVectors,
    emptyVectors: topology.emptyVectors,
  });

  return topology;
}

// ============================================================================
// 5. Graph integration
// ============================================================================

export const DISCOVERY_NODE_ID = 'discovery';
export const TOPOLOGY_STATE_KEY = 'market_topology';

export function isMarketTopology(value: unknown): value is MarketTopology {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { candidates?: unknown; byVector?: unknown };
  return Array.isArray(candidate.candidates) && typeof candidate.byVector === 'object';
}

/** Build the discovery node for the engine's DAG. */
export function createDiscoveryNode(options: DiscoveryAgentOptions): AdkTaskNode {
  return {
    id: DISCOVERY_NODE_ID,
    author: 'discovery_agent',
    kind: 'parallel',
    description: '3-vector market topology mapper',
    dependsOn: [],
    outputKey: TOPOLOGY_STATE_KEY,
    critical: true,
    run: async (ctx) => mapMarketTopology({ ...options, parentSpan: ctx.span, signal: ctx.signal }),
  };
}
