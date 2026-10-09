/**
 * Concrete Gemini client (raw fetch, no SDK — runs in browser + Node + Electron).
 *
 * Verified against the current API (2026-07): v1beta generateContent, grounded
 * via tools:[{google_search:{}}], citations in candidates[0].groundingMetadata.
 * Grounding + JSON-schema can't be combined in one call, so `ground` and
 * `structure` are two separate calls (the pipeline threads citations between
 * them). Retries 429/5xx with backoff. Free-tier default models below.
 */
import type { ZodType, ZodTypeDef } from 'zod';
import type { CallMetrics, CallMetricsAggregate, Citation, LlmClient } from './types';
export type { CallMetrics, CallMetricsAggregate };
import { AbortError, throwIfAborted, createRateLimiter, extractJson, withRetry, type RetryableError } from './util';
import { extractProviderGrounding } from './grounding-support';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const CALL_DEADLINE_MS = 120_000;

// A search-grounded model LINE can go bad for minutes at a time: observed
// 2026-10-08, `gemini-3.7-flash` + google_search answered a metrics hunt in
// 235s while `gemini-2.5-flash` answered the same question in 2.7s — every
// call pinned to the sick line burned the whole 120s deadline and the run
// degraded. Ground calls therefore walk a fallback ladder of model lines,
// remember which line answered, prefer the healthy line while the primary is
// sick, and re-probe the primary after a cooldown.
const GROUND_FALLBACK_MODELS = ['gemini-3.7-flash', 'gemini-2.5-flash'];
const SICK_PRIMARY_COOLDOWN_MS = 10 * 60_000;
/** The primary line's own retry budget; the rest of the deadline is left for
 * a fallback line to actually answer in. */
const PRIMARY_GROUND_ATTEMPT_BUDGET_MS = 45_000;
const MIN_GROUND_ATTEMPT_BUDGET_MS = 8_000;

/** A failure the fallback ladder can fix by asking a different model line:
 * timeouts, rate limits, and server errors. Content blocks, invalid JSON and
 * network-down are NOT line failures — another line cannot help those. */
function isLineFailure(error: unknown): boolean {
  const status = (error as RetryableError | null)?.status;
  if (typeof status === 'number' && (status === 429 || status >= 500)) return true;
  return error instanceof Error && error.name === 'TimeoutError';
}

// Only messages constructed here may bypass sanitization. Never copy a remote
// error/body: it can contain credentials, prompts or private research content.
class SafeGeminiError extends Error {}

/** One deadline for pacing, requests, body reads and all retries/JSON repairs. */
async function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, external?: AbortSignal): Promise<T> {
  throwIfAborted(external);
  const controller = new AbortController();
  let cancellation: Error | undefined;
  let rejectCancellation!: (error: Error) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const cancel = (error: Error) => {
    if (cancellation) return;
    cancellation = error;
    rejectCancellation(error);
    controller.abort();
  };
  const onAbort = () => cancel(new AbortError());
  const timer = setTimeout(() => {
    const error = new Error('Gemini request timed out after 120 seconds.');
    error.name = 'TimeoutError';
    cancel(error);
  }, CALL_DEADLINE_MS);
  external?.addEventListener('abort', onAbort, { once: true });
  try {
    // Race as well as abort: injected transports/body readers may ignore signals.
    return await Promise.race([work(controller.signal), cancelled]);
  } catch (error) {
    if (cancellation) throw cancellation;
    // Our own attempt-timeout error is constructed here (safe message) and its
    // name is the line-health signal — the sanitize wrap must not strip it.
    if (error instanceof Error && error.name === 'TimeoutError') throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new AbortError();
    if (error instanceof SafeGeminiError) throw error;
    // Provider/transport errors may contain credentials, prompts or raw bodies.
    const status = (error as RetryableError | null)?.status;
    const safeStatus = typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
      ? status : undefined;
    const wrapped = new Error(safeStatus !== undefined
      ? `Gemini ${safeStatus}: request failed.` : error instanceof TypeError
        ? 'Could not reach Gemini. Check your connection and try again.' : 'Gemini request failed.') as RetryableError;
    if (safeStatus !== undefined) wrapped.status = safeStatus;
    throw wrapped;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onAbort);
  }
}

