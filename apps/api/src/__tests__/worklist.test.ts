import { describe, it, expect, vi } from 'vitest';
import {
  executeScheduledRefresh,
  type WorklistStore,
  type RefreshWorklistDeck,
} from '../lib/worklist';
import type { ServiceEnv } from '../env';
import type { CloudDeckService } from '../lib/CloudDeckService';
import type { TasksAdapter } from '../lib/CloudTasksAdapter';

const mockEnv: ServiceEnv = {
  port: 8080,
  geminiApiKey: 'k',
  vertex: undefined,
  allowedOrigins: [],
  schedulerToken: 'secret',
  schedulerServiceAccountEmail: 'scheduler@example.com',
  appToken: undefined,
  dailyCapUsd: 10,
  captureBlocklist: [],
};

describe('executeScheduledRefresh', () => {
  it('returns unconfigured note when no store is available', async () => {
    const res = await executeScheduledRefresh({
      env: mockEnv,
    });
    expect(res.ok).toBe(true);
    expect(res.refreshed).toBe(0);
    expect(res.note).toMatch(/No persistence layer bound/);
  });

  it('enqueues refresh tasks for eligible decks', async () => {
    const decks: RefreshWorklistDeck[] = [
      { deckId: 'd1', userId: 'user1', query: 'Frontier AI', cards: [] },
    ];
    
    const mockStore: WorklistStore = {
      async getDecks() {
        return decks;
      },
      saveRefreshedDeck: vi.fn(),
    };

    const mockCloudDeckService = {
      checkEntitlement: vi.fn(async () => true),
      getDeck: vi.fn(async () => ({ cards: [] })),
      saveDeck: vi.fn(async () => {}),
    } as unknown as CloudDeckService;

    const mockTasksAdapter = {
      enqueueDeckRefresh: vi.fn(async () => {}),
    } as unknown as TasksAdapter;

    const res = await executeScheduledRefresh({
      env: mockEnv,
      store: mockStore,
      cloudDeckService: mockCloudDeckService,
      tasksAdapter: mockTasksAdapter,
    });

    expect(res.ok).toBe(true);
    expect(res.refreshed).toBe(1);
    expect(res.totalDecks).toBe(1);
    expect(mockTasksAdapter.enqueueDeckRefresh).toHaveBeenCalledWith({
      deckId: 'd1',
      userId: 'user1',
      query: 'Frontier AI'
    });
    expect(mockCloudDeckService.saveDeck).toHaveBeenCalledWith('user1', 'd1', expect.objectContaining({
      state: { status: 'refreshing' }
    }), undefined);
  });

  it('skips decks if the user has lost entitlement', async () => {
    const decks: RefreshWorklistDeck[] = [
      { deckId: 'd1', userId: 'user1', query: 'Frontier AI', cards: [] },
    ];
    
    const mockStore: WorklistStore = {
      async getDecks() { return decks; },
      saveRefreshedDeck: vi.fn(),
    };

    const mockCloudDeckService = {
      checkEntitlement: vi.fn(async () => false),
      getDeck: vi.fn(async () => ({ cards: [] })),
      saveDeck: vi.fn(async () => {}),
    } as unknown as CloudDeckService;

    const mockTasksAdapter = {
      enqueueDeckRefresh: vi.fn(async () => {}),
    } as unknown as TasksAdapter;

    const res = await executeScheduledRefresh({
      env: mockEnv,
      store: mockStore,
      cloudDeckService: mockCloudDeckService,
      tasksAdapter: mockTasksAdapter,
    });

    expect(res.ok).toBe(true);
    expect(res.refreshed).toBe(0);
    expect(mockTasksAdapter.enqueueDeckRefresh).not.toHaveBeenCalled();
    expect(mockCloudDeckService.saveDeck).not.toHaveBeenCalled();
  });

  it('isolates failures so one bad deck does not block others', async () => {
    const decks: RefreshWorklistDeck[] = [
      { deckId: 'd1', userId: 'user1', query: 'Frontier AI', cards: [] },
      { deckId: 'd2', userId: 'user2', query: 'Quantum Computing', cards: [] },
    ];
    
    const mockStore: WorklistStore = {
      async getDecks() { return decks; },
      saveRefreshedDeck: vi.fn(),
    };

    let callCount = 0;
    const mockCloudDeckService = {
      checkEntitlement: vi.fn(async () => true),
      getDeck: vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error('DB Error');
        return { cards: [] };
      }),
      saveDeck: vi.fn(async () => {}),
    } as unknown as CloudDeckService;

    const mockTasksAdapter = {
      enqueueDeckRefresh: vi.fn(async () => {}),
    } as unknown as TasksAdapter;

    const res = await executeScheduledRefresh({
      env: mockEnv,
      store: mockStore,
      cloudDeckService: mockCloudDeckService,
      tasksAdapter: mockTasksAdapter,
    });

    expect(res.ok).toBe(true);
    expect(res.refreshed).toBe(1);
    expect(mockTasksAdapter.enqueueDeckRefresh).toHaveBeenCalledWith(expect.objectContaining({ deckId: 'd2' }));
  });

  it('filters out unwatched or non-ready decks in MemoryDataStore', async () => {
    const { MemoryDataStore } = await import('../lib/firestoreStore');
    const store = new MemoryDataStore();

    // 1. Watched and ready -> ELIGIBLE
    await store.saveDeck('d_eligible', {
      deck: { id: 'd_eligible', title: 'Eligible Deck' },
      market: { id: 'd_eligible' },
      cards: [],
      query: 'Eligible Deck',
      watch: true,
      state: { status: 'ready' },
      userId: 'u1',
    });

    // 2. Not watched, but ready -> INELIGIBLE
    await store.saveDeck('d_unwatched', {
      deck: { id: 'd_unwatched', title: 'Unwatched Deck' },
      market: { id: 'd_unwatched' },
      cards: [],
      query: 'Unwatched Deck',
      watch: false,
      state: { status: 'ready' },
      userId: 'u1',
    });

    // 3. Watched, but still running -> INELIGIBLE
    await store.saveDeck('d_running', {
      deck: { id: 'd_running', title: 'Running Deck' },
      market: { id: 'd_running' },
      cards: [],
      query: 'Running Deck',
      watch: true,
      state: { status: 'running' },
      userId: 'u1',
    });

    const worklist = await store.getDecks();
    expect(worklist.length).toBe(1);
    expect(worklist[0]?.deckId).toBe('d_eligible');
  });
});
