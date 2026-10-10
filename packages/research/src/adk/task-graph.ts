/**
 * ADK Task Graph — the DAG orchestrator behind the Living Deck engine.
 *
 * ADK composes agents with `SequentialAgent` and `ParallelAgent`. Those two
 * shapes are the degenerate cases of a dependency graph, and a market research
 * run is genuinely graph-shaped: three discovery vectors fan out in parallel,
 * converge into one catalog, fan out again across enrichment workers, and
 * converge into a delta watcher. Expressing that as a DAG rather than nested
 * workflow agents means the scheduler can start any node the moment its inputs
 * are ready — which is what keeps hydration streaming instead of stair-stepping.
 *
 * Semantics:
 *   - **Greedy scheduling.** A node runs as soon as its dependencies succeed and
 *     a concurrency slot is free. No artificial wave barriers.
 *   - **Failure is typed, not fatal by default.** A `critical` node aborts the
 *     run; a non-critical one only skips its dependents, so a single dead
 *     company cannot sink the deck.
 *   - **State flows through `outputKey`.** Exactly like ADK: a node's return
 *     value lands in session state under its key, and downstream nodes read it.
 *   - **Every node is a span.** Timing, failures, and state writes are traced
 *     without the node authors having to remember to instrument anything.
 */
import {
  adkAgentGraphSchema,
  type AdkAgentKind,
  type AdkAttributeValue,
  type AdkAttributes,
  type AdkNodeState,
  type AdkStateDelta,
  type AdkTraceError,
  type LivingDeckNodeStatus,
} from '@mi/contracts';
import { throwIfAborted } from '../util';
import { toTraceError, type AdkSpan, type AdkTelemetryHub } from './telemetry';

// ============================================================================
// 1. Session state
// ============================================================================

export class AdkSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdkSessionError';
  }
}

/**
 * Render an arbitrary session value as a trace-safe scalar.
 *
 * State holds real domain objects (candidates, cards), but the *trace* must stay
 * cheap and serializable, so we record shape rather than payload.
 */
function describeValue(value: unknown): AdkAttributeValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value instanceof Map) return `Map(${value.size})`;
  if (value instanceof Set) return `Set(${value.size})`;
  if (typeof value === 'object') return `Object(${Object.keys(value).length})`;
  return typeof value;
}

/**
 * ADK's `session.state`: a shared key/value scratchpad that every node in one
 * invocation reads from and writes to.
 *
 * Reads are guard-based rather than cast-based. `require('catalog', isCatalog)`
 * proves the shape at runtime instead of asserting it at compile time, which
 * matters because the value was produced by another agent — possibly an LLM —
 * and the type system cannot vouch for it.
 */
export class AdkSession {
  private readonly values = new Map<string, unknown>();

  has(key: string): boolean {
    return this.values.has(key);
  }

