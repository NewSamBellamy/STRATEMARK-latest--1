/**
 * ADK Living Deck engine — DAG, telemetry, and agent behaviour.
 *
 * The suite is organized around the properties that actually matter in
 * production: that the graph respects dependencies and degrades instead of
 * collapsing, that the trace is complete enough to debug a run from, and that
 * no path can emit a figure the provenance rules would reject.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZodType, ZodTypeDef } from 'zod';
import {
  adkAgentGraphSchema,
  applyLivingDeckDelta,
  createLivingDeckState,
  detectGraphCycle,
  livingDeckDeltaSchema,
  summarizeTrace,
  upsertNodeStatus,
  type Card,
  type CardWithCompany,
  type Company,
  type CompanyMetric,
  type LivingDeckDelta,
} from '@mi/contracts';
import type { CompanyCandidate, LlmClient, MarketPlan } from '../../types';
import type { HydrateCompanyCardResult } from '../../company-agent';
import type { DeltaSearchResult } from '../../delta-agent';
// Namespace type imports so the vi.mock factories can spread the real module
// without inline `import()` type annotations, which the lint config forbids.
import type * as CompanyAgentModule from '../../company-agent';
import type * as DeltaAgentModule from '../../delta-agent';

import { AdkTelemetryHub, createDeterministicTelemetry, toTraceError } from '../telemetry';
import {
  AdkGraphError,
  AdkSession,
  AdkSessionError,
  runAdkTaskGraph,
  validateTaskGraph,
  type AdkTaskNode,
} from '../task-graph';
import {
  DEFAULT_VECTOR_TARGETS,
  mapMarketTopology,
  mergeTopology,
  runDiscoveryVector,
  type VectorDiscoveryResult,
} from '../discovery-agent';
import { buildHydrationDeltas, runEnrichmentPool } from '../enrichment-pool';
import { runSignalWatcher } from '../delta-agent';
import { LivingDeckEngine, describeAgentGraph } from '../engine';

// ============================================================================
// Mocks
// ============================================================================

const hoisted = vi.hoisted(() => ({
  hydrateCompanyCard: vi.fn(),
  searchDelta: vi.fn(),
}));

vi.mock('../../company-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof CompanyAgentModule>();
  return { ...actual, hydrateCompanyCard: hoisted.hydrateCompanyCard };
});

vi.mock('../../delta-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof DeltaAgentModule>();
  class MockIncrementalDeltaAgent {
    searchDelta = hoisted.searchDelta;
  }
  return { ...actual, IncrementalDeltaAgent: MockIncrementalDeltaAgent };
});

// ============================================================================
// Fixtures
// ============================================================================

const PLAN: MarketPlan = {
  marketName: 'AI Inference Infrastructure',
  vertical: 'AI infrastructure',
  geography: null,
  notes: null,
  searchThemes: ['inference serving', 'GPU clouds'],
};

function makeCompany(name: string, id = `cmp_${name.toLowerCase()}`): Company {
  return {
    id,
    name,
    oneLiner: `${name} does inference`,
    logoUrl: null,
    hqLocation: null,
    websiteUrl: `${name.toLowerCase()}.com`,
    brandTheme: null,
  };
}

function makeCard(id: string, companyId: string | null, title: string | null): Card {
  return {
    id,
    deckId: 'deck_1',
    companyId,
    cardType: 'company',
    title,
    summary: null,
    tier: 4,
    tierReason: null,
    citations: [],
    keyPoints: [],
    createdAt: '2026-08-22T00:00:00.000Z',
  };
}

function makeMetric(overrides: Partial<CompanyMetric> = {}): CompanyMetric {
  return {
    id: 'met_1',
    companyId: 'cmp_1',
    metricType: 'arr',
    value: 12_000_000,
    confidence: 'estimated',
    source: null,
    citations: [],
    methodNote: null,
    capturedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

function makeCandidate(name: string): CompanyCandidate {
  return {
    name,
    domain: `${name.toLowerCase()}.com`,
    descriptor: `${name} descriptor`,
    primaryRole: 'company',
    cardTypes: ['company'],
  };
}

function makeHydrationResult(
  name: string,
  metrics: CompanyMetric[] = [makeMetric()],
): HydrateCompanyCardResult {
  const company = makeCompany(name);
  const card = makeCard(`card_${name.toLowerCase()}`, company.id, name);
  const cardWithCompany: CardWithCompany = { card, company, metrics, viceClaims: [] };
  return {
    candidate: makeCandidate(name),
    company,
    metrics,
    card,
    cards: [cardWithCompany],
    primaryCard: cardWithCompany,
    citations: [],
    viceClaims: [],
    cultureNote: null,
    // These carry richer runtime shapes that this suite never reads; the pool
    // only forwards them, so representative empties keep the fixture honest.
    enrichment: {} as HydrateCompanyCardResult['enrichment'],
    cmsResult: {} as HydrateCompanyCardResult['cmsResult'],
    memory: {} as HydrateCompanyCardResult['memory'],
  };
}

function makeCardWithCompany(name: string): CardWithCompany {
  const company = makeCompany(name);
  return {
    card: makeCard(`card_${name.toLowerCase()}`, company.id, name),
    company,
    metrics: [],
    viceClaims: [],
  };
}

/** A discovery-capable fake client: grounded pass, then structured pass. */
function fakeDiscoveryClient(
  rowsByFocus: Record<string, Array<{ name: string; domain: string | null }>>,
  opts: { failFocus?: string[] } = {},
): LlmClient {
  return {
    ground: vi.fn(async (prompt: string) => {
      const focus = detectFocus(prompt);
      if (opts.failFocus?.includes(focus)) throw new Error(`vector ${focus} exploded`);
      return {
        text: `notes for ${focus}`,
        citations: [{ title: 'Source', url: `https://example.com/${focus}` }],
        queries: [focus],
      };
    }),
    // `vi.fn` erases the generic, so the mock is cast to the client's own
    // signature — the repo's established pattern for LlmClient test doubles.
    structure: vi.fn(
      async (prompt: string, schema: ZodType<unknown, ZodTypeDef, unknown>): Promise<unknown> => {
        const focus = detectFocus(prompt);
        const rows = (rowsByFocus[focus] ?? []).map((row) => ({
          name: row.name,
          domain: row.domain,
          descriptor: `${row.name} descriptor`,
          primaryRole: null,
          cardTypes: [],
        }));
        return schema.parse({ companies: rows });
      },
    ) as unknown as LlmClient['structure'],
  };
}

