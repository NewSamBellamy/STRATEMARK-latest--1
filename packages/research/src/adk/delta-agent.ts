/**
 * Signal Watcher — dynamic deck growth as an ADK LoopAgent.
 *
 * This is what makes the deck *living*. The initial run maps a topology and
 * hydrates it; the watcher keeps going, sweeping focus angles the first pass
 * did not cover and folding whatever it finds back into the deck as deltas.
 *
 * It is modelled on ADK's `LoopAgent`, including the part that framework gets
 * right and hand-rolled loops usually get wrong: a loop needs *two* independent
 * brakes. `maxIterations` is the hard cap, and `escalate` is the semantic exit —
 * raised here when a pass stops finding anything new. Without the second brake
 * the watcher would keep paying for grounded searches over an exhausted market;
 * without the first, a market that keeps yielding marginal hits would never stop.
 *
 * Growth is strictly additive and deduplicated: the exclusion set accumulates
 * across iterations, so a company found in pass one is never re-researched in
 * pass three. Nothing is invented to keep the loop interesting — an empty pass
 * is the signal to stop, not a prompt to lower the bar.
 */
import type { CardWithCompany, ExpandFocus, LivingDeckDelta } from '@mi/contracts';
import { IncrementalDeltaAgent } from '../delta-agent';
import { throwIfAborted, sleep, type RateLimiter } from '../util';
import type { CompanyCandidate, LlmClient, MarketPlan } from '../types';
import type { OriginalSourceServices } from '../original-source';
import { toTraceError, type AdkSpan, type AdkTelemetryHub } from './telemetry';
import type { AdkTaskNode } from './task-graph';
import { ENRICHMENT_STATE_KEY, isEnrichmentPoolResult } from './enrichment-pool';

// ============================================================================
// 1. Contracts
// ============================================================================

export type WatchStopReason =
  | 'max_iterations'
  | 'no_growth'
  | 'aborted'
  | 'failed'
  | 'exhausted_focus_queue';

export interface WatchIteration {
  iteration: number;
  focus: string;
  /** Cards added by this pass, after exclusion. */
  added: number;
  discovered: number;
  durationMs: number;
  error: string | null;
}

export interface SignalWatchResult {
  cards: CardWithCompany[];
  deltas: LivingDeckDelta[];
  iterations: WatchIteration[];
  stoppedReason: WatchStopReason;
  escalated: boolean;
}

export interface ExistingEntity {
  name: string;
  domain?: string | null;
}

export interface SignalWatcherOptions {
  originalSources?: OriginalSourceServices;
  client: LlmClient;
  plan: MarketPlan;
  telemetry: AdkTelemetryHub;
  parentSpan?: AdkSpan | null;
  signal?: AbortSignal;
  deckId?: string;
  deckUserValues?: number[];
  /** Entities already in the deck; seeds the accumulating exclusion set. */
  existing?: readonly ExistingEntity[];
  /**
   * Focus angles to sweep, one per iteration. Defaults to a broad-to-narrow
   * sweep across the signal types the first pass under-covers.
   */
  focusQueue?: readonly (ExpandFocus | string)[];
  /** Hard cap on passes (ADK `max_iterations`). Defaults to 3. */
  maxIterations?: number;
  /** Entities requested per pass. Defaults to 3. */
  targetPerIteration?: number;
  /** Escalate and stop when a pass adds fewer than this. Defaults to 1. */
  minGrowthToContinue?: number;
  /** Optional pause between passes, for long-lived watching decks. */
  intervalMs?: number;
  rateLimiter?: RateLimiter;
  onCard?: (card: CardWithCompany) => void;
  onDelta?: (delta: LivingDeckDelta) => void;
}

/**
 * Angles chosen because they are the ones a single discovery pass reliably
 * under-covers: the very small, the very new, and sourced signal.
 */
export const DEFAULT_FOCUS_QUEUE: readonly string[] = [
  'notable companies missed in the initial pass, especially early-stage and recently founded entrants',
  'documented controversies, lawsuits, or regulatory actions involving companies in this market',
  'community, ethos, and giving signals attached to companies in this market',
];

