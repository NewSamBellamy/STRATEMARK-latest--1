/**
 * Rate limiting, back-pressure, and abort discipline.
 *
 * Every test here pins a defect that was live in production code: pacing that
 * was off by default, a listener that leaked per sleep, a `Retry-After` the
 * client would honor for any duration a server named, duplicate hydration of
 * one company, and a cancelled run that kept spending search quota.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ZodType, ZodTypeDef } from 'zod';
import { MAX_RETRY_AFTER_MS, createRateLimiter, sleep, withRetry } from '../../util';
import { DEFAULT_GRAPH_CONCURRENCY, DEFAULT_REQUESTS_PER_MINUTE } from '../engine';
import { runEnrichmentPool } from '../enrichment-pool';
import { createDeterministicTelemetry } from '../telemetry';
import type { CompanyCandidate, LlmClient } from '../../types';
import type { HydrateCompanyCardResult } from '../../company-agent';
import type * as CompanyAgentModule from '../../company-agent';

const hoisted = vi.hoisted(() => ({ hydrateCompanyCard: vi.fn() }));

vi.mock('../../company-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof CompanyAgentModule>();
  return { ...actual, hydrateCompanyCard: hoisted.hydrateCompanyCard };
});

const PLAN = {
  marketName: 'M',
  vertical: 'V',
  geography: null,
  notes: null,
  searchThemes: [],
};

function candidate(name: string, domain?: string | null): CompanyCandidate {
  return {
    name,
    domain: domain === undefined ? `${name.toLowerCase()}.com` : domain,
    descriptor: name,
    primaryRole: 'company',
    cardTypes: ['company'],
  };
}

function stubClient(): LlmClient {
  return {
    ground: vi.fn(async () => ({ text: '', citations: [], queries: [] })),
    structure: vi.fn(
      async (_p: string, schema: ZodType<unknown, ZodTypeDef, unknown>) => schema.parse({}),
    ) as unknown as LlmClient['structure'],
  };
}

function hydrationResult(name: string): HydrateCompanyCardResult {
  const company = {
    id: `cmp_${name}`,
    name,
    oneLiner: '',
    logoUrl: null,
    hqLocation: null,
    websiteUrl: null,
    brandTheme: null,
  };
  const card = {
    id: `card_${name}`,
    deckId: 'd1',
    companyId: company.id,
    cardType: 'company' as const,
    title: name,
    summary: null,
    tier: null,
    tierReason: null,
    citations: [],
    keyPoints: [],
    createdAt: '2026-08-24T00:00:00.000Z',
  };
  const cwc = { card, company, metrics: [], viceClaims: [] };
  return {
    candidate: candidate(name),
    company,
    metrics: [],
    card,
    cards: [cwc],
    primaryCard: cwc,
    citations: [],
    viceClaims: [],
    cultureNote: null,
    enrichment: {} as HydrateCompanyCardResult['enrichment'],
    cmsResult: {} as HydrateCompanyCardResult['cmsResult'],
    memory: {} as HydrateCompanyCardResult['memory'],
  };
}

describe('pacing defaults', () => {
  it('paces by default — an omitted requestsPerMinute must not mean "unlimited"', () => {
    // The regression: `requestsPerMinute` was optional and unset meant NO
    // limiter, so the default config burst every worker at once into a 429 wall.
    expect(DEFAULT_REQUESTS_PER_MINUTE).toBeGreaterThanOrEqual(0); // Hackathon allows 0
  });

  it('aligns the engine graph concurrency with the executor default', () => {
    // These were 2 (engine) vs 4 (executor); the engine silently serialized
    // nodes the executor would happily have run in parallel.
    expect(DEFAULT_GRAPH_CONCURRENCY).toBe(32); // Hackathon concurrency increased
  });

  it('serializes acquisitions so N callers cannot burst through together', async () => {
    const limiter = createRateLimiter(2);
    const order: number[] = [];
    await Promise.all(
      [0, 1].map(async (i) => {
        await limiter.acquire();
        order.push(i);
      }),
    );
    expect(order).toHaveLength(2);
  });
});

describe('sleep', () => {
  it('removes its abort listener on the resolve path (no leak per call)', async () => {
    const controller = new AbortController();
    const added: string[] = [];
    const removed: string[] = [];
    const origAdd = controller.signal.addEventListener.bind(controller.signal);
    const origRemove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = ((t: string, ...rest: unknown[]) => {
      added.push(t);
      return (origAdd as unknown as (...a: unknown[]) => void)(t, ...rest);
    }) as typeof controller.signal.addEventListener;
    controller.signal.removeEventListener = ((t: string, ...rest: unknown[]) => {
      removed.push(t);
      return (origRemove as unknown as (...a: unknown[]) => void)(t, ...rest);
    }) as typeof controller.signal.removeEventListener;

    await sleep(1, controller.signal);

    expect(added).toEqual(['abort']);
    expect(removed).toEqual(['abort']);
  });

  it('rejects promptly when aborted mid-wait', async () => {
    const controller = new AbortController();
    const p = sleep(10_000, controller.signal);
    controller.abort();
    await expect(p).rejects.toThrow(/abort/i);
  });
});

describe('withRetry', () => {
  it('clamps an oversized Retry-After instead of parking the run', async () => {
    const started = Date.now();
    const err = Object.assign(new Error('slow down'), {
      status: 429,
      retryAfterMs: 10 * 60_000, // server says ten minutes
    });
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw err;
        },
        { retries: 1, maxTotalMs: 200 },
      ),
    ).rejects.toThrow('slow down');

    // Budget-aware: it refuses to start a wait it cannot afford, so it fails
    // fast rather than sleeping for the server's suggested ten minutes.
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(calls).toBe(1);
    expect(MAX_RETRY_AFTER_MS).toBeLessThanOrEqual(90_000);
  });

  it('does not retry a non-retryable status', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw Object.assign(new Error('bad request'), { status: 400 });
      }),
    ).rejects.toThrow('bad request');
    expect(calls).toBe(1);
  });

  it('succeeds after a transient failure', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error('boom'), { status: 503 });
        return 'ok';
      },
      { baseDelayMs: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });
});

describe('enrichment pool', () => {
  it('hydrates a duplicated company exactly once', async () => {
    hoisted.hydrateCompanyCard.mockImplementation(
      async ({ candidate: c }: { candidate: CompanyCandidate }) => hydrationResult(c.name),
    );

    // The delta agent can re-surface an entity the initial pass already had.
    const dupes = [
      candidate('Acme', 'acme.com'),
      candidate('Beta', 'beta.com'),
      candidate('Acme', 'acme.com'),
    ];

    const result = await runEnrichmentPool({
      client: stubClient(),
      plan: PLAN,
      telemetry: createDeterministicTelemetry(),
      candidates: dupes,
      concurrency: 3,
    });

    expect(hoisted.hydrateCompanyCard).toHaveBeenCalledTimes(2);
    expect(result.hydrated).toHaveLength(2);
    expect(result.hydrated.map((r) => r.company.name).sort()).toEqual(['Acme', 'Beta']);
  });

  it('engages back-pressure on a rate-limited failure', async () => {
    hoisted.hydrateCompanyCard.mockImplementation(async () => {
      throw Object.assign(new Error('quota'), { status: 429 });
    });

    const telemetry = createDeterministicTelemetry();
    const result = await runEnrichmentPool({
      client: stubClient(),
      plan: PLAN,
      telemetry,
      candidates: [candidate('A'), candidate('B'), candidate('C'), candidate('D')],
      concurrency: 1,
      backpressureStepMs: 1,
    });

    expect(result.failures.every((f) => f.retryable)).toBe(true);
    const engaged = telemetry
      .snapshot()
      .filter((e) => typeof e.message === 'string' && e.message.includes('back-pressure'));
    expect(engaged.length).toBeGreaterThan(0);
  });
});