  get(key: string): unknown {
    return this.values.get(key);
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  delete(key: string): boolean {
    return this.values.delete(key);
  }

  keys(): string[] {
    return [...this.values.keys()];
  }

  /** Read a value, returning null unless it satisfies `guard`. */
  read<T>(key: string, guard: (value: unknown) => value is T): T | null {
    const value = this.values.get(key);
    return guard(value) ? value : null;
  }

  /** Read a value, throwing when it is absent or the wrong shape. */
  require<T>(key: string, guard: (value: unknown) => value is T): T {
    if (!this.values.has(key)) {
      throw new AdkSessionError(`Session state is missing required key "${key}".`);
    }
    const value = this.values.get(key);
    if (!guard(value)) {
      throw new AdkSessionError(`Session state key "${key}" holds an unexpected shape.`);
    }
    return value;
  }

  /** Trace-safe projection of the given keys (ADK `actions.state_delta`). */
  toStateDelta(keys: readonly string[]): AdkStateDelta {
    const delta: AdkStateDelta = {};
    for (const key of keys) delta[key] = describeValue(this.values.get(key));
    return delta;
  }
}

// ============================================================================
// 2. Node contracts
// ============================================================================

export interface AdkTaskContext {
  readonly nodeId: string;
  readonly session: AdkSession;
  readonly span: AdkSpan;
  readonly telemetry: AdkTelemetryHub;
  readonly signal?: AbortSignal;
}

export interface AdkTaskNode {
  id: string;
  /** Agent name used as the trace author. Defaults to the node id. */
  author?: string;
  kind?: AdkAgentKind;
  description?: string;
  dependsOn?: readonly string[];
  /** Session key that receives this node's return value. */
  outputKey?: string | null;
  /** When true (the default), a failure aborts the whole graph. */
  critical?: boolean;
  /** Optional timeout in milliseconds for this specific node. */
  timeoutMs?: number;
  run: (ctx: AdkTaskContext) => Promise<unknown>;
}

export interface AdkNodeFailure {
  nodeId: string;
  error: AdkTraceError;
}

export interface AdkTaskGraphResult {
  session: AdkSession;
  statuses: LivingDeckNodeStatus[];
  /** Node ids in the order they completed — the real execution trace. */
  completionOrder: string[];
  failures: AdkNodeFailure[];
  /** True when a critical failure or an abort signal cut the run short. */
  aborted: boolean;
}

export interface RunAdkTaskGraphOptions {
  nodes: readonly AdkTaskNode[];
  telemetry: AdkTelemetryHub;
  session?: AdkSession;
  /** Maximum nodes in flight. Defaults to 4. */
  concurrency?: number;
  signal?: AbortSignal;
  parentSpan?: AdkSpan | null;
  /** Called whenever a node changes state — drives live progress UI. */
  onNodeState?: (status: LivingDeckNodeStatus) => void;
}

export class AdkGraphError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = 'AdkGraphError';
    this.issues = issues;
  }
}

// ============================================================================
// 3. Validation
// ============================================================================

/**
 * Validate the plan against the shared contract before running anything.
 *
 * Reusing `adkAgentGraphSchema` here is deliberate: duplicate ids, dangling
 * dependencies, and cycles are caught by exactly the same rule that guards a
 * graph arriving over IPC, so the executor cannot drift from the contract.
 */
export function validateTaskGraph(nodes: readonly AdkTaskNode[]): void {
  const parsed = adkAgentGraphSchema.safeParse({
    nodes: nodes.map((node) => ({
      id: node.id,
      kind: node.kind ?? 'custom',
      description: node.description ?? '',
      dependsOn: [...(node.dependsOn ?? [])],
      outputKey: node.outputKey ?? null,
      critical: node.critical ?? true,
    })),
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message);
    throw new AdkGraphError(`Invalid ADK agent graph: ${issues.join('; ')}`, issues);
  }
}

// ============================================================================
// 4. Executor
// ============================================================================

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Execute an ADK agent DAG with bounded concurrency and full trace coverage.
 */