// ============================================================================
// 2. The watcher
// ============================================================================

function titleOf(card: CardWithCompany): string {
  return card.company?.name ?? card.card.title ?? 'Untitled card';
}

/**
 * Render a focus for the trace. `ExpandFocus` is a structured object, so
 * stringifying it naively would log "[object Object]" and make the watch loop
 * unreadable in exactly the traces you would open to debug it.
 */
export function describeFocus(focus: ExpandFocus | string): string {
  if (typeof focus === 'string') return focus;
  const parts: string[] = [];
  if (focus.cardType !== undefined) parts.push(`cardType=${focus.cardType}`);
  if (focus.tier !== undefined) parts.push(`tier=${focus.tier}`);
  return parts.length > 0 ? parts.join(' ') : 'unspecified focus';
}

/**
 * Run the watch loop until it is capped, exhausted, or aborted.
 */
export async function runSignalWatcher(
  options: SignalWatcherOptions,
): Promise<SignalWatchResult> {
  const {
    client,
    plan,
    telemetry,
    signal,
    deckId,
    rateLimiter,
    onCard,
    onDelta,
  } = options;

  const maxIterations = Math.max(1, options.maxIterations ?? 3);
  const targetPerIteration = Math.max(1, options.targetPerIteration ?? 3);
  const minGrowth = Math.max(1, options.minGrowthToContinue ?? 1);
  const focusQueue = options.focusQueue ?? DEFAULT_FOCUS_QUEUE;

  const loopSpan = telemetry.startSpan('signal_watcher', 'loop', {
    parent: options.parentSpan ?? null,
    branchSegment: 'watcher',
    attributes: { maxIterations, targetPerIteration, focusAngles: focusQueue.length },
  });

  const agent = new IncrementalDeltaAgent(client, {
    marketName: plan.marketName,
    vertical: plan.vertical,
    geography: plan.geography,
    ...(deckId === undefined ? {} : { deckId }),
    ...(options.deckUserValues === undefined ? {} : { deckUserValues: options.deckUserValues }),
  });

  // The exclusion set accumulates so later passes never re-research earlier hits.
  const exclude: Array<{ name: string; domain?: string | null }> = [
    ...(options.existing ?? []).map((entity) => ({
      name: entity.name,
      domain: entity.domain ?? null,
    })),
  ];

  const cards: CardWithCompany[] = [];
  const deltas: LivingDeckDelta[] = [];
  const iterations: WatchIteration[] = [];
  let stoppedReason: WatchStopReason = 'max_iterations';
  let escalated = false;
  let deltaSeq = 0;

  const emitDelta = (delta: LivingDeckDelta): void => {
    deltas.push(delta);
    onDelta?.(delta);
  };

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (signal?.aborted) {
      stoppedReason = 'aborted';
      break;
    }

    const focus = focusQueue[iteration % focusQueue.length];
    if (focus === undefined) {
      stoppedReason = 'exhausted_focus_queue';
      break;
    }

    const passSpan = loopSpan.child(`watch_pass.${iteration + 1}`, 'llm', {
      branchSegment: `pass-${iteration + 1}`,
      attributes: { iteration: iteration + 1, focus: describeFocus(focus) },
    });
    const startedAt = telemetry.now();

    try {
      throwIfAborted(signal);
      if (rateLimiter) await rateLimiter.acquire(signal);

      passSpan.toolCall('delta_agent.search', { iteration: iteration + 1 });
      const result = await agent.searchDelta({
        originalSources: options.originalSources,
        focus,
        target: targetPerIteration,
        exclude: [...exclude],
        ...(signal === undefined ? {} : { signal }),
      });
      passSpan.toolResult('delta_agent.search', {
        discovered: result.stats.discoveredCount,
        added: result.cards.length,
      });

      for (const card of result.cards) {
        cards.push(card);
        onCard?.(card);
        if (card.company) {
          exclude.push({ name: card.company.name, domain: card.company.websiteUrl });
        }

        if (deckId !== undefined) {
          deltaSeq += 1;
          emitDelta({
            id: `dlt-watch-${iteration + 1}-${deltaSeq}`,
            deckId,
            at: new Date(telemetry.now()).toISOString(),
            author: 'signal_watcher',
            invocationId: telemetry.invocationId,
            kind: 'card_added',
            cardId: card.card.id,
            cardType: card.card.cardType,
            title: titleOf(card),
            vector: null,
          });
        }
      }

      const durationMs = Math.max(0, telemetry.now() - startedAt);
      iterations.push({
        iteration: iteration + 1,
        focus: describeFocus(focus),
        added: result.cards.length,
        discovered: result.stats.discoveredCount,
        durationMs,
        error: null,
      });

      passSpan.end({ added: result.cards.length, discovered: result.stats.discoveredCount });

      // The semantic brake: an exhausted market should stop the loop, not be
      // ground over for the remaining iterations.
      if (result.cards.length < minGrowth) {
        escalated = true;
        stoppedReason = 'no_growth';
        loopSpan.escalate(`pass ${iteration + 1} added ${result.cards.length} cards; market appears exhausted`, {
          iteration: iteration + 1,
          added: result.cards.length,
        });
        break;
      }

      if (options.intervalMs && iteration < maxIterations - 1) {
        await sleep(options.intervalMs, signal);
      }
    } catch (err) {
      const error = toTraceError(err);
      passSpan.fail(err, { iteration: iteration + 1 });
      iterations.push({
        iteration: iteration + 1,
        focus: describeFocus(focus),
        added: 0,
        discovered: 0,
        durationMs: Math.max(0, telemetry.now() - startedAt),
        error: error.message,
      });

      if (error.name === 'AbortError') {
        stoppedReason = 'aborted';
      } else {
        stoppedReason = 'failed';
      }
      break;
    }
  }

  loopSpan.end({
    iterations: iterations.length,
    cards: cards.length,
    stoppedReason,
    escalated,
  });

  return { cards, deltas, iterations, stoppedReason, escalated };
}