function detectFocus(prompt: string): string {
  if (prompt.includes('focused on infrastructure') || prompt.includes('notes for infrastructure') || prompt.includes('infrastructure providers') || prompt.includes('infrastructure_supply')) return 'infrastructure';
  if (prompt.includes('focused on distribution') || prompt.includes('notes for distribution') || prompt.includes('distribution/channel') || prompt.includes('distribution_channel')) return 'distribution';
  return 'company';
}

function vectorResult(
  vector: VectorDiscoveryResult['vector'],
  names: Array<{ name: string; domain?: string | null; cardTypes?: Card['cardType'][] }>,
): VectorDiscoveryResult {
  return {
    vector,
    rejected: 0,
    citations: [],
    candidates: names.map((entry) => ({
      name: entry.name,
      domain: entry.domain ?? `${entry.name.toLowerCase().replace(/\s+/g, '')}.com`,
      descriptor: `${entry.name} descriptor`,
      primaryRole: 'company',
      cardTypes: entry.cardTypes ?? ['company'],
      vector,
      vectors: [vector],
      identityKeys: [entry.name.toLowerCase().replace(/[^a-z0-9]/g, '')],
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// 1. Telemetry
// ============================================================================

describe('AdkTelemetryHub', () => {
  it('produces deterministic ids and composes branch paths from the agent tree', () => {
    const hub = createDeterministicTelemetry();
    const parent = hub.startSpan('discovery_agent', 'parallel', { branchSegment: 'discovery' });
    const child = parent.child('worker', 'pool_worker', { branchSegment: 'worker-0' });

    expect(hub.invocationId).toBe('inv-test');
    expect(parent.branch).toBe('root.discovery');
    expect(child.branch).toBe('root.discovery.worker-0');
    expect(child.parentSpanId).toBe(parent.spanId);
  });

  it('records duration and closes the span on end', () => {
    const hub = createDeterministicTelemetry({ stepMs: 10 });
    const span = hub.startSpan('agent', 'llm');
    const event = span.end();

    expect(span.isClosed).toBe(true);
    expect(event.phase).toBe('agent_end');
    expect(event.durationMs).toBeGreaterThan(0);
  });

  it('marks failures with error severity and a structured error payload', () => {
    const hub = createDeterministicTelemetry();
    const span = hub.startSpan('agent', 'llm');
    const event = span.fail(new Error('boom'));

    expect(event.phase).toBe('error');
    expect(event.severity).toBe('error');
    expect(event.error).toEqual({ name: 'Error', message: 'boom', retryable: false });
  });

  it('classifies 429 and 5xx as retryable but never an abort', () => {
    const rateLimited = Object.assign(new Error('slow down'), { status: 429 });
    const serverError = Object.assign(new Error('upstream'), { status: 503 });
    const aborted = Object.assign(new Error('aborted'), { status: 503, name: 'AbortError' });

    expect(toTraceError(rateLimited).retryable).toBe(true);
    expect(toTraceError(serverError).retryable).toBe(true);
    expect(toTraceError(aborted).retryable).toBe(false);
    expect(toTraceError('not an error').name).toBe('UnknownError');
  });

  it('isolates a throwing sink so observers cannot break the observed run', () => {
    const onSinkError = vi.fn();
    const healthy = vi.fn();
    const hub = createDeterministicTelemetry({
      sinks: [
        () => {
          throw new Error('bad sink');
        },
        healthy,
      ],
      onSinkError,
    });

    expect(() => hub.startSpan('agent', 'llm').end()).not.toThrow();
    expect(onSinkError).toHaveBeenCalled();
    expect(healthy).toHaveBeenCalled();
  });

  it('bounds the buffer so a long-lived watching deck cannot leak trace history', () => {
    const hub = createDeterministicTelemetry({ maxBufferedEvents: 5 });
    for (let i = 0; i < 20; i += 1) hub.startSpan(`agent-${i}`, 'llm').end();
    expect(hub.snapshot()).toHaveLength(5);
  });

  it('unsubscribes cleanly', () => {
    const hub = createDeterministicTelemetry();
    const sink = vi.fn();
    const unsubscribe = hub.subscribe(sink);
    hub.startSpan('a', 'llm').end();
    const seen = sink.mock.calls.length;
    unsubscribe();
    hub.startSpan('b', 'llm').end();
    expect(sink.mock.calls.length).toBe(seen);
  });

  it('summarizes a trace into a reviewable receipt', () => {
    const hub = createDeterministicTelemetry();
    hub.startInvocation();
    const ok = hub.startSpan('good_agent', 'llm');
    ok.end();
    const bad = hub.startSpan('bad_agent', 'llm');
    bad.escalate('quota exhausted');
    bad.fail(new Error('dead'));
    hub.endInvocation();

    const summary = summarizeTrace(hub.snapshot());
    expect(summary.invocationIds).toEqual(['inv-test']);
    expect(summary.eventsByPhase.invocation_start).toBe(1);
    expect(summary.eventsByPhase.invocation_end).toBe(1);
    expect(summary.escalated).toBe(true);
    expect(summary.errorCount).toBeGreaterThan(0);
    expect(summary.authors.map((author) => author.author)).toContain('bad_agent');
  });
});

// ============================================================================
// 2. Session state
// ============================================================================

describe('AdkSession', () => {
  const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((entry) => typeof entry === 'string');

  it('round-trips values and reads them through a type guard', () => {
    const session = new AdkSession();
    session.set('names', ['a', 'b']);
    expect(session.require('names', isStringArray)).toEqual(['a', 'b']);
    expect(session.has('names')).toBe(true);
    expect(session.keys()).toEqual(['names']);
  });

  it('throws a typed error for a missing key', () => {
    const session = new AdkSession();
    expect(() => session.require('missing', isStringArray)).toThrow(AdkSessionError);
  });

  it('throws when a key holds an unexpected shape rather than casting blindly', () => {
    const session = new AdkSession();
    session.set('names', 42);
    expect(() => session.require('names', isStringArray)).toThrow(/unexpected shape/);
    expect(session.read('names', isStringArray)).toBeNull();
  });

  it('projects state into a trace-safe delta describing shape, not payload', () => {
    const session = new AdkSession();
    session.set('list', [1, 2, 3]);
    session.set('flag', true);
    session.set('obj', { a: 1, b: 2 });
    session.set('missing', undefined);

    expect(session.toStateDelta(['list', 'flag', 'obj', 'missing'])).toEqual({
      list: 'Array(3)',
      flag: true,
      obj: 'Object(2)',
      missing: null,
    });
  });
});

// ============================================================================
// 3. Task graph
// ============================================================================

describe('runAdkTaskGraph', () => {
  const node = (
    id: string,
    dependsOn: string[],
    run: AdkTaskNode['run'],
    extra: Partial<AdkTaskNode> = {},
  ): AdkTaskNode => ({ id, dependsOn, run, ...extra });

  it('honours dependency order', async () => {
    const order: string[] = [];
    const hub = createDeterministicTelemetry();
    const result = await runAdkTaskGraph({
      telemetry: hub,
      nodes: [
        node('c', ['b'], async () => {
          order.push('c');
        }),
        node('a', [], async () => {
          order.push('a');
        }),
        node('b', ['a'], async () => {
          order.push('b');
        }),
      ],
    });

    expect(order).toEqual(['a', 'b', 'c']);
    expect(result.statuses.every((status) => status.state === 'succeeded')).toBe(true);
    expect(result.aborted).toBe(false);
  });

  it('chains results through session state via outputKey', async () => {
    const hub = createDeterministicTelemetry();
    const isNumber = (value: unknown): value is number => typeof value === 'number';

    const result = await runAdkTaskGraph({
      telemetry: hub,
      nodes: [
        node('produce', [], async () => 21, { outputKey: 'seed' }),
        node(
          'consume',
          ['produce'],
          async (ctx) => ctx.session.require('seed', isNumber) * 2,
          { outputKey: 'doubled' },
        ),
      ],
    });

    expect(result.session.get('doubled')).toBe(42);
    const deltaEvents = hub.snapshot().filter((event) => event.phase === 'state_delta');
    expect(deltaEvents.map((event) => event.stateDelta)).toContainEqual({ seed: 21 });
  });

  it('runs independent nodes concurrently', async () => {
    const hub = createDeterministicTelemetry();
    let inFlight = 0;
    let peak = 0;
    const gate = async (): Promise<void> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    };

    await runAdkTaskGraph({
      telemetry: hub,
      concurrency: 3,
      nodes: [node('a', [], gate), node('b', [], gate), node('c', [], gate)],
    });

    expect(peak).toBeGreaterThan(1);
  });

  it('rejects a cyclic graph before executing anything', async () => {
    const hub = createDeterministicTelemetry();
    const run = vi.fn(async () => undefined);

    await expect(
      runAdkTaskGraph({
        telemetry: hub,
        nodes: [node('a', ['b'], run), node('b', ['a'], run)],
      }),
    ).rejects.toThrow(AdkGraphError);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects dangling and self dependencies', () => {
    expect(() =>
      validateTaskGraph([{ id: 'a', dependsOn: ['ghost'], run: async () => undefined }]),
    ).toThrow(/unknown node "ghost"/);

    expect(() =>
      validateTaskGraph([{ id: 'a', dependsOn: ['a'], run: async () => undefined }]),
    ).toThrow(/depends on itself/);
  });

  it('skips dependents of a non-critical failure but keeps the rest of the run alive', async () => {
    const hub = createDeterministicTelemetry();
    const unrelated = vi.fn(async () => 'ok');

    const result = await runAdkTaskGraph({
      telemetry: hub,
      nodes: [
        node(
          'flaky',
          [],
          async () => {
            throw new Error('nope');
          },
          { critical: false },
        ),
        node('dependent', ['flaky'], async () => 'never'),
        node('unrelated', [], unrelated),
      ],
    });

    const byId = new Map(result.statuses.map((status) => [status.nodeId, status]));
    expect(byId.get('flaky')?.state).toBe('failed');
    expect(byId.get('dependent')?.state).toBe('skipped');
    expect(byId.get('unrelated')?.state).toBe('succeeded');
    expect(unrelated).toHaveBeenCalled();
    expect(result.aborted).toBe(false);
    expect(result.failures).toHaveLength(1);
  });

  it('aborts the run when a critical node fails', async () => {
    const hub = createDeterministicTelemetry();
    const later = vi.fn(async () => 'ok');

    const result = await runAdkTaskGraph({
      telemetry: hub,
      nodes: [
        node('critical', [], async () => {
          throw new Error('fatal');
        }),
        node('later', ['critical'], later),
      ],
    });

    expect(result.aborted).toBe(true);
    expect(later).not.toHaveBeenCalled();
  });

  it('does not start work once the abort signal is already raised', async () => {
    const hub = createDeterministicTelemetry();
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn(async () => 'ok');

    const result = await runAdkTaskGraph({
      telemetry: hub,
      signal: controller.signal,
      nodes: [node('a', [], run)],
    });

    expect(run).not.toHaveBeenCalled();
    expect(result.aborted).toBe(true);
    expect(result.statuses[0]?.state).toBe('skipped');
  });

  it('reports node state transitions for live progress', async () => {
    const hub = createDeterministicTelemetry();
    const seen: string[] = [];

    await runAdkTaskGraph({
      telemetry: hub,
      nodes: [{ id: 'solo', dependsOn: [], run: async () => undefined }],
      onNodeState: (status) => seen.push(`${status.nodeId}:${status.state}`),
    });

    expect(seen).toEqual(['solo:running', 'solo:succeeded']);
  });

  it('aborts stalled nodes exceeding node-level timeoutMs without failing the graph', async () => {
    const hub = createDeterministicTelemetry();
    const result = await runAdkTaskGraph({
      telemetry: hub,
      nodes: [
        {
          id: 'slow-worker',
          dependsOn: [],
          critical: false,
          timeoutMs: 20,
          run: async ({ signal }) => {
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => resolve('done'), 200);
              signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('timed out'));
              });
            });
          },
        },
        {
          id: 'fast-worker',
          dependsOn: [],
          critical: true,
          run: async () => 'completed',
        },
      ],
    });

    expect(result.aborted).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.nodeId).toBe('slow-worker');
    expect(result.session.get('fast-worker')).toBeUndefined();
    expect(result.statuses.find((s) => s.nodeId === 'fast-worker')?.state).toBe('succeeded');
  });
});

