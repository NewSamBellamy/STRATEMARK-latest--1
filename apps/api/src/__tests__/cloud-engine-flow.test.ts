import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { readEnv } from '../env';
import { CloudDeckService, MockFirebaseAdapter } from '../lib/CloudDeckService';
import { MemoryDataStore } from '../lib/firestoreStore';
import { MockTasksAdapter } from '../lib/CloudTasksAdapter';
import { runLivingDeckEngine, type LivingDeckRun } from '@mi/research';
import type { CardWithCompany } from '@mi/contracts';

vi.mock('@mi/research', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@mi/research')>();
  return {
    ...actual,
    runLivingDeckEngine: vi.fn(),
  };
});

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('Cloud Engine creation-to-worker flow', () => {
  it('persists hydrated cards when the browser creates a Cloud Deck', async () => {
    const store = new MemoryDataStore();
    const auth = new MockFirebaseAdapter();
    const tasks = new MockTasksAdapter();
    const service = new CloudDeckService(store, auth, auth, tasks);
    const app = createApp(readEnv({ GEMINI_API_KEY: 'server-key', APP_TOKEN: 'app-token' }), {
      store,
      cloudDeckService: service,
      tasksAdapter: tasks,
      forceMemoryStore: true,
    });
    const plan = {
      marketName: 'Frontier AI',
      vertical: 'artificial intelligence',
      geography: null,
      notes: null,
      searchThemes: ['companies'],
    };

    const hydratedCard = {
      card: { id: 'card_example', deckId: 'deck_flow', companyId: 'company_example' },
      company: { id: 'company_example', name: 'Example Co', oneLiner: 'Example research company' },
      metrics: [
        {
          id: 'metric_example_arr',
          companyId: 'company_example',
          metricType: 'arr',
          value: 123,
          confidence: 'verified',
          source: 'https://example.com/filing',
          citations: [{ title: 'Example Co filing', url: 'https://example.com/filing', credibility: 'primary' }],
          methodNote: 'Reported example revenue',
          capturedAt: '2026-08-31T00:00:00.000Z',
        },
      ],
      viceClaims: [],
    };

    vi.mocked(runLivingDeckEngine).mockResolvedValueOnce({
      aborted: false,
      state: { status: 'settled' },
      hydrated: [{ cards: [hydratedCard] }],
      topology: null,
      enrichmentFailures: [],
      watch: null,
      statuses: [],
      trace: [
        {
          id: 'trace_1',
          invocationId: 'invocation_1',
          spanId: 'span_1',
          parentSpanId: null,
          branch: 'root',
          author: 'living_deck_engine',
          agentKind: 'sequential',
          phase: 'invocation_start',
          severity: 'info',
          timestamp: 0,
          durationMs: null,
          message: 'run started',
          attributes: {},
          stateDelta: null,
          error: null,
          escalate: false,
        },
      ],
      summary: {},
      bootMs: 25,
      totalMs: 100,
    } as unknown as LivingDeckRun);

    const headers = {
      Authorization: 'Bearer valid_token',
      'X-Stratemark-Token': 'app-token',
    };
    const createResponse = await app.request('/api/research/deck', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ deckId: 'deck_flow', plan }),
    });

    expect(createResponse.status).toBe(202);
    expect(tasks.queuedTasks).toHaveLength(1);

    const workerResponse = await app.request('/tasks/worker/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tasks.queuedTasks[0]),
    });

    expect(workerResponse.status).toBe(200);
    const deckResponse = await app.request('/api/decks/deck_flow', { headers });
    const deck = await json<{
      state: { status: string };
      cards: Array<{ metrics: Array<{ metricType: string; value: number | null }> }>;
      researchTrace: { events: Array<{ id: string }> };
    }>(deckResponse);

    expect(deckResponse.status).toBe(200);
    expect(deck.state.status).toBe('ready');
    expect(deck.cards[0]?.metrics).toEqual([
      expect.objectContaining({ metricType: 'arr', value: 123 }),
    ]);
    expect(deck.researchTrace.events).toEqual([expect.objectContaining({ id: 'trace_1' })]);
  });

  it('returns the VerifyMetricResult shape consumed by the living deck', async () => {
    const store = new MemoryDataStore();
    const auth = new MockFirebaseAdapter();
    const service = new CloudDeckService(store, auth, auth);
    const app = createApp(readEnv({ GEMINI_API_KEY: 'server-key', APP_TOKEN: 'app-token' }), {
      store,
      cloudDeckService: service,
      forceMemoryStore: true,
    });
    await service.saveDeck('user_123', 'deck_verify', {
      deck: { id: 'deck_verify' },
      market: { id: 'deck_verify' },
      cards: [
        {
          card: { id: 'card_verify', deckId: 'deck_verify', companyId: 'company_1', cardType: 'company' },
          company: { id: 'company_1', name: 'Example Co', oneLiner: 'Example company' },
          metrics: [
            {
              id: 'metric_verify',
              companyId: 'company_1',
              metricType: 'arr',
              value: 100,
              confidence: 'estimated',
              source: null,
              citations: [],
              methodNote: null,
              capturedAt: '2026-08-31T00:00:00.000Z',
            },
          ],
          viceClaims: [],
        },
      ] as unknown as CardWithCompany[],
      state: { status: 'ready' },
    });

    const unauthorizedResponse = await app.request('/api/research/verify', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid_token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ deckId: 'deck_verify', companyId: 'company_1', metricType: 'arr' }),
    });
    expect(unauthorizedResponse.status).toBe(401);

    const response = await app.request('/api/research/verify', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid_token',
        'X-Stratemark-Token': 'app-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deckId: 'deck_verify',
        companyId: 'company_1',
        metricType: 'arr',
        correction: {
          value: 200,
          // Recognized-source shortcut fixture; no live source request is made.
          citations: [{ title: 'Example Co filing', url: 'https://sec.gov/Archives/filing', credibility: 'primary' }],
          rationale: 'Latest filing reports updated revenue.',
        },
      }),
    });
    const result = await json<{
      metric: { value: number | null };
      changed: boolean;
      retieredCardIds: string[];
    }>(response);

    expect(response.status).toBe(200);
    expect(result.metric.value).toBe(200);
    expect(result.changed).toBe(true);
    expect(result.retieredCardIds).toEqual(expect.any(Array));
  });
});