export interface GeminiClientConfig {
  apiKey: string;
  /** Grounded model — must support free Google Search grounding. */
  model?: string;
  /** Structuring model (non-grounded JSON). */
  structureModel?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /**
   * Proactive pacing, per model, to stay under the free tier's per-MINUTE cap.
   * Measured 2026-07: 15 RPM on the flash line, 30 on flash-lite, 1,500 RPD.
   * Defaults sit at those caps for maximum throughput. Set 0 to disable (tests).
   */
  groundedRpm?: number;
  structureRpm?: number;
  /** Per-attempt timeout and retry budget for the primary grounded line while
   * the fallback ladder is active. Defaults: 45s each — the rest of the 120s
   * deadline stays reserved for a healthy fallback line to answer in. */
  groundedAttemptTimeoutMs?: number;
  groundedAttemptBudgetMs?: number;
  /** Observability hook — fires once per outbound request (powers the usage meter). */
  onCall?: (info: { model: string; kind: 'ground' | 'structure' }) => void;
  /** Per-call latency decomposition (queue wait, dispatch, retry waits).
   * Fires once per settled call; a throwing consumer never breaks the call. */
  onCallMetrics?: (metrics: CallMetrics) => void;
}





/** Default RPM pacing: disabled for the hackathon (0). */
export const DEFAULT_GROUNDED_RPM = 0;
export const DEFAULT_STRUCTURE_RPM = 0;

// Current Gemini API defaults. Vertex AI has a separate model line below because
// the newest Developer API IDs are not necessarily published in every Vertex
// region.
// The -latest alias tracks Google's current recommended GA flash line, so a
// single sick pinned version (2026-10-08: gemini-3.7-flash + search at 235s)
// stops taking the whole product down with it. The pinned line and the
// older-stable line sit in the fallback ladder below.
export const DEFAULT_GROUNDED_MODEL = 'gemini-flash-latest';
export const DEFAULT_REASONING_MODEL = 'gemini-3.1-pro-preview';
export const DEFAULT_STRUCTURE_MODEL = 'gemini-3.5-flash-lite';

// Vertex AI model IDs verified in us-central1.
export const DEFAULT_VERTEX_GROUNDED_MODEL = 'gemini-2.5-flash';
export const DEFAULT_VERTEX_STRUCTURE_MODEL = 'gemini-2.5-flash-lite';

interface GeminiPart {
  text?: string;
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  groundingMetadata?: {
    groundingChunks?: { web?: { uri?: string; title?: string } }[];
    webSearchQueries?: string[];
    groundingSupports?: unknown[];
  };
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
}

function extractText(data: GeminiResponse): string {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => p.text ?? '')
    .join('');
}

function extractCitations(data: GeminiResponse): Citation[] {
  const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const cites: Citation[] = [];
  for (const c of chunks) {
    const uri = c.web?.uri;
    if (uri) cites.push({ title: c.web?.title ?? uri, url: uri });
  }
  return cites;
}