// ============================================================================
// 4. Graph contracts
// ============================================================================

describe('agent graph contracts', () => {
  it('detects a cycle and names the path', () => {
    const cycle = detectGraphCycle([
      { id: 'a', kind: 'llm', description: '', dependsOn: ['b'], outputKey: null, critical: true },
      { id: 'b', kind: 'llm', description: '', dependsOn: ['a'], outputKey: null, critical: true },
    ]);
    expect(cycle).not.toBeNull();
    expect(cycle?.length).toBeGreaterThan(1);
  });

  it('accepts an acyclic diamond', () => {
    expect(
      detectGraphCycle([
        { id: 'a', kind: 'llm', description: '', dependsOn: [], outputKey: null, critical: true },
        { id: 'b', kind: 'llm', description: '', dependsOn: ['a'], outputKey: null, critical: true },
        { id: 'c', kind: 'llm', description: '', dependsOn: ['a'], outputKey: null, critical: true },
        {
          id: 'd',
          kind: 'llm',
          description: '',
          dependsOn: ['b', 'c'],
          outputKey: null,
          critical: true,
        },
      ]),
    ).toBeNull();
  });

  it('rejects duplicate node ids at the schema boundary', () => {
    const parsed = adkAgentGraphSchema.safeParse({
      nodes: [
        { id: 'dupe', kind: 'llm' },
        { id: 'dupe', kind: 'llm' },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

// ============================================================================
// 5. Living deck deltas — anti-fabrication at the boundary
// ============================================================================

describe('living deck delta contracts', () => {
  const base = {
    id: 'dlt_1',
    deckId: 'deck_1',
    at: '2026-08-22T00:00:00.000Z',
    author: 'enrichment_pool',
    invocationId: 'inv-test',
  };

  it('refuses a "verified" metric with no citation', () => {
    const parsed = livingDeckDeltaSchema.safeParse({
      ...base,
      kind: 'metric_revised',
      cardId: 'card_1',
      metricType: 'arr',
      value: 1_000_000,
      confidence: 'verified',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a "verified" metric that carries a usable citation', () => {
    const parsed = livingDeckDeltaSchema.safeParse({
      ...base,
      kind: 'metric_revised',
      cardId: 'card_1',
      metricType: 'arr',
      value: 1_000_000,
      confidence: 'verified',
      citationUrl: 'https://sec.gov/filing/1',
    });
    expect(parsed.success).toBe(true);
  });

  it('requires an unknown figure to carry a null value', () => {
    const parsed = livingDeckDeltaSchema.safeParse({
      ...base,
      kind: 'metric_revised',
      cardId: 'card_1',
      metricType: 'valuation',
      value: 5,
      confidence: 'unknown',
    });
    expect(parsed.success).toBe(false);
  });

  it('drops an unsourced vice signal', () => {
    const parsed = livingDeckDeltaSchema.safeParse({
      ...base,
      kind: 'signal_attached',
      cardId: 'card_1',
      signalType: 'vice',
      claimTitle: 'Alleged wrongdoing',
    });
    expect(parsed.success).toBe(false);
  });

  it('folds deltas into state, bumping the revision and the counts', () => {
    let state = createLivingDeckState('deck_1');
    expect(state.revision).toBe(0);

    const added = livingDeckDeltaSchema.parse({
      ...base,
      kind: 'card_added',
      cardId: 'card_1',
      cardType: 'company',
      title: 'Acme',
    });
    const expanded = livingDeckDeltaSchema.parse({
      ...base,
      id: 'dlt_2',
      kind: 'topology_expanded',
      vector: 'core_operators',
      addedCandidates: 4,
    });

    state = applyLivingDeckDelta(state, added);
    state = applyLivingDeckDelta(state, expanded);

    expect(state.revision).toBe(2);
    expect(state.counts.hydrated).toBe(1);
    expect(state.counts.candidates).toBe(4);
    expect(state.deltas).toHaveLength(2);
    expect(state.lastDeltaAt).toBe(base.at);
  });

  it('replaces node status on upsert and recounts failures', () => {
    let state = createLivingDeckState('deck_1');
    const status = {
      nodeId: 'enrichment',
      state: 'running' as const,
      startedAt: null,
      endedAt: null,
      durationMs: null,
      attempts: 1,
      error: null,
    };
    state = upsertNodeStatus(state, status);
    state = upsertNodeStatus(state, { ...status, state: 'failed', error: 'boom' });

    expect(state.nodes).toHaveLength(1);
    expect(state.counts.failed).toBe(1);
  });
});

// ============================================================================
// 6. Discovery agent
// ============================================================================

describe('discovery agent', () => {
  it('merges the same entity found on two vectors into one candidate', () => {
    const topology = mergeTopology([
      vectorResult('core_operators', [{ name: 'NVIDIA', cardTypes: ['company'] }]),
      vectorResult('infrastructure_supply', [
        { name: 'NVIDIA', cardTypes: ['infrastructure'] },
        { name: 'CoreWeave' },
      ]),
    ]);

    expect(topology.candidates).toHaveLength(2);
    expect(topology.duplicatesMerged).toBe(1);

    const nvidia = topology.candidates.find((candidate) => candidate.name === 'NVIDIA');
    expect(nvidia?.vectors).toEqual(['core_operators', 'infrastructure_supply']);
    expect(nvidia?.cardTypes).toEqual(['company', 'infrastructure']);
    expect(topology.byVector.infrastructure_supply).toHaveLength(2);
  });

  it('collapses corporate-suffix variants of the same company', () => {
    const topology = mergeTopology([
      vectorResult('core_operators', [{ name: 'Acme Inc.' }]),
      vectorResult('distribution_channel', [{ name: 'Acme' }]),
    ]);
    expect(topology.candidates).toHaveLength(1);
  });

  it('reports empty vectors honestly rather than padding them', () => {
    const topology = mergeTopology([
      vectorResult('core_operators', [{ name: 'Solo' }]),
      vectorResult('distribution_channel', []),
    ]);
    expect(topology.emptyVectors).toEqual(['distribution_channel']);
    expect(topology.candidates).toHaveLength(1);
  });

  it('runs a single vector through the grounded → structured pair', async () => {
    const hub = createDeterministicTelemetry();
    const client = fakeDiscoveryClient({ infrastructure: [{ name: 'CoreWeave', domain: 'coreweave.com' }] });

    const result = await runDiscoveryVector('infrastructure_supply', {
      client,
      plan: PLAN,
      telemetry: hub,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.primaryRole).toBe('infrastructure');
    expect(client.ground).toHaveBeenCalledTimes(1);
    expect(client.structure).toHaveBeenCalledTimes(1);
    expect(hub.snapshot().some((event) => event.phase === 'tool_call')).toBe(true);
  });

  it('fans out across all three vectors', async () => {
    const hub = createDeterministicTelemetry();
    const client = fakeDiscoveryClient({
      company: [{ name: 'Anthropic', domain: 'anthropic.com' }],
      infrastructure: [{ name: 'CoreWeave', domain: 'coreweave.com' }],
      distribution: [{ name: 'AWS Marketplace', domain: 'aws.amazon.com' }],
    });

    const topology = await mapMarketTopology({ client, plan: PLAN, telemetry: hub });

    expect(topology.candidates).toHaveLength(3);
    expect(client.ground).toHaveBeenCalledTimes(3);
  });

  it('degrades to the surviving vectors when one fails', async () => {
    const hub = createDeterministicTelemetry();
    const client = fakeDiscoveryClient(
      {
        company: [{ name: 'Anthropic', domain: 'anthropic.com' }],
        distribution: [{ name: 'AWS Marketplace', domain: 'aws.amazon.com' }],
      },
      { failFocus: ['infrastructure'] },
    );

    const topology = await mapMarketTopology({ client, plan: PLAN, telemetry: hub });

    expect(topology.candidates).toHaveLength(2);
    expect(hub.snapshot().some((event) => event.severity === 'warn')).toBe(true);
  });

  it('throws only when every vector fails', async () => {
    const hub = createDeterministicTelemetry();
    const client = fakeDiscoveryClient(
      {},
      { failFocus: ['company', 'infrastructure', 'distribution'] },
    );

    await expect(mapMarketTopology({ client, plan: PLAN, telemetry: hub })).rejects.toThrow(
      /All discovery vectors failed/,
    );
  });

  it('weights the operator vector highest by default', () => {
    expect(DEFAULT_VECTOR_TARGETS.core_operators).toBeGreaterThan(
      DEFAULT_VECTOR_TARGETS.infrastructure_supply,
    );
  });
});

// ============================================================================
// 7. Enrichment pool
// ============================================================================

describe('enrichment pool', () => {
  const client = fakeDiscoveryClient({});

  it('hydrates every candidate and streams each card as it lands', async () => {
    const hub = createDeterministicTelemetry();
    hoisted.hydrateCompanyCard.mockImplementation(
      async ({ candidate }: { candidate: CompanyCandidate }) =>
        makeHydrationResult(candidate.name),
    );

    const streamed: string[] = [];
    const result = await runEnrichmentPool({
      client,
      plan: PLAN,
      telemetry: hub,
      concurrency: 2,
      candidates: ['Alpha', 'Beta', 'Gamma', 'Delta'].map(makeCandidate),
      onCard: (card) => streamed.push(card.company.name),
    });

    expect(result.hydrated).toHaveLength(4);
    expect(result.failures).toHaveLength(0);
    expect(streamed).toHaveLength(4);
    expect(result.escalated).toBe(false);
  });

  it('isolates a single failing company without sinking the deck', async () => {
    const hub = createDeterministicTelemetry();
    hoisted.hydrateCompanyCard.mockImplementation(
      async ({ candidate }: { candidate: CompanyCandidate }) => {
        if (candidate.name === 'Beta') throw new Error('no grounded sources');
        return makeHydrationResult(candidate.name);
      },
    );

    const result = await runEnrichmentPool({
      client,
      plan: PLAN,
      telemetry: hub,
      concurrency: 1,
      candidates: ['Alpha', 'Beta', 'Gamma'].map(makeCandidate),
    });

    expect(result.hydrated).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.candidate.name).toBe('Beta');
    expect(result.escalated).toBe(false);
  });

  it('escalates and stops scheduling once the failure rate is systemic', async () => {
    const hub = createDeterministicTelemetry();
    hoisted.hydrateCompanyCard.mockImplementation(async () => {
      throw Object.assign(new Error('quota exhausted'), { status: 429 });
    });

    const result = await runEnrichmentPool({
      client,
      plan: PLAN,
      telemetry: hub,
      concurrency: 1,
      candidates: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(makeCandidate),
      // This test is about the escalation threshold, not about back-pressure
      // timing. Adaptive back-pressure now inserts a real cooldown after each
      // retryable (429) failure, so without shrinking the step the eight
      // deliberate failures would spend ~9s sleeping and time the test out.
      backpressureStepMs: 1,
    });

    expect(result.escalated).toBe(true);
    // Stopped at the threshold rather than burning the whole catalog.
    expect(result.failures.length).toBeLessThan(8);
    expect(result.failures.every((failure) => failure.retryable)).toBe(true);
    expect(hub.snapshot().some((event) => event.escalate)).toBe(true);
  });

  it('emits provenance-safe deltas, downgrading unsourced "verified" figures', () => {
    const result = makeHydrationResult('Acme', [
      makeMetric({ metricType: 'arr', value: 5_000_000, confidence: 'verified', citations: [] }),
      makeMetric({
        id: 'met_2',
        metricType: 'valuation',
        value: 42,
        confidence: 'unknown',
      }),
      makeMetric({
        id: 'met_3',
        metricType: 'employees',
        value: 120,
        confidence: 'verified',
        citations: [{ title: 'sec.gov', url: 'https://sec.gov/filing/2' }],
      }),
    ]);

    const deltas = buildHydrationDeltas(result, {
      deckId: 'deck_1',
      author: 'enrichment_pool',
      invocationId: 'inv-test',
      at: '2026-08-22T00:00:00.000Z',
      seq: 1,
    });

    // Every emitted delta must survive the contract that guards the deck.
    for (const delta of deltas) {
      expect(livingDeckDeltaSchema.safeParse(delta).success).toBe(true);
    }

    const byMetric = new Map(
      deltas
        .filter((delta): delta is Extract<LivingDeckDelta, { kind: 'metric_revised' }> =>
          delta.kind === 'metric_revised',
        )
        .map((delta) => [delta.metricType, delta]),
    );

    expect(byMetric.get('arr')?.confidence).toBe('estimated');
    expect(byMetric.get('valuation')?.value).toBeNull();
    expect(byMetric.get('employees')?.confidence).toBe('verified');
    expect(deltas[0]?.kind).toBe('card_added');
  });
});

// ============================================================================
// 8. Signal watcher
// ============================================================================

describe('signal watcher', () => {
  const client = fakeDiscoveryClient({});

  const searchResult = (cards: CardWithCompany[]): DeltaSearchResult => ({
    cards,
    candidates: [],
    rejected: [],
    citations: [],
    stats: {
      target: 3,
      discoveredCount: cards.length,
      deduplicatedCount: 0,
      excludedCount: 0,
      addedCount: cards.length,
      focusPrompt: 'focus',
    },
  });

  it('stops early and escalates when a pass finds nothing new', async () => {
    const hub = createDeterministicTelemetry();
    hoisted.searchDelta
      .mockResolvedValueOnce(searchResult([makeCardWithCompany('Newco')]))
      .mockResolvedValueOnce(searchResult([]));

    const result = await runSignalWatcher({
      client,
      plan: PLAN,
      telemetry: hub,
      deckId: 'deck_1',
      maxIterations: 5,
    });

    expect(result.iterations).toHaveLength(2);
    expect(result.stoppedReason).toBe('no_growth');
    expect(result.escalated).toBe(true);
    expect(hoisted.searchDelta).toHaveBeenCalledTimes(2);
    expect(result.cards).toHaveLength(1);
  });

  it('respects the hard iteration cap even while it keeps finding companies', async () => {
    const hub = createDeterministicTelemetry();
    let counter = 0;
    hoisted.searchDelta.mockImplementation(async () => {
      counter += 1;
      return searchResult([makeCardWithCompany(`Growth${counter}`)]);
    });

    const result = await runSignalWatcher({
      client,
      plan: PLAN,
      telemetry: hub,
      deckId: 'deck_1',
      maxIterations: 2,
    });

    expect(result.iterations).toHaveLength(2);
    expect(result.stoppedReason).toBe('max_iterations');
    expect(result.cards).toHaveLength(2);
  });

  it('accumulates exclusions so a company is never re-researched', async () => {
    const hub = createDeterministicTelemetry();
    hoisted.searchDelta.mockImplementation(async () =>
      searchResult([makeCardWithCompany('Repeat')]),
    );

    await runSignalWatcher({
      client,
      plan: PLAN,
      telemetry: hub,
      deckId: 'deck_1',
      maxIterations: 2,
      existing: [{ name: 'Seeded', domain: 'seeded.com' }],
    });

    const firstCall = hoisted.searchDelta.mock.calls[0]?.[0] as { exclude: unknown[] };
    const secondCall = hoisted.searchDelta.mock.calls[1]?.[0] as { exclude: unknown[] };
    expect(firstCall.exclude).toHaveLength(1);
    expect(secondCall.exclude.length).toBeGreaterThan(firstCall.exclude.length);
  });

  it('emits schema-valid card deltas for everything it grows', async () => {
    const hub = createDeterministicTelemetry();
    hoisted.searchDelta
      .mockResolvedValueOnce(searchResult([makeCardWithCompany('Grown')]))
      .mockResolvedValueOnce(searchResult([]));

    const deltas: LivingDeckDelta[] = [];
    const result = await runSignalWatcher({
      client,
      plan: PLAN,
      telemetry: hub,
      deckId: 'deck_1',
      maxIterations: 3,
      onDelta: (delta) => deltas.push(delta),
    });

    expect(deltas).toHaveLength(1);
    expect(livingDeckDeltaSchema.safeParse(deltas[0]).success).toBe(true);
    expect(result.deltas).toEqual(deltas);
  });

  it('records the failure and stops when a pass throws', async () => {
    const hub = createDeterministicTelemetry();
    hoisted.searchDelta.mockRejectedValue(new Error('grounding unavailable'));

    const result = await runSignalWatcher({
      client,
      plan: PLAN,
      telemetry: hub,
      deckId: 'deck_1',
      maxIterations: 3,
    });

    expect(result.stoppedReason).toBe('failed');
    expect(result.iterations[0]?.error).toBe('grounding unavailable');
  });
});

// ============================================================================
// 9. Engine
// ============================================================================

describe('LivingDeckEngine', () => {
  function engineClient(): LlmClient {
    return fakeDiscoveryClient({
      company: [{ name: 'Anthropic', domain: 'anthropic.com' }],
      infrastructure: [{ name: 'CoreWeave', domain: 'coreweave.com' }],
      distribution: [{ name: 'AWS Marketplace', domain: 'aws.amazon.com' }],
    });
  }

  it('declares a valid agent graph', () => {
    const graph = describeAgentGraph();
    expect(graph.nodes.map((node) => node.id)).toEqual(['discovery', 'enrichment', 'watcher']);
    expect(graph.nodes[2]?.critical).toBe(false);
    expect(detectGraphCycle(graph.nodes)).toBeNull();
  });

  it('omits the watcher when growth is disabled', () => {
    const graph = describeAgentGraph({ watch: false });
    expect(graph.nodes).toHaveLength(2);
  });

  it('boots with a topology, streams hydrated cards, and settles', async () => {
    hoisted.hydrateCompanyCard.mockImplementation(
      async ({ candidate }: { candidate: CompanyCandidate }) =>
        makeHydrationResult(candidate.name),
    );

    const events: string[] = [];
    const engine = new LivingDeckEngine({
      client: engineClient(),
      plan: PLAN,
      deckId: 'deck_1',
      telemetry: createDeterministicTelemetry(),
      watch: false,
      enrichmentConcurrency: 2,
      onEvent: (event) => events.push(event.type),
    });

    const run = await engine.run();

    expect(run.topology?.candidates).toHaveLength(3);
    expect(run.hydrated).toHaveLength(3);
    expect(run.bootMs).not.toBeNull();
    expect(run.state.status).toBe('settled');
    expect(run.state.counts.hydrated).toBe(3);
    expect(run.state.revision).toBeGreaterThan(0);
    expect(events).toContain('boot');
    expect(events).toContain('card');
    expect(events).toContain('done');
    expect(events.at(-1)).toBe('done');
  });

  it('measures boot separately from total runtime', async () => {
    hoisted.hydrateCompanyCard.mockImplementation(
      async ({ candidate }: { candidate: CompanyCandidate }) =>
        makeHydrationResult(candidate.name),
    );

    const run = await new LivingDeckEngine({
      client: engineClient(),
      plan: PLAN,
      deckId: 'deck_1',
      telemetry: createDeterministicTelemetry(),
      watch: false,
    }).run();

    expect(run.bootMs).not.toBeNull();
    expect(run.totalMs).toBeGreaterThanOrEqual(run.bootMs ?? 0);
  });

  it('produces a complete, correlated trace for the whole run', async () => {
    hoisted.hydrateCompanyCard.mockImplementation(
      async ({ candidate }: { candidate: CompanyCandidate }) =>
        makeHydrationResult(candidate.name),
    );

    const run = await new LivingDeckEngine({
      client: engineClient(),
      plan: PLAN,
      deckId: 'deck_1',
      telemetry: createDeterministicTelemetry(),
      watch: false,
    }).run();

    expect(run.summary.invocationIds).toEqual(['inv-test']);
    expect(run.summary.eventsByPhase.invocation_start).toBe(1);
    expect(run.summary.eventsByPhase.invocation_end).toBe(1);
    expect(run.summary.errorCount).toBe(0);

    const authors = new Set(run.trace.map((event) => event.author));
    expect(authors).toContain('discovery_agent');
    expect(authors).toContain('enrichment_pool');
    expect(run.trace.every((event) => event.invocationId === 'inv-test')).toBe(true);
  });

  it('keeps the deck usable when the watcher fails, because growth is not critical', async () => {
    hoisted.hydrateCompanyCard.mockImplementation(
      async ({ candidate }: { candidate: CompanyCandidate }) =>
        makeHydrationResult(candidate.name),
    );
    hoisted.searchDelta.mockRejectedValue(new Error('watcher down'));

    const run = await new LivingDeckEngine({
      client: engineClient(),
      plan: PLAN,
      deckId: 'deck_1',
      telemetry: createDeterministicTelemetry(),
      watch: true,
      watchIterations: 1,
    }).run();

    expect(run.hydrated).toHaveLength(3);
    expect(run.state.status).toBe('settled');
    expect(run.aborted).toBe(false);
    expect(run.watch?.stoppedReason).toBe('failed');
  });

  it('fails the deck when discovery — the one critical node — cannot run', async () => {
    const client = fakeDiscoveryClient(
      {},
      { failFocus: ['company', 'infrastructure', 'distribution'] },
    );

    const run = await new LivingDeckEngine({
      client,
      plan: PLAN,
      deckId: 'deck_1',
      telemetry: createDeterministicTelemetry(),
      watch: false,
    }).run();

    expect(run.state.status).toBe('failed');
    expect(run.aborted).toBe(true);
    expect(run.hydrated).toHaveLength(0);
    expect(run.topology).toBeNull();
  });

  it('exposes the telemetry hub for external observers', async () => {
    hoisted.hydrateCompanyCard.mockImplementation(
      async ({ candidate }: { candidate: CompanyCandidate }) =>
        makeHydrationResult(candidate.name),
    );

    const seen: string[] = [];
    const engine = new LivingDeckEngine({
      client: engineClient(),
      plan: PLAN,
      deckId: 'deck_1',
      telemetry: new AdkTelemetryHub({ invocationId: 'inv-observed' }),
      watch: false,
    });
    engine.subscribe((event) => seen.push(event.phase));

    await engine.run();

    expect(seen[0]).toBe('invocation_start');
    expect(seen.at(-1)).toBe('invocation_end');
  });
});