// ============================================================================
// 3. Graph integration
// ============================================================================

export const WATCHER_NODE_ID = 'watcher';
export const WATCHER_STATE_KEY = 'signal_watch_result';

export function isSignalWatchResult(value: unknown): value is SignalWatchResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { cards?: unknown; iterations?: unknown };
  return Array.isArray(candidate.cards) && Array.isArray(candidate.iterations);
}

export type WatcherNodeOptions = Omit<SignalWatcherOptions, 'existing' | 'parentSpan'>;

/**
 * Build the watcher node. It seeds its exclusion set from whatever the
 * enrichment pool already hydrated, read out of session state — so the watcher
 * never re-researches a company the pool just finished.
 */
export function createWatcherNode(options: WatcherNodeOptions): AdkTaskNode {
  return {
    id: WATCHER_NODE_ID,
    author: 'signal_watcher',
    kind: 'loop',
    description: 'Signal watcher & dynamic deck growth',
    dependsOn: ['enrichment'],
    outputKey: WATCHER_STATE_KEY,
    // Non-critical: the deck is already usable without further growth.
    critical: false,
    run: async (ctx) => {
      const enrichment = ctx.session.read(ENRICHMENT_STATE_KEY, isEnrichmentPoolResult);
      const existing: ExistingEntity[] = (enrichment?.hydrated ?? []).map((result) => ({
        name: result.company.name,
        domain: result.company.websiteUrl,
      }));

      return runSignalWatcher({
        ...options,
        existing,
        parentSpan: ctx.span,
        ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
      });
    },
  };
}

/** Helper for callers that hold candidates rather than hydrated results. */
export function toExistingEntities(
  candidates: readonly CompanyCandidate[],
): ExistingEntity[] {
  return candidates.map((candidate) => ({ name: candidate.name, domain: candidate.domain }));
}
