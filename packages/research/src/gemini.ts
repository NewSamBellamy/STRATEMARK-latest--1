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
import type { Citation, LlmClient } from './types';
import { AbortError, throwIfAborted, createRateLimiter, extractJson, withRetry, type RetryableError } from './util';
import { extractProviderGrounding } from './grounding-support';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const CALL_DEADLINE_MS = 120_000;

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
  /** Observability hook — fires once per outbound request (powers the usage meter). */
  onCall?: (info: { model: string; kind: 'ground' | 'structure' }) => void;
}

/** Default RPM pacing: disabled for the hackathon (0). */
export const DEFAULT_GROUNDED_RPM = 0;
export const DEFAULT_STRUCTURE_RPM = 0;

// Current Gemini API defaults. Vertex AI has a separate model line below because
// the newest Developer API IDs are not necessarily published in every Vertex
// region.
export const DEFAULT_GROUNDED_MODEL = 'gemini-3.7-flash';
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

  // One bucket per model line — grounded calls are the scarce resource.
  const groundedRpm = config.groundedRpm ?? DEFAULT_GROUNDED_RPM;
  const structureRpm = config.structureRpm ?? DEFAULT_STRUCTURE_RPM;
  const groundLimiter = groundedRpm > 0 ? createRateLimiter(groundedRpm) : null;
  const structureLimiter = structureRpm > 0 ? createRateLimiter(structureRpm) : null;

  async function call(
    model: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    kind: 'ground' | 'structure' = 'ground',
  ): Promise<GeminiResponse> {
    // Pace before sending; retry is only the safety net.
    await (kind === 'ground' ? groundLimiter : structureLimiter)?.acquire(signal);
    throwIfAborted(signal);
    return withRetry(
      async () => {
        throwIfAborted(signal);
        config.onCall?.({ model, kind });
        const res = await doFetch(`${BASE}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });
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
        const data = await res.json() as GeminiResponse;
        throwIfAborted(signal);
        return data;
      },
      { signal },
    );
  }

  return {
    async ground(prompt, opts) {
      return withDeadline(async signal => {
        const body: Record<string, unknown> = {
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.2 },
        };
        if (opts?.system) body.systemInstruction = { parts: [{ text: opts.system }] };
        const data = await call(groundedModel, body, signal, 'ground');
        if (data.promptFeedback?.blockReason) {
          throw new SafeGeminiError('Gemini blocked this research request. Try a narrower research question.');
        }
        return {
          text: extractText(data).trim(),
          citations: extractCitations(data),
          queries: data.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [],
          grounding: extractProviderGrounding(extractText(data), data.candidates?.[0]?.groundingMetadata),
        };
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