export function createGeminiClient(config: GeminiClientConfig): LlmClient {
  const groundedModel = config.model ?? DEFAULT_GROUNDED_MODEL;
  const structureModel = config.structureModel ?? DEFAULT_STRUCTURE_MODEL;
  const doFetch = config.fetchImpl ?? fetch;
  // Defence in depth: the key rides in an HTTP header, and headers must be
  // ISO-8859-1. Pasted keys often carry invisible characters (zero-width space,
  // non-breaking space, trailing newline) which make fetch throw before the
  // request is even sent. Callers sanitize too; never trust that they did.
  const apiKey = config.apiKey.replace(/[^\x20-\x7E]/g, '').trim();

  // One bucket per model — grounded calls are the scarce resource, and when
  // grounding and structuring share one model, they share that model's real
  // per-minute cap instead of each keeping a bucket of its own.
  const groundedRpm = config.groundedRpm ?? DEFAULT_GROUNDED_RPM;
  const structureRpm = config.structureRpm ?? DEFAULT_STRUCTURE_RPM;
  const limiters = new Map<string, ReturnType<typeof createRateLimiter> | null>();
  const limiterFor = (model: string) => {
    if (limiters.has(model)) return limiters.get(model)!;
    const rpms = [model === groundedModel ? groundedRpm : 0, model === structureModel ? structureRpm : 0]
      .filter((rpm) => rpm > 0);
    const limiter = rpms.length ? createRateLimiter(Math.min(...rpms)) : null;
    limiters.set(model, limiter);
    return limiter;
  };

  async function call(
    model: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    kind: 'ground' | 'structure' = 'ground',
    budget?: { retryBudgetMs?: number; attemptTimeoutMs?: number },
  ): Promise<GeminiResponse> {
    const limiter = limiterFor(model);
    const callStartedAt = Date.now();
    let attempts = 0;
    let queuedMs = 0;
    let retryWaitMs = 0;
    const data = await withRetry(
      async () => {
        throwIfAborted(signal);
        attempts += 1;
        // Every dispatched attempt — retries included — spends a slot, so a
        // 429 storm cannot silently exceed the key's real per-minute cap.
        const acquireStartedAt = Date.now();
        await limiter?.acquire(signal);
        queuedMs += Date.now() - acquireStartedAt;
        config.onCall?.({ model, kind });
        // A hung fetch never rejects on its own. The attempt signal cancels a
        // real request, and the race turns a silently-stuck model line into a
        // TimeoutError even when the transport ignores signals (injected test
        // transports); a late rejection from the losing side is ignored.
        const attemptMs = budget?.attemptTimeoutMs;
        const attemptSignal = attemptMs !== undefined && attemptMs > 0 &&
            typeof AbortSignal.timeout === 'function' && typeof AbortSignal.any === 'function'
          ? (signal ? AbortSignal.any([signal, AbortSignal.timeout(attemptMs)])
            : AbortSignal.timeout(attemptMs))
          : signal;
        const attempt = doFetch(`${BASE}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: attemptSignal,
        });
        attempt.catch(() => {});
        let attemptTimer: ReturnType<typeof setTimeout> | undefined;
        const stopAttemptTimer = () => { if (attemptTimer !== undefined) { clearTimeout(attemptTimer); attemptTimer = undefined; } };
        const onAbortStopTimer = () => stopAttemptTimer();
        signal?.addEventListener('abort', onAbortStopTimer, { once: true });
        let res: Response;
        try {
          res = await (attemptMs !== undefined && attemptMs > 0
            ? Promise.race([
              attempt,
              new Promise<never>((_, reject) => {
                attemptTimer = setTimeout(() => {
                  const timeout = new Error('Gemini model line did not answer in time.') as RetryableError;
                  timeout.name = 'TimeoutError';
                  reject(timeout);
                }, attemptMs);
              }),
            ])
            : attempt);
        } finally {
          stopAttemptTimer();
          signal?.removeEventListener('abort', onAbortStopTimer);
        }
        throwIfAborted(signal);
        if (!res.ok) {
          // Drain the body inside the same deadline, but never echo its content.
          await res.text().catch(() => undefined);
          throwIfAborted(signal);
          const err = new Error(
            `Gemini ${res.status}: request failed.`,
          ) as RetryableError & { retryAfterMs?: number };
          err.status = res.status;
          const retryAfter = res.headers.get('retry-after');
          if (retryAfter) err.retryAfterMs = Number(retryAfter) * 1000;
          throw err;
        }
        const parsed = await res.json() as GeminiResponse;
        throwIfAborted(signal);
        return parsed;
      },
      {
        signal,
        maxTotalMs: budget?.retryBudgetMs,
        // Retry sleeps (Retry-After / backoff) are the pacing pain the meter
        // exists to expose — hand each wait to the metrics consumer.
        onRetryWait: (waitMs) => { retryWaitMs += waitMs; },
      },
    );
    const totalMs = Date.now() - callStartedAt;
    aggregate.calls += 1;
    aggregate.retries += Math.max(0, attempts - 1);
    aggregate.rateLimitedMs += retryWaitMs;
    try {
      config.onCallMetrics?.({
        model, kind, attempts, retries: Math.max(0, attempts - 1),
        // requestMs derives: everything that is neither limiter wait nor
        // retry backoff is dispatch + body read + JSON parse.
        queuedMs, requestMs: Math.max(0, totalMs - queuedMs - retryWaitMs),
        retryWaitMs, totalMs,
      });
    } catch { /* a metrics consumer must never break the call */ }
    return data;
  }

  /** Epoch ms until which the primary grounded line is considered sick; 0 = healthy. */
  let primarySickUntil = 0;
  const aggregate: CallMetricsAggregate = { calls: 0, retries: 0, rateLimitedMs: 0, fallbacks: 0 };

  return {
    metrics: () => ({ ...aggregate }),
    async ground(prompt, opts) {
      return withDeadline(async signal => {
        const body: Record<string, unknown> = {
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.2 },
        };
        if (opts?.system) body.systemInstruction = { parts: [{ text: opts.system }] };
        const parse = (data: GeminiResponse) => {
          if (data.promptFeedback?.blockReason) {
            throw new SafeGeminiError('Gemini blocked this research request. Try a narrower research question.');
          }
          return {
            text: extractText(data).trim(),
            citations: extractCitations(data),
            queries: data.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [],
            grounding: extractProviderGrounding(extractText(data), data.candidates?.[0]?.groundingMetadata),
          };
        };
        // While the primary is sick, the healthy line answers first and the
        // primary moves to the back — one re-probe per cooldown window.
        const order = Date.now() < primarySickUntil
          ? [...GROUND_FALLBACK_MODELS, groundedModel]
          : [groundedModel, ...GROUND_FALLBACK_MODELS];
        const startedAt = Date.now();
        const primaryBudget = config.groundedAttemptBudgetMs ?? PRIMARY_GROUND_ATTEMPT_BUDGET_MS;
        const primaryAttemptTimeout = config.groundedAttemptTimeoutMs ?? PRIMARY_GROUND_ATTEMPT_BUDGET_MS;
        let lastError: unknown;
        for (const model of order) {
          const remaining = CALL_DEADLINE_MS - (Date.now() - startedAt);
          if (remaining < MIN_GROUND_ATTEMPT_BUDGET_MS) break;
          const isPrimary = model === groundedModel;
          try {
            const data = await call(model, body, signal, 'ground', {
              retryBudgetMs: isPrimary ? Math.min(remaining - 1000, primaryBudget) : remaining - 1000,
              attemptTimeoutMs: Math.min(remaining - 1000, isPrimary ? primaryAttemptTimeout : remaining - 1000),
            });
            if (isPrimary) primarySickUntil = 0;
            else { primarySickUntil = Date.now() + SICK_PRIMARY_COOLDOWN_MS; aggregate.fallbacks += 1; }
            return parse(data);
          } catch (err) {
            lastError = err;
            // A blocked prompt or a dead network is nobody else's to fix.
            if (signal?.aborted || !isLineFailure(err)) throw err;
            if (isPrimary) primarySickUntil = Date.now() + SICK_PRIMARY_COOLDOWN_MS;
          }
        }
        throw lastError;
      }, opts?.signal);
    },

    async structure<T>(prompt: string, schema: ZodType<T, ZodTypeDef, unknown>, opts?: { system?: string; signal?: AbortSignal }): Promise<T> {
      return withDeadline(async signal => {
        // No `responseSchema` here, deliberately (issue #48). The SDK client
        // (`genai.ts`) sends one, because it can derive it without cost. Doing the
        // same here would mean pulling the schema converter — and with it the
        // Node-oriented SDK it imports `Type` from — into the browser/Electron
        // bundle, which is the one thing this client exists to avoid.
        //
        // The strict Zod contract below is still enforced on the way out, so the
        // BYOK path cannot ACCEPT a malformed or forged value; it just isn't
        // constrained at generation time, so a non-conforming model costs a
        // reparse retry instead of being prevented up front.
        const body: Record<string, unknown> = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        };
        if (opts?.system) body.systemInstruction = { parts: [{ text: opts.system }] };
        // One reparse retry: JSON-mode is reliable but not infallible.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const data = await call(structureModel, body, signal, 'structure');
          try {
            return schema.parse(extractJson(extractText(data)));
          } catch (err) {
            // A blind identical retry often repeats the same missing field. Give
            // the model the validation failure, not invented fallback values.
            if (attempt === 0) body.contents = [{ parts: [{ text: [
              prompt,
              'Your previous JSON failed schema validation. Return a corrected JSON object, not an explanation.',
              'Do not invent research facts to satisfy the schema. Use null only where the contract allows it.',
              `Validation errors: ${err instanceof Error ? err.message.slice(0, 4000) : String(err).slice(0, 4000)}`,
            ].join('\n\n') }] }];
          }
        }
        throw new SafeGeminiError('Gemini returned invalid research data after two attempts. No guessed data was saved.');
      }, opts?.signal);
    },
  };
}
