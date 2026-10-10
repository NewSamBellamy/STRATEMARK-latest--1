import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudDeckWorker } from '../lib/CloudDeckWorker';
import { CloudDeckService, MockFirebaseAdapter } from '../lib/CloudDeckService';
import { MemoryDataStore } from '../lib/firestoreStore';
import { MockTasksAdapter } from '../lib/CloudTasksAdapter';
import type { ServiceEnv } from '../env';
import { runLivingDeckEngine, type LivingDeckRun, type HydrateCompanyCardResult } from '@mi/research';

vi.mock('@mi/research', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@mi/research')>();
  return {
    ...actual,
    runLivingDeckEngine: vi.fn(),
  };
});

const mockEnv: ServiceEnv = {
  port: 8080,
  geminiApiKey: 'mock-key',
  vertex: undefined,
  allowedOrigins: [],
  schedulerToken: 'secret',
  schedulerServiceAccountEmail: 'scheduler@example.com',
  appToken: 'app-secret',
  dailyCapUsd: 10,
  captureBlocklist: []
};

describe('CloudDeckWorker', () => {
  let store: MemoryDataStore;
  let authAdapter: MockFirebaseAdapter;
  let tasksAdapter: MockTasksAdapter;
  let service: CloudDeckService;
  let worker: CloudDeckWorker;

  beforeEach(() => {
    store = new MemoryDataStore();
    authAdapter = new MockFirebaseAdapter();
    tasksAdapter = new MockTasksAdapter();
    service = new CloudDeckService(store, authAdapter, authAdapter, tasksAdapter);
    worker = new CloudDeckWorker(mockEnv, service);
    vi.clearAllMocks();
  });

  it('bails out if deck is not found', async () => {
    await worker.processDeckCreation({
      deckId: 'deck_missing',
      userId: 'user_pro',
      plan: { marketName: 'Test', vertical: 'Test', geography: null, notes: null, searchThemes: [] },
      query: 'Test'
    });
    expect(runLivingDeckEngine).not.toHaveBeenCalled();
  });

  it('fails safely if user entitlement is lost before starting', async () => {
    // create a deck for free user
    await service.saveDeck('user_free', 'deck_1', {
      deck: { id: 'deck_1' },
      market: { id: 'deck_1' },
      cards: [],
      plan: { marketName: 'Test', vertical: 'Test', geography: null, notes: null, searchThemes: [] },
      state: { status: 'running' }
    });

    await worker.processDeckCreation({
      deckId: 'deck_1',
      userId: 'user_free',
      plan: { marketName: 'Test', vertical: 'Test', geography: null, notes: null, searchThemes: [] },
      query: 'Test'
    });

    expect(runLivingDeckEngine).not.toHaveBeenCalled();
    const d = await service.getDeck('user_free', 'deck_1');
    expect(d?.state?.status).toBe('failed');
    expect(d?.state?.error).toBe('Entitlement lost');
  });

  it('runs engine and updates state to ready upon completion', async () => {
    await service.saveDeck('user_pro', 'deck_1', {
      deck: { id: 'deck_1' },
      market: { id: 'deck_1' },
      cards: [],
      plan: { marketName: 'Test', vertical: 'Test', geography: null, notes: null, searchThemes: [] },
      state: { status: 'running' }
    });

    const mockHydratedCards = [{
      cards: [{ card: { id: 'c1', title: 'Test Card' }, company: null, metrics: [], viceClaims: [] }]
    }];

    vi.mocked(runLivingDeckEngine).mockResolvedValueOnce({
      aborted: false,
      state: { status: 'settled' } as unknown as LivingDeckRun['state'],
      hydrated: mockHydratedCards as unknown as LivingDeckRun['hydrated'],
      topology: null,
      enrichmentFailures: [],
      watch: null,
      statuses: [],
      trace: [],
      summary: {} as unknown as LivingDeckRun['summary'],
      bootMs: 100,
      totalMs: 500
    });

    await worker.processDeckCreation({
      deckId: 'deck_1',
      userId: 'user_pro',
      plan: { marketName: 'Test', vertical: 'Test', geography: null, notes: null, searchThemes: [] },
      query: 'Test'
    });

    const d = await service.getDeck('user_pro', 'deck_1');
    expect(d?.state?.status).toBe('ready');
    expect(d?.cards.length).toBe(1);
    expect(d?.cards?.[0]?.card?.id).toBe('c1');
  });

  it('keeps incomplete hydration in partial state instead of claiming ready', async () => {
    await service.saveDeck('user_pro', 'deck_partial_result', {
      deck: { id: 'deck_partial_result' },
      market: { id: 'deck_partial_result' },
      cards: [],
      plan: { marketName: 'Test', vertical: 'Test', geography: null, notes: null, searchThemes: [] },
      state: { status: 'running' },
    });

    vi.mocked(runLivingDeckEngine).mockResolvedValueOnce({
      aborted: false,
      state: { status: 'settled' } as unknown as LivingDeckRun['state'],
      hydrated: [{ cards: [{ card: { id: 'c1' }, company: null, metrics: [], viceClaims: [] }] }],
      topology: null,
      enrichmentFailures: [{ companyName: 'Missing Co', error: 'source unavailable' }],
      watch: null,
      statuses: [],
      trace: [],
      summary: {} as unknown as LivingDeckRun['summary'],
      bootMs: 100,
      totalMs: 500,
    } as unknown as LivingDeckRun);

    await worker.processDeckCreation({
      deckId: 'deck_partial_result',
      userId: 'user_pro',
      plan: { marketName: 'Test', vertical: 'Test', geography: null, notes: null, searchThemes: [] },
      query: 'Test',
    });

    const d = await service.getDeck('user_pro', 'deck_partial_result');
    expect(d?.state?.status).toBe('partial');
    expect(d?.cards).toHaveLength(1);
  });

  it('saves partial checkpoints on card events', async () => {
    await service.saveDeck('user_pro', 'deck_2', {
      deck: { id: 'deck_2' },
      market: { id: 'deck_2' },
      cards: [],
      plan: { marketName: 'Test', vertical: 'Test', geography: null, notes: null, searchThemes: [] },
      state: { status: 'running' }
    });

    vi.mocked(runLivingDeckEngine).mockImplementationOnce(async (options) => {
      // simulate card event
      if (options.onEvent) {
        options.onEvent({
          type: 'card',
          result: {
            cards: [{ card: { id: 'c1' }, company: null, metrics: [], viceClaims: [] }]
          } as unknown as HydrateCompanyCardResult
        });
        options.onEvent({
          type: 'card',
          result: {
            cards: [{ card: { id: 'c2' }, company: null, metrics: [], viceClaims: [] }]
          } as unknown as HydrateCompanyCardResult
        });
      }
      return {
        aborted: false,
        state: { status: 'settled' } as unknown as LivingDeckRun['state'],
        hydrated: [
          { cards: [{ card: { id: 'c1' }, company: null, metrics: [], viceClaims: [] }] },
          { cards: [{ card: { id: 'c2' }, company: null, metrics: [], viceClaims: [] }] }
        ] as unknown as LivingDeckRun['hydrated'],
        topology: null,
        enrichmentFailures: [],
        watch: null,
        statuses: [],
        trace: [],
        summary: {} as unknown as LivingDeckRun['summary'],
        bootMs: 100,
        totalMs: 500
      };
    });

    await worker.processDeckCreation({
      deckId: 'deck_2',
      userId: 'user_pro',
      plan: { marketName: 'Test', vertical: 'Test', geography: null, notes: null, searchThemes: [] },
      query: 'Test'
    });

    const d = await service.getDeck('user_pro', 'deck_2');
    expect(d?.state?.status).toBe('ready');
    expect(d?.cards.length).toBe(2);
  });

  it('is idempotent and skips processing if deck is already ready', async () => {
    await service.saveDeck('user_pro', 'deck_ready', {
      deck: { id: 'deck_ready' },
      market: { id: 'deck_ready' },
      cards: [{ card: { id: 'c1', title: 'Card 1' } } as unknown as HydrateCompanyCardResult['cards'][0]],
      plan: { marketName: 'Test', vertical: 'Test', geography: null, notes: null, searchThemes: [] },
      state: { status: 'ready' },
    });

    await worker.processDeckCreation({
      deckId: 'deck_ready',
      userId: 'user_pro',
      plan: { marketName: 'Test', vertical: 'Test', geography: null, notes: null, searchThemes: [] },
      query: 'Test',
    });

    expect(runLivingDeckEngine).not.toHaveBeenCalled();
    const d = await service.getDeck('user_pro', 'deck_ready');
    expect(d?.state?.status).toBe('ready');
  });

  it('resumes interrupted deck creation without duplicating cards', async () => {
    // Deck already has card c1 from a previous partial run
    await service.saveDeck('user_pro', 'deck_interrupted', {
      deck: { id: 'deck_interrupted' },
      market: { id: 'deck_interrupted' },
      cards: [{ card: { id: 'c1', title: 'Card 1' } } as unknown as HydrateCompanyCardResult['cards'][0]],
      plan: { marketName: 'Test', vertical: 'Test', geography: null, notes: null, searchThemes: [] },
      state: { status: 'partial' },
    });

    vi.mocked(runLivingDeckEngine).mockResolvedValueOnce({
      aborted: false,
      state: { status: 'settled' } as unknown as LivingDeckRun['state'],
      hydrated: [
        { cards: [{ card: { id: 'c1', title: 'Card 1' } }] },
        { cards: [{ card: { id: 'c2', title: 'Card 2' } }] },
      ] as unknown as LivingDeckRun['hydrated'],
      topology: null,
      enrichmentFailures: [],
      watch: null,
      statuses: [],
      trace: [],
      summary: {} as unknown as LivingDeckRun['summary'],
      bootMs: 100,
      totalMs: 500,
    });

    await worker.processDeckCreation({
      deckId: 'deck_interrupted',
      userId: 'user_pro',
      plan: { marketName: 'Test', vertical: 'Test', geography: null, notes: null, searchThemes: [] },
      query: 'Test',
    });

    const d = await service.getDeck('user_pro', 'deck_interrupted');
    expect(d?.state?.status).toBe('ready');
    expect(d?.cards.length).toBe(2);
    expect(d?.cards.map(c => c.card.id)).toEqual(['c1', 'c2']);
  });

  it('aborts safely if deck is deleted mid-run', async () => {
    await service.saveDeck('user_pro', 'deck_to_delete', {
      deck: { id: 'deck_to_delete' },
      market: { id: 'deck_to_delete' },
      cards: [],
      state: { status: 'running' },
    });

    vi.mocked(runLivingDeckEngine).mockImplementationOnce(async (options) => {
      // Simulate deck deletion while running
      await service.deleteDeck('user_pro', 'deck_to_delete');
      if (options.onEvent) {
        options.onEvent({
          type: 'card',
          result: { cards: [{ card: { id: 'c_mid' } }] } as unknown as HydrateCompanyCardResult,
        });
      }
      return {
        aborted: false,
        state: { status: 'settled' } as unknown as LivingDeckRun['state'],
        hydrated: [{ cards: [{ card: { id: 'c_mid' } }] }] as unknown as LivingDeckRun['hydrated'],
        topology: null,
        enrichmentFailures: [],
        watch: null,
        statuses: [],
        trace: [],
        summary: {} as unknown as LivingDeckRun['summary'],
        bootMs: 100,
        totalMs: 500,
      };
    });

    await worker.processDeckCreation({
      deckId: 'deck_to_delete',
      userId: 'user_pro',
      plan: { marketName: 'Test', vertical: 'Test', geography: null, notes: null, searchThemes: [] },
      query: 'Test',
    });

    // Verify deck is not resurrected
    const d = await service.getDeck('user_pro', 'deck_to_delete');
    expect(d).toBeNull();
  });

  it('persists a failed state when the research engine throws', async () => {
    await service.saveDeck('user_pro', 'deck_failed', {
      deck: { id: 'deck_failed' },
      market: { id: 'deck_failed' },
      cards: [],
      state: { status: 'running' },
    });
    vi.mocked(runLivingDeckEngine).mockRejectedValueOnce(new Error('model unavailable'));

    await worker.processDeckCreation({
      deckId: 'deck_failed',
      userId: 'user_pro',
      plan: { marketName: 'Test', vertical: 'Test', geography: null, notes: null, searchThemes: [] },
      query: 'Test',
    });

    const d = await service.getDeck('user_pro', 'deck_failed');
    expect(d?.state).toEqual({ status: 'failed', error: 'model unavailable' });
  });

  it('labels an aborted engine run as timed out', async () => {
    await service.saveDeck('user_pro', 'deck_aborted', {
      deck: { id: 'deck_aborted' },
      market: { id: 'deck_aborted' },
      cards: [],
      state: { status: 'running' },
    });
    vi.mocked(runLivingDeckEngine).mockResolvedValueOnce({
      aborted: true,
      state: { status: 'failed' } as unknown as LivingDeckRun['state'],
      hydrated: [],
      topology: null,
      enrichmentFailures: [],
      watch: null,
      statuses: [{ state: 'failed', error: 'All discovery vectors failed' }] as unknown as LivingDeckRun['statuses'],
      trace: [],
      summary: {} as unknown as LivingDeckRun['summary'],
      bootMs: null,
      totalMs: 540_000,
    });

    await worker.processDeckCreation({
      deckId: 'deck_aborted',
      userId: 'user_pro',
      plan: { marketName: 'Test', vertical: 'Test', geography: null, notes: null, searchThemes: [] },
      query: 'Test',
    });

    const d = await service.getDeck('user_pro', 'deck_aborted');
    expect(d?.state).toEqual({ status: 'failed', error: 'Research timed out or was aborted' });
  });

  describe('Deck Refresh processing', () => {
    it('sets error and leaves deck ready if refresh fails', async () => {
      // Simulate entitlement lost during refresh
      await service.saveDeck('user_free', 'deck_3', { deck: { id: 'deck_3' }, market: {}, cards: [] });
      const worker = new CloudDeckWorker(mockEnv, service);
      await worker.processDeckRefresh({
        deckId: 'deck_3',
        userId: 'user_free',
        query: 'Testing Refresh'
      });
      const d = await service.getDeck('user_free', 'deck_3');
      expect(d?.state?.status).toBe('ready_stale');
      expect(d?.state?.error).toBe('Entitlement lost');
    });
  });
});
