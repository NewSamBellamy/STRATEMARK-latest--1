/**
 * Enrichment Pool — parallel company hydration workers.
 *
 * Discovery produces a topology of thin candidates in seconds; turning each one
 * into a real card costs several grounded LLM calls. Doing that serially is what
 * makes research tools feel dead for a minute. This pool runs the hydration
 * fan-out as an ADK ParallelAgent with a bounded worker count and, crucially,
 * *streams* each card out the moment it lands, so the deck fills in front of the
 * user instead of appearing all at once at the end.
 *
 * Operational shape:
 *   - **Bounded concurrency.** The Gemini free tier limits requests per minute,
 *     so an unbounded fan-out buys a wall of 429s and a slower run. The pool
 *     accepts the pipeline's existing rate limiter and paces before sending.
 *   - **Per-worker isolation.** One company that fails to hydrate is a missing
 *     card, not a failed deck. Failures are collected and reported.
 *   - **Escalation.** When the failure rate crosses a threshold the pool raises
 *     ADK `escalate` and stops scheduling — a systemic problem (revoked key,
 *     exhausted quota) should stop the run, not burn the whole catalog against
 *     a broken dependency.
 *   - **Zero fabrication.** Hydration delegates entirely to `hydrateCompanyCard`,
 *     which applies the 4-tier proxy waterfall and provenance enforcement. This
 *     module never invents a figure to fill a gap; a company that yields no
 *     usable metrics is hydrated with honest nulls.
 */
import type { LivingDeckDelta } from '@mi/contracts';
import { hydrateCompanyCard, type HydrateCompanyCardResult } from '../company-agent';
import { sleep, throwIfAborted, type RateLimiter } from '../util';
import type { CompanyCandidate, LlmClient, MarketPlan } from '../types';
import type { OriginalSourceServices } from '../original-source';
import { toTraceError, type AdkSpan, type AdkTelemetryHub } from './telemetry';
import type { AdkTaskNode } from './task-graph';
import { TOPOLOGY_STATE_KEY, isMarketTopology } from './discovery-agent';

// ============================================================================
// 1. Contracts
// ============================================================================

export interface EnrichmentFailure {
  candidate: CompanyCandidate;
  message: string;
  retryable: boolean;
}

export interface EnrichmentPoolResult {
  hydrated: HydrateCompanyCardResult[];
  failures: EnrichmentFailure[];
  /** True when the failure threshold tripped and scheduling stopped early. */
  escalated: boolean;
  durationMs: number;
}

export interface EnrichmentPoolOptions {
  originalSources?: OriginalSourceServices;
  client: LlmClient;
  plan: MarketPlan;
  telemetry: AdkTelemetryHub;
  candidates: readonly CompanyCandidate[];
  parentSpan?: AdkSpan | null;
  signal?: AbortSignal;
  /** Workers in flight. Defaults to 3 — free-tier friendly. */
  concurrency?: number;
  deckId?: string;
  /** User counts across the deck, needed for the relative `users` CMS signal. */
  deckUserValues?: number[];
  rateLimiter?: RateLimiter;
  /**
   * Fraction of failures that trips escalation, 0–1. Defaults to 0.5, and only
   * applies once `minAttemptsBeforeEscalate` companies have been attempted so a
   * single early failure cannot abort a healthy run.
   */
  failureRateThreshold?: number;
  minAttemptsBeforeEscalate?: number;
  /**
   * Cooldown granularity for adaptive back-pressure, in ms. Each retryable
   * failure adds one step before a worker takes new work; each success removes
   * one. Injectable so tests can exercise the behavior without real waits.
   */
  backpressureStepMs?: number;
  /** Streams each hydrated card as it completes. */
  onCard?: (result: HydrateCompanyCardResult) => void;
  /** Streams deck deltas; only emitted when `deckId` is supplied. */
  onDelta?: (delta: LivingDeckDelta) => void;
}

// ============================================================================
// 2. Delta construction
// ============================================================================

/**
 * Build the deltas describing one hydrated company.
 *
 * Metric deltas are only emitted when they can satisfy the schema's provenance
 * refinement — a `verified` figure without a citation is downgraded rather than
 * dropped, because the figure is real even when the source link is not usable.
 */
