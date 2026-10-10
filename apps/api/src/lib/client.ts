/**
 * Credential resolution — who pays for this request?
 *
 * Stratemark deliberately separates two things most products conflate:
 *
 *   ACCOUNT TIER  — what you pay us for (storage, sync, sharing, the cache)
 *   KEY SOURCE    — whose Gemini credentials do the model work
 *
 * They are orthogonal, which produces three legitimate combinations:
 *
 *   no account  + own key     → free / open source. Everything stays local.
 *   subscriber  + our key     → we absorb API cost; quota-limited.
 *   subscriber  + own key     → they absorb API cost; we provide storage,
 *                               sync and sharing. Near-zero marginal cost to
 *                               us, so it can sit at the cheapest paid tier.
 *
 * A caller opts into the third by sending their key in `X-Gemini-Key`. The key
 * is used for exactly the lifetime of the request: never logged, never stored,
 * never echoed back in a response or an error.
 */
import { createGenAiClient } from '@mi/research';
import type { LlmClient } from '@mi/research';
import { DEFAULT_VERTEX_GROUNDED_MODEL, DEFAULT_VERTEX_STRUCTURE_MODEL } from '@mi/research';
import { hasServerCredentials, type ServiceEnv } from '../env';

export type KeySource = 'caller' | 'server';

export interface ResolvedClient {
  client: LlmClient;
  /** Which credentials did the work — drives cost attribution, never billing of the wrong party. */
  keySource: KeySource;
}

export class NoCredentialsError extends Error {
  readonly status = 503;
  constructor() {
    super(
      'This service has no Gemini credentials configured, and the request did not supply one. ' +
        'Send your own key in X-Gemini-Key, or contact the operator.',
    );
    this.name = 'NoCredentialsError';
  }
}

/** Header names are case-insensitive; this is the canonical spelling. */
export const BYOK_HEADER = 'x-gemini-key';

/**
 * A key must survive an HTTP header round trip. Pasted keys routinely carry
 * zero-width spaces and trailing newlines, which make the transport throw
 * before the request is sent — reject those clearly rather than cryptically.
 */
export function sanitizeKey(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^\x20-\x7E]/g, '').trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export interface ResolveOptions {
  env: ServiceEnv;
  /** Raw `X-Gemini-Key` header value, if the caller sent one. */
  callerKey?: string | undefined;
  /** Per-request metering hook. */
  onCall?: (info: { model: string; kind: 'ground' | 'structure' | 'judge' }) => void;
  /** Escape hatch for tests. */
  factory?: typeof createGenAiClient;
}

export function resolveClient(opts: ResolveOptions): ResolvedClient {
  const make = opts.factory ?? createGenAiClient;
  const callerKey = sanitizeKey(opts.callerKey);

  // The caller's own key always wins when present. A subscriber who supplies a
  // key has explicitly chosen to spend their own quota, and silently billing
  // ours instead would be both expensive and dishonest.
  if (callerKey) {
    return {
      client: make({ apiKey: callerKey, onCall: opts.onCall }),
      keySource: 'caller',
    };
  }

  if (!hasServerCredentials(opts.env)) throw new NoCredentialsError();

  return {
      client: make(
        opts.env.vertex
        ? {
            vertex: opts.env.vertex,
            model: DEFAULT_VERTEX_GROUNDED_MODEL,
            structureModel: DEFAULT_VERTEX_STRUCTURE_MODEL,
            onCall: opts.onCall,
          }
        : { apiKey: opts.env.geminiApiKey, onCall: opts.onCall },
      ),
    keySource: 'server',
  };
}
