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
import type {
  CallOptions,
  Citation,
  IntelligenceModel,
  LlmClient,
  NativeResearchProvider,
} from './types';
import { createRateLimiter, extractJson, withRetry, type RetryableError } from './util';
import { inputTokenUpperBound } from './usage-meter';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

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
  };
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

const MAX_OUTPUT_TOKENS_PER_CALL = 8_192;

function extractText(data: GeminiResponse): string {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => p.text ?? '')
    .join('')
    .trim();
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
    opts?: CallOptions,
    kind: 'ground' | 'structure' = 'ground',
  ): Promise<GeminiResponse> {
    // Pace before sending; retry is only the safety net.
    await (kind === 'ground' ? groundLimiter : structureLimiter)?.acquire(opts?.signal);
    config.onCall?.({ model, kind });
    return withRetry(
      async () => {
        const attempt = opts?.usageMeter?.beginAttempt({
          kind: 'model',
          estimatedInputTokens: inputTokenUpperBound(body),
          maxOutputTokens: MAX_OUTPUT_TOKENS_PER_CALL,
        });
        const requestBody = attempt
          ? {
              ...body,
              generationConfig: {
                ...((body.generationConfig as Record<string, unknown> | undefined) ?? {}),
                maxOutputTokens: attempt.maxOutputTokens,
              },
            }
          : body;
        const res = await doFetch(`${BASE}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: opts?.signal,
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          const err = new Error(
            `Gemini ${res.status}: ${detail.slice(0, 300)}`,
          ) as RetryableError & { retryAfterMs?: number };
          err.status = res.status;
          const retryAfter = res.headers.get('retry-after');
          if (retryAfter) err.retryAfterMs = Number(retryAfter) * 1000;
          throw err;
        }
        const data = (await res.json()) as GeminiResponse;
        const usage = data.usageMetadata;
        if (attempt) {
          opts?.usageMeter?.settleAttempt(
            attempt.id,
            typeof usage?.promptTokenCount === 'number' &&
              typeof usage?.candidatesTokenCount === 'number'
              ? {
                  inputTokens: usage.promptTokenCount,
                  outputTokens: usage.candidatesTokenCount,
                }
              : undefined,
          );
        }
        return data;
      },
      { signal: opts?.signal },
    );
  }

  return {
    async ground(prompt, opts) {
      const body: Record<string, unknown> = {
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2 },
      };
      if (opts?.system) body.systemInstruction = { parts: [{ text: opts.system }] };
      const data = await call(groundedModel, body, opts, 'ground');
      if (data.promptFeedback?.blockReason) {
        throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
      }
      return {
        text: extractText(data),
        citations: extractCitations(data),
        queries: data.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [],
      };
    },

    async structure<T>(
      prompt: string,
      schema: ZodType<T, ZodTypeDef, unknown>,
      opts?: CallOptions,
    ): Promise<T> {
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
      let lastError: unknown;
      // One reparse retry: JSON-mode is reliable but not infallible.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const data = await call(structureModel, body, opts, 'structure');
        try {
          return schema.parse(extractJson(extractText(data)));
        } catch (err) {
          lastError = err;
        }
      }
      throw new Error(
        `Failed to structure Gemini output: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      );
    },
  };
}

/** Provider-neutral capabilities backed by one shared Gemini client instance. */
export function createGeminiBackend(config: GeminiClientConfig): {
  model: IntelligenceModel;
  nativeResearch: NativeResearchProvider;
} {
  const client = createGeminiClient(config);
  return {
    model: {
      id: `gemini:${config.structureModel ?? DEFAULT_STRUCTURE_MODEL}`,
      structure: (prompt, schema, opts) => client.structure(prompt, schema, opts),
    },
    nativeResearch: {
      id: 'google-search',
      ground: (prompt, opts) => client.ground(prompt, opts),
    },
  };
}
