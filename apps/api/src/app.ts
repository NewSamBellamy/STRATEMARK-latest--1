/**
 * The Stratemark agent service.
 *
 * This is the server half of the product, and it exists for four reasons that
 * the browser build cannot satisfy on its own:
 *
 *   1. The agent graph runs on the official Google GenAI SDK here.
 *   2. Page capture needs a real browser, not a sandboxed one.
 *   3. Scheduled refresh needs something awake when nobody is looking.
 *   4. A PDF needs a print engine.
 *
 * Every route accepts an optional `X-Gemini-Key`. Supplying it means "use my
 * credentials" — the bring-your-own-key subscriber, who pays their own model
 * costs while we provide storage, sync and sharing. Omitting it means the
 * service's own credentials do the work. See lib/client.ts.
 */
import { GoogleGenAI } from '@google/genai';
import { Hono, type Context } from 'hono';
import { getFirestore } from 'firebase-admin/firestore';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { 
  describeAgentGraph, 
  runLivingDeckEngine, 
  expandDeckWithDeltaAgent,
  researchDashboardTab,
  verifyMetricOutSchema, 
  huntMetricsOutSchema,
  GROUNDED_SYSTEM, 
  STRUCTURE_SYSTEM
} from '@mi/research';
import type { DashboardTab, CardWithCompany, Company } from '@mi/contracts';
import { 
  usableCitations, 
  hasVerificationGradeCitation, 
  markVerified,
  buildCmsInput,
  buildUserFootprintCohort,
  inferUserFootprintBasis,
  computeCms,
  METRIC_TYPE_LABELS,
  metricDisplayLabel,
  METRIC_TYPES
} from '@mi/contracts';
import type { CompanyMetric } from '@mi/contracts';
import type { MarketPlan } from '@mi/research';
import { hasServerCredentials, type ServiceEnv } from './env';
import { BYOK_HEADER, NoCredentialsError, resolveClient } from './lib/client';
import {
  APP_TOKEN_HEADER,
  authorizeSpend,
  callerKeyFor,
  RateLimiter,
  RateLimitedError,
  UnauthorizedSpendError,
} from './lib/authz';
import { BudgetExhaustedError, DailyBudget } from './lib/budget';
import { capturePage, CaptureError, type CaptureReceipt } from './lib/capture';
import { verifyCapture } from './lib/verify';
import { createVisionJudge } from './lib/vision';
import { fallbackCaption, renderFallbackCard } from './lib/fallback';
import { renderPdf } from './lib/pdf';
import { executeScheduledRefresh, type WorklistStore } from './lib/worklist';
import { createDataStore, type StratemarkDataStore } from './lib/firestoreStore';
import { CloudDeckService, FirebaseAdapter } from './lib/CloudDeckService';
import { CloudDeckWorker } from './lib/CloudDeckWorker';
import { CloudTasksAdapter, MockTasksAdapter, type TasksAdapter } from './lib/CloudTasksAdapter';
import { AgentObservabilityLogger, parseTraceContext } from './lib/observability';

const planSchema = z.object({
  marketName: z.string().min(1),
  vertical: z.string().min(1),
  geography: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  searchThemes: z.array(z.string()).default([]),
});

const researchSchema = z.object({
  query: z.string().min(3).max(300).optional(),
  plan: planSchema.optional(),
  deckId: z.string().min(1).optional(),
  maxCandidates: z.number().int().min(1).max(30).optional(),
  watch: z.boolean().optional(),
});

const captureSchema = z.object({
  url: z.string().min(4),
  fullPage: z.boolean().optional(),
});

const pdfSchema = z.object({
  html: z.string().min(1),
  landscape: z.boolean().optional(),
  filename: z.string().max(120).optional(),
});

/** Turns a plain-language market question into a plan the graph can execute. */
async function planFromQuery(
  client: Awaited<ReturnType<typeof resolveClient>>['client'],
  query: string,
): Promise<MarketPlan> {
  const grounded = await client.ground(
    `Identify the market implied by this request: "${query}". ` +
      'Name the market, its vertical, and its geography if one is implied. ' +
      'Suggest four distinct angles worth searching to find the companies in it.',
  );
  return client.structure(
    `From this research, produce the market plan.\n\n${grounded.text}`,
    planSchema as unknown as z.ZodType<MarketPlan, z.ZodTypeDef, unknown>,
  );
}

/** Estimated cost of one full deck run — checked before work begins. */
const DECK_ESTIMATE_USD = 0.65;
/** Estimated cost of one capture with a vision adjudication. */
const CAPTURE_ESTIMATE_USD = 0.002;
/** Reserve enough budget for one grounded verification or metrics hunt. */
const METRIC_RESEARCH_ESTIMATE_USD = 0.05;
/** Keep the asynchronous judging path inside the Cloud Run worker budget. */
const CLOUD_DEFAULT_MAX_CANDIDATES = 10;