export function buildHydrationDeltas(
  result: HydrateCompanyCardResult,
  context: { deckId: string; author: string; invocationId: string; at: string; seq: number },
): LivingDeckDelta[] {
  const { deckId, author, invocationId, at } = context;
  const deltas: LivingDeckDelta[] = [];
  const card = result.card;
  const title = result.company.name || card.title || result.candidate.name;

  deltas.push({
    id: `dlt-${context.seq}-card`,
    deckId,
    at,
    author,
    invocationId,
    kind: 'card_added',
    cardId: card.id,
    cardType: card.cardType,
    title,
    vector: null,
  });

  let metricSeq = 0;
  for (const metric of result.metrics) {
    const citationUrl = metric.citations.find((citation) => citation.url)?.url ?? null;
    // Mirror `enforceMetricProvenance`: an unsourced figure is never "verified".
    const confidence =
      metric.confidence === 'verified' && citationUrl === null ? 'estimated' : metric.confidence;
    // The schema requires an unknown figure to carry a null value.
    const value = confidence === 'unknown' ? null : metric.value;

    metricSeq += 1;
    deltas.push({
      id: `dlt-${context.seq}-met-${metricSeq}`,
      deckId,
      at,
      author,
      invocationId,
      kind: 'metric_revised',
      cardId: card.id,
      metricType: metric.metricType,
      value,
      confidence,
      proxyTier: null,
      citationUrl,
    });
  }

  return deltas;
}

// ============================================================================
// 3. The pool
// ============================================================================

/**
 * Hydrate every candidate with a bounded pool of workers, streaming results.
 */
export async function runEnrichmentPool(
  options: EnrichmentPoolOptions,
): Promise<EnrichmentPoolResult> {
  const {
    client,
    plan,
    telemetry,
    candidates,
    signal,
    rateLimiter,
    onCard,
    onDelta,
    deckId,
  } = options;

  const concurrency = Math.max(1, options.concurrency ?? 3);
  const failureRateThreshold = options.failureRateThreshold ?? 0.5;
  const minAttempts = options.minAttemptsBeforeEscalate ?? 4;

  const poolSpan = telemetry.startSpan('enrichment_pool', 'parallel', {
    parent: options.parentSpan ?? null,
    branchSegment: 'enrichment',
    attributes: { candidates: candidates.length, concurrency },
  });
  const startedAt = telemetry.now();

  const hydrated: HydrateCompanyCardResult[] = [];
  const failures: EnrichmentFailure[] = [];
  let cursor = 0;
  let attempts = 0;
  let escalated = false;
  let deltaSeq = 0;

  /**
   * Identity keys already claimed by a worker. The candidate list can contain
   * the same entity twice — the delta agent adds an entity the initial pass
   * already knew — and without this, two workers hydrate it in parallel and the
   * deck gets two cards for one company. Claiming is synchronous, so there is
   * no window between the check and the claim.
   */
  const claimed = new Set<string>();
  const identityOf = (candidate: CompanyCandidate): string =>
    (candidate.domain ?? candidate.name).trim().toLowerCase();

  /**
   * Adaptive back-pressure. A 429 means the limiter's guess about our real
   * quota was too optimistic, so every retryable failure buys an increasing
   * cooldown and every success pays it back down. Without this the pool keeps
   * hammering at the same rate that just got rejected.
   */
  let penalty = 0;
  const PENALTY_STEP_MS = options.backpressureStepMs ?? 1_500;
  const MAX_PENALTY = 8;

  const shouldEscalate = (): boolean =>
    attempts >= minAttempts && failures.length / attempts >= failureRateThreshold;

  const worker = async (workerIndex: number): Promise<void> => {
    for (;;) {
      if (escalated || signal?.aborted) return;

      // Claim the next unclaimed candidate.
      let candidate: CompanyCandidate | undefined;
      let index = -1;
      while (cursor < candidates.length) {
        const next = candidates[cursor];
        index = cursor;
        cursor += 1;
        if (next === undefined) continue;
        const key = identityOf(next);
        if (claimed.has(key)) continue;
        claimed.add(key);
        candidate = next;
        break;
      }
      if (candidate === undefined) return;

      if (penalty > 0) {
        // Back off before taking on new work, not after failing at it.
        await sleep(Math.min(penalty, MAX_PENALTY) * PENALTY_STEP_MS, signal).catch(() => undefined);
        if (signal?.aborted) return;
      }

      const workerSpan = poolSpan.child(`worker.${workerIndex}`, 'pool_worker', {
        branchSegment: `worker-${workerIndex}`,
        attributes: { company: candidate.name, index },
      });
      attempts += 1;

      try {
        throwIfAborted(signal);
        // Pace before sending rather than apologising to a 429 afterwards.
        if (rateLimiter) await rateLimiter.acquire(signal);

        workerSpan.toolCall('hydrate_company_card', { company: candidate.name });
        const result = await hydrateCompanyCard({
          originalSources: options.originalSources,
          recoverMissingMetrics: true,
          candidate,
          client,
          plan,
          signal,
          ...(deckId === undefined ? {} : { deckId }),
          ...(options.deckUserValues === undefined
            ? {}
            : { deckUserValues: options.deckUserValues }),
        });
        workerSpan.toolResult('hydrate_company_card', {
          company: candidate.name,
          metrics: result.metrics.length,
          cards: result.cards.length,
        });

        hydrated.push(result);
        onCard?.(result);

        if (deckId !== undefined && onDelta) {
          deltaSeq += 1;
          const deltas = buildHydrationDeltas(result, {
            deckId,
            author: 'enrichment_pool',
            invocationId: telemetry.invocationId,
            at: new Date(telemetry.now()).toISOString(),
            seq: deltaSeq,
          });
          for (const delta of deltas) onDelta(delta);
        }

        // A clean pass earns back some of the cooldown a 429 imposed.
        if (penalty > 0) penalty -= 1;

        workerSpan.chunk(`hydrated ${candidate.name}`, {
          company: candidate.name,
          metrics: result.metrics.length,
        });
        workerSpan.end({ company: candidate.name });
      } catch (err) {
        const error = toTraceError(err);
        workerSpan.fail(err, { company: candidate.name });

        if (
          error.name === 'AbortError' ||
          signal?.aborted ||
          error.message.includes('aborted')
        ) {
          return;
        }

        failures.push({
          candidate,
          message: error.message,
          retryable: error.retryable,
        });

        // Retryable means rate-limited or upstream-degraded: slow down.
        if (error.retryable && penalty < MAX_PENALTY) {
          penalty += 1;
          poolSpan.event(
            'state_delta',
            `back-pressure engaged (penalty ${penalty})`,
            { penalty, company: candidate.name },
            { severity: 'warn' },
          );
        }

        if (!escalated && shouldEscalate()) {
          escalated = true;
          poolSpan.escalate(
            `enrichment failure rate ${failures.length}/${attempts} crossed threshold`,
            { failures: failures.length, attempts },
          );
          return;
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, candidates.length)) }, (_unused, i) =>
      worker(i),
    ),
  );

  const durationMs = Math.max(0, telemetry.now() - startedAt);
  poolSpan.end({
    hydrated: hydrated.length,
    failed: failures.length,
    escalated,
    durationMs,
  });

  return { hydrated, failures, escalated, durationMs };
}

