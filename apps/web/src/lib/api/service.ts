/**
 * Client for the Stratemark agent service (apps/api on Cloud Run).
 *
 * The app is deliberately usable with no service at all: bring a Gemini key
 * and everything runs locally in the browser, which is the open-source and
 * desktop story. The service adds what a browser genuinely cannot do —
 * capture a third-party page, print a real PDF, refresh decks while nobody is
 * watching — and it is entirely optional.
 *
 * So every call here has to answer "what if the service is not there?" with
 * something honest, never a crash and never a silent fabrication.
 *
 * Key handling mirrors apps/api/src/lib/client.ts: when the user has their own
 * key, it travels with the request and their quota does the work. That is what
 * lets a paying subscriber still bring their own key — they are paying us for
 * storage, sync and sharing, not for tokens.
 */

export interface CaptureReceipt {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number | null;
  title: string;
  contentHash: string;
  capturedAt: string;
  durationMs: number;
}

export interface CaptureVerdict {
  isRealPage: boolean;
  blockKind: string | null;
  confidence: number;
  evidence: string;
  decidedBy: 'signature' | 'vision';
}

export type CaptureOutcome =
  | { ok: true; receipt: CaptureReceipt; verdict: CaptureVerdict; screenshot: string }
  | { ok: false; receipt: CaptureReceipt; verdict: CaptureVerdict; fallbackSvg: string; caption: string }
  // The service itself was unreachable or not configured. Distinct from a
  // blocked capture: nothing was attempted, so we claim nothing.
  | { ok: false; unavailable: true; reason: string };

export interface ServiceConfig {
  baseUrl: string | undefined;
  /** The user's own Gemini key, when they have one. */
  apiKey?: string | undefined;
  /**
   * Shared token authorising use of the SERVICE's credentials.
   *
   * Only needed when the user has no key of their own. It is not a secret in
   * any meaningful sense — it ships in the client bundle — it is a revocable
   * throttle so a public endpoint attached to a billing account cannot be
   * drained by anyone who finds the URL. Rotate it by redeploying.
   */
  appToken?: string | undefined;
  fetchImpl?: typeof fetch;
}

function readBaseUrl(): string | undefined {
  const raw = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, '');
}

function readAppToken(): string | undefined {
  return (import.meta.env?.VITE_API_APP_TOKEN as string | undefined)?.trim() || undefined;
}

/** True when a service endpoint is configured. Drives UI affordances. */
export function isServiceConfigured(baseUrl?: string | undefined): boolean {
  const url = arguments.length > 0 ? baseUrl : readBaseUrl();
  return Boolean(url);
}

function headers(config: ServiceConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  // Only ever sent to our own configured service, never to a third party.
  if (config.apiKey) h['X-Gemini-Key'] = config.apiKey;
  if (config.appToken) h['X-Stratemark-Token'] = config.appToken;
  return h;
}

export interface ServiceHealth {
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

export async function checkHealth(config: ServiceConfig): Promise<ServiceHealth | null> {
  if (!config.baseUrl) return null;
  const doFetch = config.fetchImpl ?? fetch;
  try {
    let res = await doFetch(`${config.baseUrl}/health`);
    if (!res.ok) {
      res = await doFetch(`${config.baseUrl}/healthz`);
    }
    if (!res.ok) return null;
    return (await res.json()) as ServiceHealth;
  } catch {
    return null;
  }
}

/**
 * Capture and verify a page. Returns a discriminated outcome rather than
 * throwing, because "we could not photograph this" is a normal result that the
 * report has to render honestly — not an exception to swallow.
 */
export async function captureSite(
  url: string,
  config: ServiceConfig,
): Promise<CaptureOutcome> {
  if (!config.baseUrl) {
    return {
      ok: false,
      unavailable: true,
      reason:
        'Live site capture needs the Stratemark service. Without it the app cannot photograph a third-party page — browsers block reading other origins.',
    };
  }
  const doFetch = config.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${config.baseUrl}/v1/capture`, {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        ok: false,
        unavailable: true,
        reason: detail.error ?? `The capture service answered ${res.status}.`,
      };
    }
    return (await res.json()) as CaptureOutcome;
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      reason: `Could not reach the capture service: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Render a self-contained HTML report as a real PDF.
 *
 * Returns null when unavailable so the caller can fall back to offering the
 * HTML file — which is a legitimate deliverable in its own right, and the
 * better one for reading on a phone.
 */
export async function renderReportPdf(
  html: string,
  config: ServiceConfig,
  filename = 'stratemark-report',
): Promise<Blob | null> {
  if (!config.baseUrl) return null;
  const doFetch = config.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${config.baseUrl}/v1/report/pdf`, {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({ html, filename }),
    });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/** Build the config from ambient environment plus the user's stored key. */
export function serviceConfig(apiKey?: string | undefined): ServiceConfig {
  return { baseUrl: readBaseUrl(), apiKey, appToken: readAppToken() };
}