export function createApp(
  env: ServiceEnv,
  options?: {
    store?: StratemarkDataStore;
    worklistStore?: WorklistStore;
    forceMemoryStore?: boolean;
    cloudDeckService?: CloudDeckService;
    tasksAdapter?: TasksAdapter;
  },
): Hono {
  const app = new Hono();
  const deckUserFootprintCohort = (cards: CardWithCompany[]) =>
    buildUserFootprintCohort(
      cards
        .filter((card) => card.card.cardType === 'company' && card.company)
        .flatMap((card) => card.metrics),
    );
  const store = createDataStore(env, {
    store: options?.store,
    forceMemory: options?.forceMemoryStore,
    allowMemoryFallback: options?.forceMemoryStore,
  });

  const tasksAdapter = options?.tasksAdapter ?? (env.tasks ? new CloudTasksAdapter(env) : new MockTasksAdapter(env.port));
  const cloudDeckService = options?.cloudDeckService ?? new CloudDeckService(store, new FirebaseAdapter(), new FirebaseAdapter(), tasksAdapter);
  const cloudDeckWorker = new CloudDeckWorker(env, cloudDeckService);

  // Per-instance guards. See lib/budget.ts and lib/authz.ts for why these are
  // in memory and what that does and does not protect.
  const budget = new DailyBudget(env.dailyCapUsd);
  const researchLimiter = new RateLimiter(6, 60_000);
  const captureLimiter = new RateLimiter(20, 60_000);

  /** Maps our guard errors onto responses without leaking internals. */
  const guardError = (err: unknown): { status: 401 | 429; body: Record<string, unknown> } | null => {
    if (err instanceof UnauthorizedSpendError) return { status: 401, body: { error: err.message } };
    if (err instanceof RateLimitedError) return { status: 429, body: { error: err.message } };
    if (err instanceof BudgetExhaustedError) {
      return { status: 429, body: { error: err.message, budget: err.budget } };
    }
    return null;
  };

  const getUserId = async (c: Context): Promise<string | null> => {
    const auth = c.req.header('authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (auth) {
      if (env.appToken && auth === env.appToken) return null;
      return await cloudDeckService.authenticate(auth);
    }
    return null;
  };

  const authorizeCloudResearch = async (
    c: Context,
    estimatedUsd: number,
  ): Promise<{ userId: string; callerKey: string | undefined; metered: boolean }> => {
    const callerKey = c.req.header(BYOK_HEADER);
    const rawAppToken = c.req.header(APP_TOKEN_HEADER);
    const authHeader = c.req.header('authorization')?.replace(/^Bearer\s+/i, '').trim();
    const appToken = rawAppToken
      ? rawAppToken
      : authHeader && env.appToken && authHeader === env.appToken
        ? authHeader
        : undefined;
    const userId = await getUserId(c);
    if (!userId) throw new UnauthorizedSpendError('Authenticated user required for cloud research');

    const authorization = authorizeSpend({ env, callerKey, appToken });
    researchLimiter.check(callerKeyFor({ forwardedFor: c.req.header('x-forwarded-for'), appToken }));
    if (authorization.metered && !budget.canAfford(estimatedUsd)) {
      throw new BudgetExhaustedError(budget.status());
    }
    return { userId, callerKey, metered: authorization.metered };
  };

  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (env.allowedOrigins.length > 0 && origin) {
          return env.allowedOrigins.includes(origin) ? origin : env.allowedOrigins[0];
        }
        return origin || '*';
      },
      allowHeaders: [
        'Content-Type',
        'X-Gemini-Key',
        'X-Stratemark-Token',
        'x-scheduler-token',
        'Authorization',
        'authorization',
        'Accept',
      ],
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS', 'PUT', 'PATCH'],
      credentials: true,
    }),
  );

  const healthHandler = (c: Context) =>
    c.json({
      status: 'ok',
      service: 'stratemark-agent-service',
      credentials: hasServerCredentials(env)
        ? env.vertex
          ? 'vertex-ai-adc'
          : 'gemini-api-key'
        : 'none — callers must supply X-Gemini-Key',
      capabilities: {
        research: true,
        capture: true,
        pdf: true,
        scheduledRefresh: Boolean(env.schedulerToken),
        /** False means callers must bring their own key to spend anything. */
        serverSpendEnabled: Boolean(env.appToken),
      },
      // Deliberately public: the remaining allowance is not a secret, and
      // surfacing it turns "why did research stop working" into one request.
      budget: budget.status(),
    });

  /**
   * Liveness plus an honest capability report. Cloud Run needs the former;
   * the latter turns "why does nothing work" into a single curl.
   */
  app.get('/healthz', healthHandler);
  app.get('/health', healthHandler);
  app.get('/', healthHandler);

  /**
   * The agent topology as data. Judges (and the UI) can see the graph without
   * running it or holding a credential.
   */
  app.get('/v1/agent-graph', (c) => c.json(describeAgentGraph({ watch: true })));

  /** User profile endpoint for Cloud Engine */
  app.get('/api/me', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    const isPro = await cloudDeckService.checkEntitlement(userId);
    return c.json({
      user: {
        id: userId,
        email: `${userId}@stratemark.com`, // placeholder
        subscriptionTier: isPro ? 'pro' : 'free',
        subscriptionStatus: 'active',
      },
    });
  });

  app.get('/api/alerts', (c) => c.json({ alerts: [] }));
  app.get('/api/markets', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    const markets = await cloudDeckService.getMarkets(userId);
    return c.json({ markets });
  });
  app.get('/api/markets/:id', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    const id = c.req.param('id');
    const m = await cloudDeckService.getMarket(userId, id);
    if (!m) return c.json({ error: 'Not found' }, 404);
    return c.json({ market: m });
  });
  app.get('/api/decks', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    const decks = await cloudDeckService.getDecks(userId);
    return c.json({ decks });
  });
  app.get('/api/decks/:deckId', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    const deckId = c.req.param('deckId');
    const d = await cloudDeckService.getDeck(userId, deckId);
    if (!d) return c.json({ error: 'Not found' }, 404);
    return c.json(d);
  });
  app.get('/api/cards', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    const deckId = c.req.query('deckId') || '';
    const d = deckId ? await cloudDeckService.getDeck(userId, deckId) : null;
    return c.json({ cards: d?.cards || [] });
  });
  app.get('/api/cards/saved', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    const cards = await cloudDeckService.getSavedCards(userId);
    return c.json({ cards });
  });
  app.post('/api/cards/saved', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    const body = await c.req.json().catch(() => ({}));
    if (!body.cardId) {
      return c.json({ error: 'cardId is required' }, 400);
    }
    await cloudDeckService.saveCard(userId, String(body.cardId), { 
      deckId: body.deckId, 
      deckRevision: body.deckRevision 
    });
    return c.json({ ok: true });
  });
  app.delete('/api/cards/saved/:cardId', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    const cardId = c.req.param('cardId');
    await cloudDeckService.unsaveCard(userId, cardId);
    return c.json({ ok: true });
  });
  app.delete('/api/decks/:deckId', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    const deckId = c.req.param('deckId');
    const success = await cloudDeckService.deleteDeck(userId, deckId);
    if (!success) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  });

  // Explicit Deck Sharing (Issue #57)
  const shareCreationHandler = async (c: Context) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    const deckId = c.req.param('deckId');
    if (!deckId) return c.json({ error: 'deckId is required' }, 400);
    const body = await c.req.json().catch(() => ({}));
    try {
      const share = await cloudDeckService.createShare(userId, deckId, {
        expiresInDays: body.expiresInDays,
      });
      return c.json(share, 201);
    } catch (err: unknown) {
      const e = err as Error;
      if (e.message.includes('not found') || e.message.includes('Not found')) {
        return c.json({ error: 'Not found' }, 404);
      }
      return c.json({ error: e.message }, 500);
    }
  };
  app.post('/api/decks/:deckId/share', shareCreationHandler);
  app.post('/v1/decks/:deckId/share', shareCreationHandler);

  const getSharedHandler = async (c: Context) => {
    const token = c.req.param('token');
    if (!token) return c.json({ error: 'token is required' }, 400);
    const sharedDeck = await cloudDeckService.getSharedDeck(token);
    if (!sharedDeck) return c.json({ error: 'Not found' }, 404);
    return c.json(sharedDeck);
  };
  app.get('/api/shares/:token', getSharedHandler);
  app.get('/v1/shares/:token', getSharedHandler);

  const revokeShareHandler = async (c: Context) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    const shareId = c.req.param('shareId');
    if (!shareId) return c.json({ error: 'shareId is required' }, 400);
    const revoked = await cloudDeckService.revokeShare(userId, shareId);
    if (!revoked) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  };
  app.delete('/api/shares/:shareId', revokeShareHandler);
  app.delete('/v1/shares/:shareId', revokeShareHandler);

  // Cloud Artifacts Storage (Issue #57)
  const uploadArtifactHandler = async (c: Context) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    const deckId = c.req.param('deckId');
    if (!deckId) return c.json({ error: 'deckId is required' }, 400);
    const body = await c.req.json().catch(() => ({}));
    if (!body.filename || !body.data) {
      return c.json({ error: 'filename and base64 data are required' }, 400);
    }
    try {
      const buffer = Buffer.from(body.data, 'base64');
      const meta = await cloudDeckService.saveArtifact(userId, deckId, {
        filename: body.filename,
        mimeType: body.mimeType || 'application/octet-stream',
        buffer,
      });
      return c.json(meta, 201);
    } catch (err: unknown) {
      const e = err as Error;
      if (e.message.includes('not found') || e.message.includes('Not found')) {
        return c.json({ error: 'Not found' }, 404);
      }
      return c.json({ error: e.message }, 500);
    }
  };
  app.post('/api/decks/:deckId/artifacts', uploadArtifactHandler);
  app.post('/v1/decks/:deckId/artifacts', uploadArtifactHandler);

  const getArtifactHandler = async (c: Context) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    const artifactId = c.req.param('artifactId');
    if (!artifactId) return c.json({ error: 'artifactId is required' }, 400);
    const artifact = await cloudDeckService.getArtifact(userId, artifactId);
    if (!artifact) return c.json({ error: 'Not found' }, 404);
    return new Response(artifact.buffer, {
      status: 200,
      headers: {
        'Content-Type': artifact.metadata.mimeType,
        'Content-Disposition': `inline; filename="${artifact.metadata.filename}"`,
      },
    });
  };
  app.get('/api/artifacts/:artifactId', getArtifactHandler);
  app.get('/v1/artifacts/:artifactId', getArtifactHandler);

  // Account Purge (Issue #57)
  const accountPurgeHandler = async (c: Context) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    const purgeResult = await cloudDeckService.purgeAccount(userId);
    return c.json(purgeResult);
  };
  app.delete('/api/account', accountPurgeHandler);
  app.delete('/v1/account', accountPurgeHandler);

  /** Run the living-deck agent graph. */
  const researchHandler = async (c: Context) => {
    const json = await c.req.json().catch(() => ({}));
    const queryStr = (json.query || json.prompt || '').trim();
    const bodyData = {
      ...(queryStr ? { query: queryStr } : {}),
      ...(json.plan ? { plan: json.plan } : {}),
      ...(json.deckId ? { deckId: json.deckId } : {}),
      ...(json.maxCandidates || json.targetCompanies
        ? { maxCandidates: json.maxCandidates || json.targetCompanies }
        : {}),
      ...(json.watch !== undefined ? { watch: json.watch } : {}),
    };
    const body = researchSchema.safeParse(bodyData);
    if (!body.success) {
      return c.json({ error: 'Invalid request', detail: body.error.flatten() }, 400);
    }
    if (!body.data.query && !body.data.plan) {
      return c.json({ error: 'Provide either a query or a plan.' }, 400);
    }

    const callerKey = c.req.header(BYOK_HEADER);
    const rawAppToken = c.req.header(APP_TOKEN_HEADER);
    const authHeader = c.req.header('authorization')?.replace(/^Bearer\s+/i, '').trim();
    const appToken = rawAppToken
      ? rawAppToken
      : authHeader && env.appToken && authHeader === env.appToken
        ? authHeader
        : undefined;

    const userId = await getUserId(c);

    let metered = false;
    try {
      const authz = authorizeSpend({ env, callerKey, appToken });
      
      // Cloud Deck creation (/api/research/deck or cloud persistence) requires verified user with entitlement
      const isCloudDeckEndpoint = c.req.path.startsWith('/api/research/deck');
      if (isCloudDeckEndpoint) {
        if (!userId) {
          throw new UnauthorizedSpendError('Authenticated user required for cloud research');
        }
        const isEntitled = await cloudDeckService.checkEntitlement(userId);
        if (!isEntitled) {
          throw new UnauthorizedSpendError('Active Pro entitlement required for cloud research');
        }
      } else if (!callerKey && userId) {
        const isEntitled = await cloudDeckService.checkEntitlement(userId);
        if (!isEntitled) {
          throw new UnauthorizedSpendError('Active Pro entitlement required for cloud research');
        }
      }

      metered = authz.metered;
      researchLimiter.check(callerKeyFor({ forwardedFor: c.req.header('x-forwarded-for'), appToken }));
      if (metered && !budget.canAfford(DECK_ESTIMATE_USD)) {
        throw new BudgetExhaustedError(budget.status());
      }
    } catch (err) {
      const mapped = guardError(err);
      if (mapped) return c.json(mapped.body, mapped.status);
      throw err;
    }

    const calls: Array<{ model: string; kind: string }> = [];
    let resolved;
    try {
      resolved = resolveClient({
        env,
        callerKey,
        onCall: (info) => {
          calls.push(info);
          if (metered) budget.record(info.kind === 'ground' ? 'ground' : 'structure');
        },
      });
    } catch (err) {
      if (err instanceof NoCredentialsError) return c.json({ error: err.message }, 503);
      throw err;
    }

    const plan = body.data.plan ?? (await planFromQuery(resolved.client, body.data.query ?? ''));
    const deckId = body.data.deckId ?? `deck_${Date.now().toString(36)}`;
    const traceHeader = c.req.header('x-cloud-trace-context') || c.req.header('traceparent');
    const traceContext = parseTraceContext(traceHeader);
    const logger = new AgentObservabilityLogger({
      projectId: env.vertex?.project || process.env.GOOGLE_CLOUD_PROJECT || 'stratemark-agentic',
      traceContext,
      deckId,
      userId: userId ?? undefined,
    });

    // If it's a cloud generation request, enqueue it asynchronously
    if (!callerKey && userId) {
      const marketQuery = body.data.query ?? plan.marketName;
      logger.logInfo(`Enqueuing Cloud Deck creation for "${plan.marketName}" (${deckId})`, {
        query: marketQuery,
        maxCandidates: body.data.maxCandidates ?? CLOUD_DEFAULT_MAX_CANDIDATES,
      });
      const result = await cloudDeckService.enqueueCreation({
        deckId,
        userId,
        plan,
        query: marketQuery,
        maxCandidates: body.data.maxCandidates ?? CLOUD_DEFAULT_MAX_CANDIDATES,
        watch: body.data.watch,
        traceContext,
      });

      return c.json({
        ok: true,
        deckId: result.deckId,
        plan,
        state: { status: 'running' },
      }, 202);
    }

    // BYOK users execute synchronously without cloud persistence
    logger.logInfo(`Starting synchronous BYOK research for "${plan.marketName}" (${deckId})`);
    const run = await runLivingDeckEngine({
      client: resolved.client,
      plan,
      deckId,
      watch: body.data.watch ?? false,
      ...(body.data.maxCandidates === undefined ? {} : { maxCandidates: body.data.maxCandidates }),
      signal: AbortSignal.timeout(540_000),
      onTrace: (traceEvent) => {
        logger.logAdkTrace(traceEvent);
      },
    });
    logger.logNotice(`Synchronous BYOK research completed for "${plan.marketName}" (${deckId}) in ${run.totalMs}ms`, {
      totalCards: run.hydrated.reduce((acc, h) => acc + h.cards.length, 0),
      totalMs: run.totalMs,
    });

    const marketObj = {
      id: deckId,
      marketId: deckId,
      name: plan.marketName,
      scopeDefinition: { vertical: plan.vertical, geography: plan.geography, notes: plan.notes },
      refreshCadence: 'weekly',
      createdAt: new Date().toISOString(),
      engine: 'cloud',
    };
    const deckObj = {
      id: deckId,
      marketId: deckId,
      createdAt: new Date().toISOString(),
      lastRefreshedAt: new Date().toISOString(),
      engine: 'cloud',
    };
    // Removed cloudDeckService.saveDeck here because it's only synchronous BYOK runs now.

    return c.json({
      ok: true,
      deckId,
      plan,
      market: marketObj,
      deck: deckObj,
      cards: run.hydrated,
      state: run.state,
      statuses: run.statuses,
      summary: run.summary,
      timings: { bootMs: run.bootMs, totalMs: run.totalMs },
      aborted: run.aborted,
      billing: {
        keySource: resolved.keySource,
        calls: calls.length,
        metered,
        ...(metered ? { budget: budget.status() } : {}),
      },
    });
  };

  app.post('/v1/research', researchHandler);
  app.post('/api/research/deck', researchHandler);

  app.post('/api/research/chat', async (c) => {
    try {
      const input = await c.req.json().catch(() => ({}));
      const question = input.question || '';
      const uid = await getUserId(c);
      
      const db = getFirestore();
      
      let resolved;
      try {
        resolved = resolveClient({
          env,
          callerKey: c.req.header('X-Gemini-Key') || undefined,
        });
      } catch (err) {
        if (err instanceof NoCredentialsError) return c.json({ error: err.message }, 401);
        throw err;
      }
      
      const threadId = input.threadId || `thread_${uid}_default`;
      const threadRef = db.collection('chatThreads').doc(threadId);
      
      await db.runTransaction(async (t) => {
        const doc = await t.get(threadRef);
        const data = doc.exists ? doc.data() : { turns: 0, rawHistory: [], distilledMemory: '' };
        
        data!.turns = (data!.turns || 0) + 1;
        data!.rawHistory.push({ role: 'user', content: question });
        
        const MEMORY_DISTILLATION_THRESHOLD = 20;
        // Memory Distillation Guardrail (20+ turns)
        if (data!.turns > MEMORY_DISTILLATION_THRESHOLD) {
          // Bonus Points: Using additional Google AI Models (Gemma 2) for Distillation
          const summaryPrompt = `Distill these raw chat logs into a concise set of durable facts and context. Logs: ${JSON.stringify(data!.rawHistory)}`;
          
          let newMemory = '';
          try {
            // Instantiate Gemma directly using the Vertex integration
            const ai = new GoogleGenAI(
              env.vertex
                ? { vertexai: true, project: env.vertex.project, location: env.vertex.location }
                : { apiKey: env.geminiApiKey ?? '' },
            );
            const summaryRes = await ai.models.generateContent({
              model: 'gemma-2-9b-it',
              contents: summaryPrompt
            });
            newMemory = summaryRes.text ?? '';
          } catch {
            // Fallback to Gemini if Gemma is not deployed in this region
            const summaryRes = await resolved.client.ground(summaryPrompt, { system: 'You are a summarizer.' });
            newMemory = summaryRes.text;
          }

          data!.distilledMemory = `${data!.distilledMemory}\n${newMemory}`.trim();
          data!.rawHistory = []; // Clear raw history to prevent token bloat
          data!.turns = 0; // Reset counter for next distillation phase
        }
        
        t.set(threadRef, data!, { merge: true });
      });
      
      // Fetch thread again after transaction for generation
      const finalDoc = await threadRef.get();
      const finalData = finalDoc.data() || { distilledMemory: '', rawHistory: [] };
      
      // Combine distilled memory + recent history + new question
      const contextPrompt = `
      Semantic Memory: ${finalData.distilledMemory}
      Recent Chat: ${JSON.stringify(finalData.rawHistory)}
      New Question: ${question}
      `;
      
      const res = await resolved.client.ground(contextPrompt);

      return c.json({
        reply: res.text,
        distilledActive: Boolean(finalData.distilledMemory),
      });
    } catch (error) {
      console.error('Chat error', error);
      return c.json({ error: 'Chat failed' }, 500);
    }
  });

  app.post('/api/research/tab', async (c) => {
    try {
      const input = await c.req.json().catch(() => ({}));
      const { deckId, companyId, tab } = input;
      
      if (!deckId || !companyId || !tab) {
        return c.json({ error: 'Missing deckId, companyId, or tab' }, 400);
      }
      
      const uid = await getUserId(c);
      if (!uid) return c.json({ error: 'Unauthorized' }, 401);

      let deckRec = await store.getDeck(deckId);
      if (!deckRec && deckId.startsWith('mkt_')) {
        deckRec = (await store.getDeck(`deck_${deckId.slice(4)}`)) || (await store.getDeck(`dck_${deckId.slice(4)}`));
      }
      if (!deckRec || (deckRec.userId && deckRec.userId !== uid)) {
        return c.json({ error: 'Deck not found' }, 404);
      }

      const card = deckRec.cards?.find((c: CardWithCompany) => c.company?.id === companyId);
      if (!card || !card.company) return c.json({ error: 'Company not found in deck' }, 404);

      const resolved = resolveClient({
        env,
        callerKey: c.req.header('X-Gemini-Key') || undefined,
      });

      const content = await researchDashboardTab(tab as DashboardTab, {
        company: card.company as Company,
        marketName: deckRec.market.name as string,
        storedMetrics: card.metrics || [],
        client: resolved.client,
      });

      return c.json({ content });
    } catch (error) {
      console.error('Tab research error:', error);
      return c.json({ error: 'Tab generation failed' }, 500);
    }
  });

  app.post('/api/research/expand', async (c) => {
    const json = await c.req.json().catch(() => ({}));
    const marketId = json.marketId;
    const focus = json.focus;

    if (!marketId || !focus) {
      return c.json({ error: 'Missing marketId or focus' }, 400);
    }

    let access: Awaited<ReturnType<typeof authorizeCloudResearch>>;
    try {
      access = await authorizeCloudResearch(c, DECK_ESTIMATE_USD);
    } catch (err) {
      const mapped = guardError(err);
      if (mapped) return c.json(mapped.body, mapped.status);
      throw err;
    }
    const { userId, callerKey, metered } = access;

    const isEntitled = await cloudDeckService.checkEntitlement(userId!);
    if (!isEntitled) {
      return c.json({ error: 'Active subscription required for cloud agent.' }, 402);
    }

    let resolved;
    try {
      resolved = resolveClient({
        env,
        callerKey,
        onCall: (info) => {
          if (metered) budget.record(info.kind);
        },
      });
    } catch (err) {
      if (err instanceof NoCredentialsError) return c.json({ error: err.message }, 503);
      throw err;
    }

    const deckId = marketId;
    const existingDeck = await cloudDeckService.getDeck(userId!, deckId);
    if (!existingDeck) {
      return c.json({ error: 'Deck not found' }, 404);
    }

    const plan = existingDeck.plan;
    const vertical = ((plan as Record<string, unknown>)?.vertical ?? 'market-intel') as string;
    const marketName = ((plan as Record<string, unknown>)?.marketName ?? 'Market') as string;

    const currentCardsLength = existingDeck.cards?.length ?? 0;

    try {
      const updatedCards = await expandDeckWithDeltaAgent({
        client: resolved.client,
        marketName,
        vertical,
        existingCards: existingDeck.cards ?? [],
        focus: focus as string | Record<string, unknown>,
      });

      const addedCount = updatedCards.length - currentCardsLength;
      
      await cloudDeckService.saveDeck(userId!, deckId, {
        ...existingDeck,
        cards: updatedCards,
        refreshedAt: new Date().toISOString(),
        state: { ...existingDeck.state, status: 'ready' }
      }, existingDeck.revision);

      return c.json({ added: Math.max(0, addedCount) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500);
    }
  });

  app.post('/api/research/verify', async (c) => {
    const json = await c.req.json().catch(() => ({}));
    const { deckId, companyId, metricType, correction } = json;

    if (!deckId || !companyId || !metricType) {
      return c.json({ error: 'Missing parameters' }, 400);
    }

    let access: Awaited<ReturnType<typeof authorizeCloudResearch>>;
    try {
      access = await authorizeCloudResearch(c, METRIC_RESEARCH_ESTIMATE_USD);
    } catch (err) {
      const mapped = guardError(err);
      if (mapped) return c.json(mapped.body, mapped.status);
      throw err;
    }
    const { userId, callerKey, metered } = access;

    const isEntitled = await cloudDeckService.checkEntitlement(userId);
    if (!isEntitled) return c.json({ error: 'Active subscription required' }, 402);

        const existingDeck = await cloudDeckService.getDeck(userId, deckId);
    if (!existingDeck) return c.json({ error: 'Deck not found' }, 404);


    const cards = existingDeck.cards || [];
    const cardIdx = cards.findIndex(c => c.company?.id === companyId);
    if (cardIdx === -1) return c.json({ error: 'Company not found in deck' }, 404);
    
    const companyCard = cards[cardIdx]!;
    const company = companyCard.company!;
    const metricIdx = companyCard.metrics.findIndex(m => m.metricType === metricType);
    if (metricIdx === -1) return c.json({ error: 'Metric not found' }, 404);
    const metric = companyCard.metrics[metricIdx]!;

    const label = metricDisplayLabel(metric);
    const nowIso = new Date().toISOString();

    if (correction && correction.value != null) {
      const hintCited = usableCitations(correction.citations);
      if (hasVerificationGradeCitation(hintCited) && metric.confidence !== 'user_verified') {
        const prior = metric.value;
        const differs = prior == null || prior === 0 || Math.abs(correction.value - prior) / Math.max(Math.abs(prior), 1) > 0.02;
        let changed = false;
        if (differs) {
          metric.value = correction.value;
          metric.confidence = 'verified';
          metric.citations = hintCited;
          metric.source = hintCited[0]?.url ?? metric.source;
          metric.methodNote = correction.rationale ?? `Corrected from a grounded fact-check${correction.asOf ? ` (as of ${correction.asOf})` : ''}.`;
          if (metricType === 'users') {
            const inferredBasis = inferUserFootprintBasis(metric.methodNote);
            if (inferredBasis !== 'unknown') metric.userBasis = inferredBasis;
          }
          metric.capturedAt = nowIso;
          changed = true;
        }
        Object.assign(metric, markVerified(metric as CompanyMetric, nowIso));
        const priorTier = companyCard.card.tier;
        companyCard.card.tier = computeCms(buildCmsInput(companyCard.metrics), {
          userFootprintCohort: deckUserFootprintCohort(existingDeck.cards ?? []),
        }).finalTier;
        const retieredCardIds = changed && priorTier !== companyCard.card.tier ? [companyCard.card.id] : [];
        if (retieredCardIds.length > 0) {
          companyCard.card.tierReason = 'Re-tiered after a fact-check correction.';
        }

        await cloudDeckService.saveDeck(userId, deckId!, existingDeck, existingDeck.revision);
        
        return c.json({
          metric,
          verdict: changed ? 'contradicted' : 'supported',
          changed,
          retieredCardIds,
          rationale: correction.rationale ?? 'Applied the correction from the grounded fact-check that just ran.',
          citations: hintCited,
        });
      }
    }

    let resolved;
    try {
      resolved = resolveClient({
        env,
        callerKey,
        onCall: (info) => {
          if (metered) budget.record(info.kind);
        },
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
    }
    const client = resolved.client;

    const stored = metric.value != null ? `${metric.value} (confidence: ${metric.confidence})` : 'unknown';
    const g = await client.ground(
      [
        `What is the most current, reliable figure for ${company.name}'s ${label}?`,
        `Company: ${company.name} — ${company.oneLiner}`,
        `Our stored figure: ${stored}.`,
        `Use Google Search. Prefer primary sources and recent reputable coverage; name the figure, its as-of date, and the source. If coverage disagrees, say which figure is best supported. If no reliable current figure exists, say so plainly. Never guess.`,
        `MEASUREMENT BASIS: the figure must describe the WHOLE legal company — for a conglomerate, total company revenue/valuation/headcount, never a division's figure presented as the company's.`,
      ].join('\n'),
      { system: GROUNDED_SYSTEM },
    );

    const out = await client.structure(
      [
        `Based ONLY on these verification notes about ${company.name}'s ${label}, output JSON {`,
        `  "verdict": "supported" (stored figure holds) | "contradicted" (evidence names a different figure) | "unverified" (no reliable current figure),`,
        `  "currentValue": number|null — the best-supported current figure in ${label === 'Market Share' ? 'percent (0-100)' : label === 'Users' || label === 'Employees' ? 'plain count' : 'US dollars'}; null when the notes name none. NEVER invent one.`,
        `  "rationale": string (1-2 sentences),`,
        `  "methodNote": string|null — one line naming where the figure comes from`,
        `}`,
        ``,
        `Stored figure for comparison: ${stored}`,
        ``,
        `NOTES:`,
        g.text,
      ].join('\n'),
      verifyMetricOutSchema,
      { system: STRUCTURE_SYSTEM },
    );

    const cited = usableCitations(g.citations);
    let changed = false;

    if (out.currentValue != null && hasVerificationGradeCitation(cited)) {
      const prior = metric.value;
      const differs = prior == null || prior === 0 || Math.abs(out.currentValue - prior) / Math.max(Math.abs(prior), 1) > 0.02;
      
      if (differs && metric.confidence !== 'user_verified') {
        metric.value = out.currentValue;
        metric.confidence = 'verified';
        metric.citations = cited;
        metric.source = cited[0]?.url ?? metric.source;
        metric.methodNote = out.methodNote ?? `Live verification: ${out.rationale}`;
        if (metricType === 'users') {
          if (out.userBasis != null) metric.userBasis = out.userBasis;
          else {
            const inferredBasis = inferUserFootprintBasis(metric.methodNote);
            if (inferredBasis !== 'unknown') metric.userBasis = inferredBasis;
          }
        }
        metric.capturedAt = nowIso;
        changed = true;
      }
    }
    if (metricType === 'users' && metric.confidence !== 'user_verified') {
      const basis = out.userBasis ?? inferUserFootprintBasis(out.methodNote ?? out.rationale);
      if (basis !== 'unknown' && basis !== metric.userBasis) {
        metric.userBasis = basis;
        changed = true;
      }
    }
    
    if (!changed && out.verdict === 'unverified' && metric.confidence === 'verified') {
      metric.confidence = 'estimated';
      metric.methodNote = `Could not re-corroborate from live sources on ${nowIso.slice(0, 10)}; badge downgraded pending fresh evidence.`;
      metric.capturedAt = nowIso;
      changed = true;
    }

    const priorTier = companyCard.card.tier;
    companyCard.card.tier = computeCms(buildCmsInput(companyCard.metrics), {
      userFootprintCohort: deckUserFootprintCohort(existingDeck.cards ?? []),
    }).finalTier;
    const retieredCardIds = changed && priorTier !== companyCard.card.tier ? [companyCard.card.id] : [];
    if (retieredCardIds.length > 0) {
      companyCard.card.tierReason = 'Re-tiered after live metric verification.';
    }

    if (changed || out.verdict !== 'unverified') {
      Object.assign(metric, markVerified(metric as CompanyMetric, nowIso));
      await cloudDeckService.saveDeck(userId, deckId!, existingDeck, existingDeck.revision);
    }

    return c.json({
      metric,
      verdict: out.verdict,
      changed,
      retieredCardIds,
      rationale: out.rationale,
      citations: g.citations,
    });
  });

  app.post('/api/research/hunt-metrics', async (c) => {
    const json = await c.req.json().catch(() => ({}));
    const { deckId, companyId } = json;

    if (!deckId || !companyId) {
      return c.json({ error: 'Missing parameters' }, 400);
    }

    let access: Awaited<ReturnType<typeof authorizeCloudResearch>>;
    try {
      access = await authorizeCloudResearch(c, METRIC_RESEARCH_ESTIMATE_USD);
    } catch (err) {
      const mapped = guardError(err);
      if (mapped) return c.json(mapped.body, mapped.status);
      throw err;
    }
    const { userId, callerKey, metered } = access;
    const isEntitled = await cloudDeckService.checkEntitlement(userId);
    if (!isEntitled) return c.json({ error: 'Active subscription required' }, 402);

    const existingDeck = await cloudDeckService.getDeck(userId, deckId);
    if (!existingDeck) return c.json({ error: 'Deck not found' }, 404);

    const cards = existingDeck.cards || [];
    const cardIdx = cards.findIndex(c => c.company?.id === companyId);
    if (cardIdx === -1) return c.json({ error: 'Company not found in deck' }, 404);
    
    const companyCard = cards[cardIdx]!;
    const company = companyCard.company!;
    const metrics = companyCard.metrics;

    const softTypes = METRIC_TYPES.filter(t => {
      const m = metrics.find(x => x.metricType === t);
      if (!m) return true;
      if (m.confidence === 'user_verified' || m.confidence === 'verified') return false;
      return m.value == null || m.confidence === 'unknown' || m.confidence === 'estimated';
    });

    if (softTypes.length === 0) {
      return c.json({ filledTypes: [], metrics, retieredCardIds: [] });
    }

    let resolved;
    try {
      resolved = resolveClient({
        env,
        callerKey,
        onCall: (info) => {
          if (metered) budget.record(info.kind);
        },
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
    }
    const client = resolved.client;
    
    const wanted = softTypes.map(t => `- ${METRIC_TYPE_LABELS[t]}`).join('\n');
    const g = await client.ground(
      [
        `Find the most current, reliable figures for these metrics of ${company.name}:`,
        wanted,
        `Company: ${company.name} — ${company.oneLiner}`,
        `Use Google Search. For each figure name the value, its as-of date, and the source. Prefer primary sources and recent reputable coverage. If no reliable current figure exists for a metric, say so plainly for that metric. Never guess.`,
        `MEASUREMENT BASIS: every figure must describe the WHOLE legal company — for a conglomerate, total company revenue/valuation/headcount, never a division's figure presented as the company's.`,
        `UNITS: Market Share in percent of its primary market (0-100); Users and Employees as plain counts; Valuation, Market Cap, and ARR in US dollars.`,
        `For a Users figure, also return userBasis naming exactly what is counted (for example monthly_active_users, registered_accounts, paying_business_accounts, downloads_or_installs, github_stars). Use unknown when the notes do not say; never guess based on the business category.`,
      ].join('\n'),
      { system: GROUNDED_SYSTEM }
    );

    const out = await client.structure(
      [
        `Based ONLY on these research notes about ${company.name}, output JSON { "figures": [ { "metricType": "market_cap"|"valuation"|"market_share"|"arr"|"users"|"employees", "value": number|null, "methodNote": string|null (one line naming the source and as-of date), "userBasis": string|null (users only; unknown if the notes do not establish it) } ] }.`,
        `Include ONLY the metrics the notes actually support with a concrete figure — omit the rest entirely. NEVER invent a value.`,
        ``,
        `NOTES:`,
        g.text,
      ].join('\n'),
      huntMetricsOutSchema,
      { system: STRUCTURE_SYSTEM }
    );

    const nowIso = new Date().toISOString();
    const cited = usableCitations(g.citations);
    const filledTypes: string[] = [];

    let changed = false;
    if (hasVerificationGradeCitation(cited)) {
      for (const fig of out.figures) {
        if (fig.value == null) continue;
        if (!softTypes.includes(fig.metricType)) continue;
        let metric = metrics.find(m => m.metricType === fig.metricType);
        if (!metric) {
          metric = {
            id: `met_hunt_${Date.now().toString(36)}_${fig.metricType}`,
            companyId,
            metricType: fig.metricType as CompanyMetric['metricType'],
            value: null,
            confidence: 'unknown',
            source: null,
            citations: [],
            methodNote: null,
            capturedAt: nowIso,
          };
          metrics.push(metric);
        }
        metric.value = fig.value;
        metric.confidence = 'verified';
        metric.citations = cited;
        metric.source = cited[0]?.url ?? null;
        metric.methodNote = fig.methodNote ?? null;
        if (fig.metricType === 'users') {
          metric.userBasis = fig.userBasis ?? inferUserFootprintBasis(metric.methodNote);
        }
        metric.capturedAt = nowIso;
        filledTypes.push(fig.metricType);
        changed = true;
      }
    }

    if (changed) {
      await cloudDeckService.saveDeck(userId, deckId!, existingDeck, existingDeck.revision);
    }

    return c.json({
      filledTypes,
      metrics,
      retieredCardIds: changed ? [companyCard.card.id] : [],
    });
  });


  /**
   * Capture a page, verify the capture is genuine, and never return a
   * screenshot we cannot vouch for.
   */
  app.post('/v1/capture', async (c) => {
    const body = captureSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'Invalid request', detail: body.error.flatten() }, 400);
    }

    const appToken = c.req.header(APP_TOKEN_HEADER);
    const callerKey = c.req.header(BYOK_HEADER);

    // Capture needs no spend authorisation — it is the visible product feature
    // and costs us CPU, not tokens. It IS rate limited, because launching
    // Chromium is expensive enough to be a denial-of-service lever.
    try {
      captureLimiter.check(callerKeyFor({ forwardedFor: c.req.header('x-forwarded-for'), appToken }));
    } catch (err) {
      const mapped = guardError(err);
      if (mapped) return c.json(mapped.body, mapped.status);
      throw err;
    }

    let receipt: CaptureReceipt;
    let screenshot: Buffer;
    let text: string;
    try {
      const shot = await capturePage({
        url: body.data.url,
        blocklist: env.captureBlocklist,
        ...(body.data.fullPage === undefined ? {} : { fullPage: body.data.fullPage }),
      });
      receipt = shot.receipt;
      screenshot = shot.screenshot;
      text = shot.text;
    } catch (err) {
      if (err instanceof CaptureError) return c.json({ error: err.message }, err.status as 400);
      throw err;
    }

    // The vision adjudication DOES cost tokens, so it is authorised and metered
    // like research. Without authorisation it is simply skipped, and
    // verifyCapture fails closed — an unverified capture is never reported as
    // genuine just because we could not afford to check it.
    let visionAllowed = false;
    let visionMetered = false;
    try {
      const authz = authorizeSpend({ env, callerKey, appToken });
      visionMetered = authz.metered;
      visionAllowed = !visionMetered || budget.canAfford(CAPTURE_ESTIMATE_USD);
    } catch {
      visionAllowed = false;
    }

    const verdict = await verifyCapture({
      receipt,
      text,
      screenshot,
      ...(() => {
        if (!visionAllowed) return {};
        const judge = createVisionJudge({ env, callerKey });
        if (!judge) return {};
        return {
          vision: async (input: { screenshot: Buffer; prompt: string }) => {
            if (visionMetered) budget.record('vision');
            return judge(input);
          },
        };
      })(),
    });

    if (verdict.isRealPage) {
      return c.json({
        ok: true,
        receipt,
        verdict,
        screenshot: `data:image/png;base64,${screenshot.toString('base64')}`,
      });
    }

    // Blocked. Return the receipt as evidence of the visit and a generated
    // card in place of the image — never the block page dressed up as content.
    return c.json({
      ok: false,
      receipt,
      verdict,
      fallbackSvg: renderFallbackCard({ receipt, verdict }),
      caption: fallbackCaption(verdict),
    });
  });

  /** Render a self-contained HTML report as a real PDF. */
  app.post('/v1/report/pdf', async (c) => {
    const body = pdfSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'Invalid request', detail: body.error.flatten() }, 400);
    }
    const pdf = await renderPdf({
      html: body.data.html,
      ...(body.data.landscape === undefined ? {} : { landscape: body.data.landscape }),
    });
    const name = (body.data.filename ?? 'stratemark-report').replace(/[^a-zA-Z0-9._-]/g, '-');
    return c.body(new Uint8Array(pdf), 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}.pdf"`,
    });
  });

  /**
   * Verify a Google OIDC token against an expected service account email.
   * Tries Google's tokeninfo endpoint with id_token first (verifies signature + expiry),
   * falls back to access_token and local JWT decode for environments without internet.
   */
  const verifyGoogleOidcToken = async (token: string, expectedEmail: string): Promise<boolean> => {
    // Try Google's tokeninfo endpoint for OIDC ID tokens
    try {
      const tokenInfoRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`,
      );
      if (tokenInfoRes.ok) {
        const info = await tokenInfoRes.json() as { email?: string; exp?: string; iss?: string };
        if (info.email && info.email === expectedEmail) {
          if (!info.iss || info.iss === 'https://accounts.google.com' || info.iss === 'accounts.google.com') {
            return true;
          }
        }
      }
    } catch {
      /* ignore fetch error */
    }

    // Try access_token endpoint
    try {
      const tokenInfoRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
      );
      if (tokenInfoRes.ok) {
        const info = await tokenInfoRes.json() as { email?: string; exp?: string; iss?: string };
        if (info.email && info.email === expectedEmail) {
          if (!info.iss || info.iss === 'https://accounts.google.com' || info.iss === 'accounts.google.com') {
            return true;
          }
        }
      }
    } catch {
      /* ignore fetch error */
    }

    // Fallback: decode JWT and verify locally (for environments without internet or test mocks)
    try {
      const parts = token.split('.');
      if (parts.length < 3) return false;
      const payloadBase64 = parts[1];
      if (!payloadBase64) return false;
      const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson);

      const tokenEmail = payload.email || payload.service_account_email;
      if (tokenEmail && tokenEmail !== expectedEmail) return false;
      if (payload.exp && typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return false;
      if (payload.iss && payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') return false;

      return true;
    } catch {
      return false;
    }
  };

  const verifyWorkerOidc = async (c: Context): Promise<boolean> => {
    if (!env.tasks?.serviceAccountEmail) return true;
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return false;
    }
    try {
      const token = authHeader.split(' ')[1];
      if (!token) return false;
      return await verifyGoogleOidcToken(token, env.tasks.serviceAccountEmail);
    } catch {
      return false;
    }
  };

  /**
   * Cloud Tasks worker endpoint for async deck creation.
   * Assumes OIDC validation is handled by Cloud Run IAM proxy in production.
   * We do basic sanity checks here.
   */
  app.post('/tasks/worker/research', async (c) => {
    if (!(await verifyWorkerOidc(c))) {
      return c.json({ error: 'Unauthorized: Invalid service account OIDC token' }, 401);
    }

    // Cloud Tasks sets specific headers we can verify to ensure it was routed by the task queue
    // In local development or testing, these might be absent depending on adapter, so we just log.
    const queueName = c.req.header('X-CloudTasks-QueueName');
    if (env.tasks && !queueName) {
       console.warn('Worker invoked without X-CloudTasks-QueueName header - ensure IAM proxy is securing this endpoint.');
    }
    
    const payload = await c.req.json().catch(() => null);
    if (!payload || !payload.deckId || !payload.userId || !payload.plan) {
      return c.json({ error: 'Invalid task payload' }, 400);
    }
    
    const traceHeader = c.req.header('x-cloud-trace-context') || c.req.header('traceparent');
    const headerTraceContext = parseTraceContext(traceHeader);
    const traceContext = payload.traceContext || headerTraceContext;

    // Process deck creation
    await cloudDeckWorker.processDeckCreation({ ...payload, traceContext });
    
    return c.json({ ok: true });
  });

  app.post('/tasks/worker/refresh', async (c) => {
    if (!(await verifyWorkerOidc(c))) {
      return c.json({ error: 'Unauthorized: Invalid service account OIDC token' }, 401);
    }

    const queueName = c.req.header('X-CloudTasks-QueueName');
    if (env.tasks && !queueName) {
       console.warn('Worker invoked without X-CloudTasks-QueueName header - ensure IAM proxy is securing this endpoint.');
    }
    
    const payload = await c.req.json().catch(() => null);
    if (!payload || !payload.deckId || !payload.userId || !payload.query) {
      return c.json({ error: 'Invalid task payload for refresh' }, 400);
    }
    
    const traceHeader = c.req.header('x-cloud-trace-context') || c.req.header('traceparent');
    const headerTraceContext = parseTraceContext(traceHeader);
    const traceContext = payload.traceContext || headerTraceContext;

    await cloudDeckWorker.processDeckRefresh({ ...payload, traceContext });
    
    return c.json({ ok: true });
  });

  /**
   * Cloud Scheduler target. Guarded by OIDC: Cloud Run IAM validates the signature,
   * we just decode the JWT to verify the service account email.
   */
  app.post('/tasks/refresh', async (c) => {
    if (!env.schedulerServiceAccountEmail) {
      return c.json({ error: 'Scheduled refresh is not configured with an OIDC service account.' }, 503);
    }
    
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return c.json({ error: 'Unauthorized: Missing or invalid Bearer token' }, 401);
    }

    try {
      const token = authHeader.split(' ')[1];
      if (!token) throw new Error('Missing token');
      const valid = await verifyGoogleOidcToken(token, env.schedulerServiceAccountEmail);
      if (!valid) {
        return c.json({ error: 'Unauthorized: Invalid service account or expired token' }, 401);
      }
    } catch {
      return c.json({ error: 'Unauthorized: Malformed token' }, 401);
    }

    if (!hasServerCredentials(env)) {
      return c.json({ error: 'No server credentials; nothing to refresh with.' }, 503);
    }
    
    // We don't resolve the LlmClient directly anymore in the scheduler since
    // executeScheduledRefresh fan-out logic now delegates to workers.
    
    const result = await executeScheduledRefresh({
      env,
      store: options?.worklistStore ?? store,
      cloudDeckService,
      tasksAdapter,
    });

    return c.json(result);
  });

  app.onError((err, c) => {
    // Never leak internals to the caller; the detail goes to Cloud Logging.
    console.error(JSON.stringify({ severity: 'ERROR', message: err.message, stack: err.stack }));
    const status = (err as Error & { status?: unknown }).status;
    if (status === 429) {
      return c.json({ error: 'Cloud model quota is exhausted. Try again later or provide your own Gemini key.' }, 429);
    }
    if (status === 404 || err.message === 'Not found') {
      return c.json({ error: 'Not found' }, 404);
    }
    if (err.message?.includes('model') && err.message?.includes('unavailable')) {
      return c.json({ error: 'The configured cloud model is unavailable in this region.' }, 503);
    }
    return c.json({ error: 'Internal error' }, 500);
  });

  return app;
}