export async function runAdkTaskGraph(
  options: RunAdkTaskGraphOptions,
): Promise<AdkTaskGraphResult> {
  const { nodes, telemetry, signal, onNodeState } = options;
  validateTaskGraph(nodes);

  const session = options.session ?? new AdkSession();
  const concurrency = Math.max(1, options.concurrency ?? 4);

  const statuses = new Map<string, LivingDeckNodeStatus>(
    nodes.map((node) => [
      node.id,
      {
        nodeId: node.id,
        state: 'pending' as AdkNodeState,
        startedAt: null,
        endedAt: null,
        durationMs: null,
        attempts: 0,
        error: null,
      },
    ]),
  );

  const completionOrder: string[] = [];
  const failures: AdkNodeFailure[] = [];
  const running = new Map<string, Promise<void>>();
  let stopScheduling = false;
  let aborted = false;

  const publish = (status: LivingDeckNodeStatus): void => {
    statuses.set(status.nodeId, status);
    onNodeState?.(status);
  };

  const stateOf = (id: string): AdkNodeState => statuses.get(id)?.state ?? 'pending';

  const markSkipped = (node: AdkTaskNode, reason: string): void => {
    const current = statuses.get(node.id);
    if (current === undefined || current.state !== 'pending') return;
    publish({ ...current, state: 'skipped', endedAt: iso(telemetry.now()), error: reason });
  };

  /** Cascade skips: a node whose dependency died can never become ready. */
  const cascadeSkips = (): void => {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const node of nodes) {
        if (stateOf(node.id) !== 'pending') continue;
        for (const dep of node.dependsOn ?? []) {
          const depState = stateOf(dep);
          if (depState === 'failed' || depState === 'skipped') {
            markSkipped(node, `dependency "${dep}" did not succeed`);
            progressed = true;
            break;
          }
        }
      }
    }
  };

  const isReady = (node: AdkTaskNode): boolean => {
    if (stateOf(node.id) !== 'pending') return false;
    for (const dep of node.dependsOn ?? []) {
      if (stateOf(dep) !== 'succeeded') return false;
    }
    return true;
  };

  const launch = (node: AdkTaskNode): void => {
    const startedAtMs = telemetry.now();
    const previous = statuses.get(node.id);
    publish({
      nodeId: node.id,
      state: 'running',
      startedAt: iso(startedAtMs),
      endedAt: null,
      durationMs: null,
      attempts: (previous?.attempts ?? 0) + 1,
      error: null,
    });

    const span = telemetry.startSpan(node.author ?? node.id, node.kind ?? 'custom', {
      parent: options.parentSpan ?? null,
      branchSegment: node.id,
      attributes: { node: node.id, description: node.description ?? '' },
    });

    const task = (async (): Promise<void> => {
      let nodeSignal = signal;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let controller: AbortController | undefined;
      let onParentAbort: (() => void) | undefined;

      if (node.timeoutMs && node.timeoutMs > 0) {
        controller = new AbortController();
        if (signal?.aborted) {
          controller.abort(signal.reason);
        } else if (signal) {
          onParentAbort = () => controller?.abort(signal.reason);
          signal.addEventListener('abort', onParentAbort, { once: true });
        }
        timer = setTimeout(() => {
          controller?.abort(new Error(`Node "${node.id}" timed out after ${node.timeoutMs}ms`));
        }, node.timeoutMs);
        nodeSignal = controller.signal;
      }

      try {
        throwIfAborted(nodeSignal);
        const value = await node.run({
          nodeId: node.id,
          session,
          span,
          telemetry,
          signal: nodeSignal,
        });

        if (node.outputKey) {
          session.set(node.outputKey, value);
          span.stateDelta(session.toStateDelta([node.outputKey]), `wrote ${node.outputKey}`);
        }

        const endedAtMs = telemetry.now();
        const attributes: AdkAttributes = { node: node.id };
        span.end(attributes);
        completionOrder.push(node.id);
        publish({
          nodeId: node.id,
          state: 'succeeded',
          startedAt: iso(startedAtMs),
          endedAt: iso(endedAtMs),
          durationMs: Math.max(0, endedAtMs - startedAtMs),
          attempts: (previous?.attempts ?? 0) + 1,
          error: null,
        });
      } catch (err) {
        const endedAtMs = telemetry.now();
        const error = toTraceError(err);
        span.fail(err, { node: node.id });
        failures.push({ nodeId: node.id, error });
        completionOrder.push(node.id);
        publish({
          nodeId: node.id,
          state: 'failed',
          startedAt: iso(startedAtMs),
          endedAt: iso(endedAtMs),
          durationMs: Math.max(0, endedAtMs - startedAtMs),
          attempts: (previous?.attempts ?? 0) + 1,
          error: error.message,
        });

        const isCritical = node.critical !== false;
        if (isCritical) {
          stopScheduling = true;
          aborted = true;
          cascadeSkips();
        }
      } finally {
        if (timer) clearTimeout(timer);
        if (signal && onParentAbort) signal.removeEventListener('abort', onParentAbort);
        running.delete(node.id);
      }
    })();

    running.set(node.id, task);
  };

  for (;;) {
    if (signal?.aborted) {
      stopScheduling = true;
      aborted = true;
    }

    cascadeSkips();

    if (!stopScheduling) {
      while (running.size < concurrency) {
        const next = nodes.find((node) => isReady(node));
        if (next === undefined) break;
        launch(next);
      }
    }

    if (running.size === 0) break;
    await Promise.race(running.values());
  }

  if (stopScheduling) {
    for (const node of nodes) markSkipped(node, 'run halted before this node started');
  }
  cascadeSkips();

  // Preserve the caller's declared node order in the returned statuses.
  const ordered: LivingDeckNodeStatus[] = [];
  for (const node of nodes) {
    const status = statuses.get(node.id);
    if (status !== undefined) ordered.push(status);
  }

  return { session, statuses: ordered, completionOrder, failures, aborted };
}