// ============================================================================
// 4. Graph integration
// ============================================================================

export const ENRICHMENT_NODE_ID = 'enrichment';
export const ENRICHMENT_STATE_KEY = 'enrichment_result';

export function isEnrichmentPoolResult(value: unknown): value is EnrichmentPoolResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { hydrated?: unknown; failures?: unknown };
  return Array.isArray(candidate.hydrated) && Array.isArray(candidate.failures);
}

export type EnrichmentNodeOptions = Omit<EnrichmentPoolOptions, 'candidates' | 'parentSpan'> & {
  /** Cap how many discovered candidates get hydrated in this pass. */
  maxCandidates?: number;
};

/**
 * Build the enrichment node, which reads the topology the discovery node wrote
 * to session state (ADK `output_key` chaining) rather than taking it directly.
 */
export function createEnrichmentNode(options: EnrichmentNodeOptions): AdkTaskNode {
  return {
    id: ENRICHMENT_NODE_ID,
    author: 'enrichment_pool',
    kind: 'parallel',
    description: 'Parallel company hydration workers',
    dependsOn: ['discovery'],
    outputKey: ENRICHMENT_STATE_KEY,
    critical: true,
    run: async (ctx) => {
      const { maxCandidates, ...poolOptions } = options;
      const topology = ctx.session.require(TOPOLOGY_STATE_KEY, isMarketTopology);
      const limit = maxCandidates ?? topology.candidates.length;
      return runEnrichmentPool({
        ...poolOptions,
        candidates: topology.candidates.slice(0, limit),
        parentSpan: ctx.span,
        ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
      });
    },
  };
}
