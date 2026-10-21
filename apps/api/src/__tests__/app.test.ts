import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../app';
import { readEnv } from '../env';
import { CloudDeckService, MockFirebaseAdapter } from '../lib/CloudDeckService';
import { MemoryDataStore } from '../lib/firestoreStore';
import { MockTasksAdapter } from '../lib/CloudTasksAdapter';

// Route/authorization tests can start an ephemeral background worker. Keep its
// provider boundary fake too; placeholder BYOK credentials must never go online.
vi.mock('../lib/client', async original => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...await original<typeof import('../lib/client')>(),
  resolveClient: vi.fn(({ callerKey }: { callerKey?: string }) => ({
    keySource: callerKey ? 'caller' : 'server',
    client: { ground: vi.fn(async () => { throw new Error('Unit-test provider unavailable'); }),
      structure: vi.fn(async () => { throw new Error('Unit-test provider unavailable'); }) },
  })),
}));

function app(over: NodeJS.ProcessEnv = {}, tasksAdapter?: MockTasksAdapter) {
  const store = new MemoryDataStore();
  const mockAuth = new MockFirebaseAdapter();
  const cloudDeckService = new CloudDeckService(store, mockAuth, mockAuth, tasksAdapter);
  return createApp(readEnv({ PORT: '8080', ...over }), {
    store,
    cloudDeckService,
    forceMemoryStore: true,
    ...(tasksAdapter ? { tasksAdapter } : {}),
  });
}

/** `Response.json()` is `unknown` under strict typing; tests state the shape. */
async function asJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface HealthBody {
  status: string;
  credentials: string;
  capabilities: {
    research: boolean;
    capture: boolean;
    pdf: boolean;
    scheduledRefresh: boolean;
    serverSpendEnabled: boolean;
  };
  budget: { capUsd: number; spentUsd: number; remainingUsd: number; exhausted: boolean };
}
interface ErrorBody {
  error: string;
}
interface RefreshBody {
  ok: boolean;
}

async function post(
  a: ReturnType<typeof app>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return a.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('GET /healthz', () => {
  it('answers even with no credentials, and says so', async () => {
    const res = await app().request('/healthz');
    expect(res.status).toBe(200);
    const body = await asJson<HealthBody>(res);
    expect(body.status).toBe('ok');
    // A container that reports its own missing config turns a support ticket
    // into a single curl.
    expect(body.credentials).toMatch(/none/);
  });

  it('reports which credential mode is active', async () => {
    const withKey = await asJson<HealthBody>(await app({ GEMINI_API_KEY: 'k' }).request('/healthz'));
    expect(withKey.credentials).toBe('gemini-api-key');

    const withVertex = await asJson<HealthBody>(
      await app({ USE_VERTEX_AI: 'true', GOOGLE_CLOUD_PROJECT: 'p' }).request('/healthz'),
    );
    expect(withVertex.credentials).toBe('vertex-ai-adc');
  });

  it('reports scheduled refresh as unavailable until a token is configured', async () => {
    const off = await asJson<HealthBody>(await app().request('/healthz'));
    expect(off.capabilities.scheduledRefresh).toBe(false);

    const on = await asJson<HealthBody>(await app({ SCHEDULER_TOKEN: 't' }).request('/healthz'));
    expect(on.capabilities.scheduledRefresh).toBe(true);
  });

  it('reports whether anyone may spend the service credentials', async () => {
    const closed = await asJson<HealthBody>(await app({ GEMINI_API_KEY: 'k' }).request('/healthz'));
    expect(closed.capabilities.serverSpendEnabled).toBe(false);

    const open = await asJson<HealthBody>(
      await app({ GEMINI_API_KEY: 'k', APP_TOKEN: 't' }).request('/healthz'),
    );
    expect(open.capabilities.serverSpendEnabled).toBe(true);
  });

  it('publishes the remaining allowance so an exhausted budget is diagnosable', async () => {
    const body = await asJson<HealthBody>(
      await app({ GEMINI_API_KEY: 'k', DAILY_CAP_USD: '7.5' }).request('/healthz'),
    );
    expect(body.budget.capUsd).toBe(7.5);
    expect(body.budget.spentUsd).toBe(0);
    expect(body.budget.exhausted).toBe(false);
  });
});

describe('GET /v1/agent-graph', () => {
  it('exposes the agent topology without needing a credential', async () => {
    const res = await app().request('/v1/agent-graph');
    expect(res.status).toBe(200);
    const graph = await asJson<unknown>(res);
    expect(graph).toBeTruthy();
    expect(JSON.stringify(graph).length).toBeGreaterThan(50);
  });
});

describe('POST /v1/research', () => {
  it('rejects a body with neither a query nor a plan', async () => {
    const res = await post(app({ GEMINI_API_KEY: 'k' }), '/v1/research', {});
    expect(res.status).toBe(400);
    expect((await asJson<ErrorBody>(res)).error).toMatch(/query or a plan/);
  });

  it('rejects a malformed body before touching a model', async () => {
    const res = await post(app({ GEMINI_API_KEY: 'k' }), '/v1/research', { query: 'x' });
    expect(res.status).toBe(400);
  });

  it('refuses to spend without authorisation, before reaching credentials', async () => {
    // 401 rather than 503: the question "who is paying for this" is answered
    // before the question "do we have a key". An open endpoint attached to a
    // billing account is the failure mode this prevents.
    const res = await post(app({ GEMINI_API_KEY: 'k' }), '/v1/research', {
      query: 'vegan sneaker brands',
    });
    expect(res.status).toBe(401);
    const body = await asJson<ErrorBody>(res);
    expect(body.error).toMatch(/X-Gemini-Key/);
    expect(body.error).toMatch(/X-Stratemark-Token/);
  });

  it('refuses an invalid app token', async () => {
    const res = await post(
      app({ GEMINI_API_KEY: 'k', APP_TOKEN: 'right' }),
      '/v1/research',
      { query: 'vegan sneaker brands' },
      { 'x-stratemark-token': 'wrong' },
    );
    expect(res.status).toBe(401);
  });

  it('refuses when the daily allowance cannot cover a deck', async () => {
    // Cap below the cost of one deck: the request must be turned away up front
    // rather than producing half a deck and a bill.
    const res = await post(
      app({ GEMINI_API_KEY: 'k', APP_TOKEN: 'tok', DAILY_CAP_USD: '0.01' }),
      '/v1/research',
      { query: 'vegan sneaker brands' },
      { 'x-stratemark-token': 'tok' },
    );
    expect(res.status).toBe(429);
    expect((await asJson<ErrorBody>(res)).error).toMatch(/daily spending limit/);
  });

  it('rate limits a caller hammering research', async () => {
    const a = app({ GEMINI_API_KEY: 'k', APP_TOKEN: 'tok', DAILY_CAP_USD: '0.01' });
    const hit = () =>
      post(a, '/v1/research', { query: 'vegan sneaker brands' }, {
        'x-stratemark-token': 'tok',
        'x-forwarded-for': '203.0.113.7',
      });
    // Limit is 6/minute; the budget refusal at 429 does not consume authorisation,
    // so the seventh must be refused by the limiter rather than reaching work.
    for (let i = 0; i < 6; i += 1) await hit();
    const res = await hit();
    expect(res.status).toBe(429);
    expect((await asJson<ErrorBody>(res)).error).toMatch(/Too many requests/);
  });

  it('persists and returns the exact cloud deck identity for a supplied plan', async () => {
    const tasks = new MockTasksAdapter();
    const a = app({ GEMINI_API_KEY: 'k', APP_TOKEN: 't' }, tasks);
    const res = await post(
      a,
      '/api/research/deck',
      {
        deckId: 'deck_exact_identity',
        plan: { marketName: 'Test', vertical: 'Test', geography: null, notes: null, searchThemes: [] },
      },
      { Authorization: 'Bearer valid_token', 'X-Stratemark-Token': 't' },
    );

    expect(res.status).toBe(202);
    expect((await asJson<{ deckId: string; state: { status: string } }>(res))).toMatchObject({
      deckId: 'deck_exact_identity',
      state: { status: 'running' },
    });
    expect(tasks.queuedTasks[0]?.maxCandidates).toBe(10);
    const deck = await a.request('/api/decks/deck_exact_identity', {
      headers: { Authorization: 'Bearer valid_token' },
    });
    expect(deck.status).toBe(200);
  });
});

describe('POST /v1/capture', () => {
  it('refuses the cloud metadata server', async () => {
    const res = await post(app({ GEMINI_API_KEY: 'k' }), '/v1/capture', {
      url: 'http://169.254.169.254/computeMetadata/v1/',
    });
    expect(res.status).toBe(403);
  });

  it('refuses a non-http scheme', async () => {
    const res = await post(app({ GEMINI_API_KEY: 'k' }), '/v1/capture', {
      url: 'file:///etc/passwd',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a missing url', async () => {
    expect((await post(app(), '/v1/capture', {})).status).toBe(400);
  });
});

describe('POST /v1/report/pdf', () => {
  it('rejects an empty document', async () => {
    expect((await post(app(), '/v1/report/pdf', { html: '' })).status).toBe(400);
  });
});

describe('POST /tasks/refresh', () => {
  it('is unavailable until a scheduler token is configured', async () => {
    expect((await post(app({ GEMINI_API_KEY: 'k' }), '/tasks/refresh', {})).status).toBe(503);
  });

  const MOCK_TOKEN = `header.${Buffer.from(JSON.stringify({ email: 'scheduler@example.com' })).toString('base64')}.sig`;
  const MOCK_WRONG_TOKEN = `header.${Buffer.from(JSON.stringify({ email: 'hacker@example.com' })).toString('base64')}.sig`;

  it('rejects a caller without the token — this endpoint spends money', async () => {
    const res = await post(
      app({ GEMINI_API_KEY: 'k', SCHEDULER_SERVICE_ACCOUNT_EMAIL: 'scheduler@example.com' }),
      '/tasks/refresh',
      {},
    );
    expect(res.status).toBe(401);
  });

  it('rejects a wrong token', async () => {
    const res = await post(
      app({ GEMINI_API_KEY: 'k', SCHEDULER_SERVICE_ACCOUNT_EMAIL: 'scheduler@example.com' }),
      '/tasks/refresh',
      {},
      { 'authorization': `Bearer ${MOCK_WRONG_TOKEN}` },
    );
    expect(res.status).toBe(401);
  });

  it('accepts the configured token', async () => {
    const res = await post(
      app({ GEMINI_API_KEY: 'k', SCHEDULER_SERVICE_ACCOUNT_EMAIL: 'scheduler@example.com' }),
      '/tasks/refresh',
      {},
      { 'authorization': `Bearer ${MOCK_TOKEN}` },
    );
    expect(res.status).toBe(200);
    expect((await asJson<RefreshBody>(res)).ok).toBe(true);
  });

  it('will not run a refresh with no credentials even when the token is right', async () => {
    const res = await post(
      app({ SCHEDULER_SERVICE_ACCOUNT_EMAIL: 'scheduler@example.com' }),
      '/tasks/refresh',
      {},
      { 'authorization': `Bearer ${MOCK_TOKEN}` },
    );
    expect(res.status).toBe(503);
  });
});

describe('Cloud Tasks Worker Endpoints & OIDC Security', () => {
  const MOCK_WORKER_TOKEN = `header.${Buffer.from(JSON.stringify({ email: 'worker-sa@example.com' })).toString('base64')}.sig`;
  const MOCK_WRONG_TOKEN = `header.${Buffer.from(JSON.stringify({ email: 'stranger@example.com' })).toString('base64')}.sig`;

  it('verifies OIDC token when TASKS_SERVICE_ACCOUNT_EMAIL is configured', async () => {
    const a = app({
      GEMINI_API_KEY: 'k',
      TASKS_PROJECT_ID: 'test-proj',
      TASKS_LOCATION: 'us-central1',
      TASKS_QUEUE: 'deck-queue',
      TASKS_WORKER_URL: 'http://localhost/tasks/worker/research',
      TASKS_SERVICE_ACCOUNT_EMAIL: 'worker-sa@example.com',
    });

    // Unauthenticated
    const resUnauth = await post(a, '/tasks/worker/research', {
      deckId: 'd1',
      userId: 'u1',
      plan: { marketName: 'M' },
    });
    expect(resUnauth.status).toBe(401);

    // Wrong email in token
    const resWrong = await post(
      a,
      '/tasks/worker/research',
      { deckId: 'd1', userId: 'u1', plan: { marketName: 'M' } },
      { Authorization: `Bearer ${MOCK_WRONG_TOKEN}` },
    );
    expect(resWrong.status).toBe(401);

    // Valid OIDC token with invalid payload
    const resBadPayload = await post(
      a,
      '/tasks/worker/research',
      { deckId: 'd1' },
      { Authorization: `Bearer ${MOCK_WORKER_TOKEN}` },
    );
    expect(resBadPayload.status).toBe(400);

    // Valid OIDC token on refresh endpoint
    const resRefreshWrong = await post(
      a,
      '/tasks/worker/refresh',
      { deckId: 'd1', userId: 'u1', query: 'Q' },
      { Authorization: `Bearer ${MOCK_WRONG_TOKEN}` },
    );
    expect(resRefreshWrong.status).toBe(401);
  });
});

describe('REST Persistence API Endpoints', () => {
  it('serves /api/me user profile', async () => {
    const res = await app().request('/api/me', {
      headers: { Authorization: 'Bearer valid_token' },
    });
    expect(res.status).toBe(200);
    const body = await asJson<{ user: { id: string; subscriptionTier: string } }>(res);
    expect(body.user.id).toBe('user_123');
    expect(body.user.subscriptionTier).toBe('pro');
  });

  it('handles saved cards CRUD', async () => {
    const store = new MemoryDataStore();
    const auth = new MockFirebaseAdapter();
    const service = new CloudDeckService(store, auth, auth);
    await service.saveDeck('user_123', 'deck_saved', { deck: { id: 'deck_saved' }, market: {}, cards: [{
      card: { id: 'card_xyz', deckId: 'deck_saved', companyId: null, cardType: 'insight', title: 'Top AI Co', summary: null,
        tier: null, tierReason: null, citations: [], keyPoints: [], createdAt: '2026-10-02T00:00:00.000Z' },
      company: null, metrics: [], viceClaims: [],
    }] });
    const a = createApp(readEnv({}), { store, cloudDeckService: service, forceMemoryStore: true });
    const headers = { Authorization: 'Bearer valid_token' };

    // Initially empty
    const list1 = await a.request('/api/cards/saved', { headers });
    expect(list1.status).toBe(200);
    expect((await asJson<{ cards: Array<Record<string, unknown>> }>(list1)).cards).toEqual([]);

    // Save a card
    const saveRes = await post(a, '/api/cards/saved', { cardId: 'card_xyz', title: 'Top AI Co' }, headers);
    expect(saveRes.status).toBe(200);

    // List again
    const list2 = await a.request('/api/cards/saved', { headers });
    const cards2 = (await asJson<{ cards: Array<{ card: { id: string } }> }>(list2)).cards;
    expect(cards2.length).toBe(1);
    expect(cards2[0]?.card.id).toBe('card_xyz');

    // Unsave card
    const deleteRes = await a.request('/api/cards/saved/card_xyz', { method: 'DELETE', headers });
    expect(deleteRes.status).toBe(200);

    // List after deletion
    const list3 = await a.request('/api/cards/saved', { headers });
    expect((await asJson<{ cards: Array<Record<string, unknown>> }>(list3)).cards.length).toBe(0);
  });

  it('manages markets and decks listing', async () => {
    const a = app();
    const marketsRes = await a.request('/api/markets', { headers: { Authorization: 'Bearer valid_token' } });
    expect(marketsRes.status).toBe(200);
    const decksRes = await a.request('/api/decks', { headers: { Authorization: 'Bearer valid_token' } });
    expect(decksRes.status).toBe(200);
  });

  it('rejects raw bearer strings, emails, demo tokens, expired tokens, and service app tokens as user identity', async () => {
    const a = app({ APP_TOKEN: 'service_secret_token_123' });

    // Missing auth header
    expect((await a.request('/api/me')).status).toBe(401);

    // Raw string
    expect((await a.request('/api/me', { headers: { Authorization: 'Bearer raw_bearer' } })).status).toBe(401);

    // Demo token
    expect((await a.request('/api/me', { headers: { Authorization: 'Bearer demo-user-token' } })).status).toBe(401);

    // Email address
    expect((await a.request('/api/me', { headers: { Authorization: 'Bearer user@stratemark.com' } })).status).toBe(401);

    // Expired token
    expect((await a.request('/api/me', { headers: { Authorization: 'Bearer expired_token' } })).status).toBe(401);

    // Service app token in Authorization header cannot act as a user
    expect((await a.request('/api/me', { headers: { Authorization: 'Bearer service_secret_token_123' } })).status).toBe(401);
  });

  it('returns indistinguishable 404 for cross-owner and non-existent deck access', async () => {
    const tasks = new MockTasksAdapter();
    const a = app({ GEMINI_API_KEY: 'k', APP_TOKEN: 't' }, tasks);

    // User Pro creates deck_tenant_a
    const createRes = await post(
      a,
      '/api/research/deck',
      {
        deckId: 'deck_tenant_a',
        plan: { marketName: 'Fintech', vertical: 'Finance', geography: null, notes: null, searchThemes: [] },
      },
      { Authorization: 'Bearer valid_pro_token', 'X-Stratemark-Token': 't' },
    );
    expect(createRes.status).toBe(202);

    // Owner (user_pro) can fetch it
    const ownerRes = await a.request('/api/decks/deck_tenant_a', {
      headers: { Authorization: 'Bearer valid_pro_token' },
    });
    expect(ownerRes.status).toBe(200);

    // Other user (valid_other_user) gets 404 Not found
    const crossRes = await a.request('/api/decks/deck_tenant_a', {
      headers: { Authorization: 'Bearer valid_other_user' },
    });
    expect(crossRes.status).toBe(404);
    const crossBody = await asJson<{ error: string }>(crossRes);
    expect(crossBody.error).toBe('Not found');

    // Missing deck gets identical 404 Not found
    const missingRes = await a.request('/api/decks/deck_missing_xyz', {
      headers: { Authorization: 'Bearer valid_other_user' },
    });
    expect(missingRes.status).toBe(404);
    const missingBody = await asJson<{ error: string }>(missingRes);
    expect(missingBody.error).toBe('Not found');

    // Cross-owner delete returns 404 Not found
    const crossDeleteRes = await a.request('/api/decks/deck_tenant_a', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid_other_user' },
    });
    expect(crossDeleteRes.status).toBe(404);
  });

  it('refuses cloud research creation for users without active pro entitlement', async () => {
    const tasks = new MockTasksAdapter();
    const a = app({ GEMINI_API_KEY: 'k', APP_TOKEN: 't' }, tasks);

    // Free user attempting cloud research
    const res = await post(
      a,
      '/api/research/deck',
      {
        deckId: 'deck_free_attempt',
        plan: { marketName: 'Health', vertical: 'Bio', geography: null, notes: null, searchThemes: [] },
      },
      { Authorization: 'Bearer valid_free_token', 'X-Stratemark-Token': 't' },
    );
    expect(res.status).toBe(401);
    expect((await asJson<{ error: string }>(res)).error).toMatch(/entitlement/i);
  });

  it('BYOK compute operates synchronously and does not persist cloud deck records', async () => {
    const a = app({ APP_TOKEN: 't' });

    // BYOK request with Gemini Key
    const res = await post(
      a,
      '/v1/research',
      {
        deckId: 'deck_byok_ephemeral',
        plan: { marketName: 'Test Market', vertical: 'Tech', geography: null, notes: null, searchThemes: [] },
      },
      { 'X-Gemini-Key': 'AIza-custom-key' },
    );

    expect(res.status).toBe(200);
    const body = await asJson<{ ok: boolean; deckId: string }>(res);
    expect(body.ok).toBe(true);

    // Ephemeral BYOK deck was NOT saved in cloud store
    const fetchRes = await a.request('/api/decks/deck_byok_ephemeral', {
      headers: { Authorization: 'Bearer valid_pro_token' },
    });
    expect(fetchRes.status).toBe(404);
  });

  it('handles idempotent deck creation requests for the same user and deckId', async () => {
    const tasks = new MockTasksAdapter();
    const a = app({ GEMINI_API_KEY: 'k', APP_TOKEN: 't' }, tasks);

    const payload = {
      deckId: 'deck_idempotent_1',
      plan: { marketName: 'Autonomous Robotics', vertical: 'Robotics', geography: null, notes: null, searchThemes: [] },
    };
    const headers = { Authorization: 'Bearer valid_pro_token', 'X-Stratemark-Token': 't' };

    const firstRes = await post(a, '/api/research/deck', payload, headers);
    expect(firstRes.status).toBe(202);

    const secondRes = await post(a, '/api/research/deck', payload, headers);
    expect(secondRes.status).toBe(202);

    const fetched = await a.request('/api/decks/deck_idempotent_1', { headers: { Authorization: 'Bearer valid_pro_token' } });
    expect(fetched.status).toBe(200);
    const body = await asJson<{ state: { status: string }; revision: number }>(fetched);
    expect(body.state.status).toBe('running');
  });

  it('returns 413 when attempting to save an oversized deck record', async () => {
    const store = new MemoryDataStore();
    const hugePayload = 'z'.repeat(1_050_000);
    let thrown: (Error & { status?: number }) | null = null;
    try {
      await store.saveDeck('deck_oversize', {
        deck: { id: 'deck_oversize', title: 'Oversize', blob: hugePayload },
        market: { id: 'deck_oversize', name: 'Oversize' },
        cards: [],
        userId: 'user_pro',
      });
    } catch (e) {
      thrown = e as Error & { status?: number };
    }
    expect(thrown?.status).toBe(413);
  });
});
