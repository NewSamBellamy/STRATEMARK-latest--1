/**
 * Sentinel Cloud Run API Client Helper — lightweight HTTP interface
 * connecting the Web / Desktop client to the deployed Sentinel Cloud Run backend.
 */

import type { VerifyMetricInput, VerifyMetricResult, HuntMetricsResult } from '@mi/contracts';

export interface SentinelAlert {
  id: string;
  userId: string;
  companyId: string;
  companyName: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  confidence: 'verified' | 'estimated' | 'unknown';
  isDuplicate?: boolean;
  createdAt: string;
}

export interface SentinelCompany {
  id: string;
  userId: string;
  name: string;
  edgarCik?: string | null;
  newsSources?: string[];
  rssFeeds?: string[];
  createdAt: string;
}

export interface SentinelUserProfile {
  id: string;
  email: string | null;
  subscriptionTier: 'pro' | 'free';
  subscriptionStatus: 'active' | 'trialing' | 'canceled';
}

/**
 * Fetch the authenticated user's profile and subscription status.
 *
 * Returns null when the backend cannot be reached. It does NOT guess at
 * entitlement: granting a paid tier because an email ends in a particular
 * domain is a backdoor anyone can walk through by typing that address, and it
 * publishes an internal access rule to every downloaded bundle. The billing
 * system is the only source of truth for paid status, and failing to "free" is
 * the safe direction.
 */
export async function fetchUserProfile(token?: string | null): Promise<SentinelUserProfile | null> {
  try {
    const data = await fetchSentinel<{ user: SentinelUserProfile }>('/api/me', { token });
    if (data.user) return data.user;
  } catch {
    // Offline, or the endpoint is not deployed yet.
  }
  return null;
}

export interface CloudResearchDeckResponse {
  ok: boolean;
  stage?: string;
  deckId?: string;
  state?: { status?: string; error?: string };
  market?: Record<string, unknown>;
  deck?: Record<string, unknown>;
  cards?: Array<Record<string, unknown>>;
  companies?: Array<Record<string, unknown>>;
  candidates?: Array<Record<string, unknown>>;
  result?: {
    market: Record<string, unknown>;
    deck: Record<string, unknown>;
    cards: Array<Record<string, unknown>>;
  };
  scrapedCompanies?: Array<{ company: Record<string, unknown>; changes: Array<unknown> }>;
  error?: string;
}

/**
 * Where the Sentinel cloud engine lives.
 *
 * There is deliberately NO hardcoded fallback URL. This previously defaulted to
 * `https://stratemark-agent-142700126606.us-central1.run.app`, a service that was never
 * deployed — so selecting the cloud engine produced a DNS failure that looked
 * like a bug in the app rather than missing configuration.
 *
 * `VITE_API_BASE_URL` is the deployment-script alias for this same Cloud Run
 * service. Prefer it when both variables exist so a build-time deployment URL
 * cannot be shadowed by a stale local `VITE_SENTINEL_API_URL`.
 *
 * An empty string is the honest value: callers check `isSentinelConfigured()`.
 * Set `VITE_API_BASE_URL` for deployments or `VITE_SENTINEL_API_URL` locally.
 */
const DEFAULT_SENTINEL_URL =
  import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_SENTINEL_API_URL || '';

/** True when a cloud endpoint is actually configured. */
export function isSentinelConfigured(): boolean {
  if (typeof localStorage !== 'undefined' && localStorage.getItem('mi.sentinelApiUrl')) return true;
  return DEFAULT_SENTINEL_URL.length > 0;
}

function getSentinelUrl(path: string): string {
  let base = DEFAULT_SENTINEL_URL;
  if (typeof localStorage !== 'undefined') {
    const customUrl = localStorage.getItem('mi.sentinelApiUrl');
    if (customUrl) base = customUrl;
  }
  if (!base) {
    // Fail with the actual reason rather than issuing a request to "/api/…" on
    // our own origin, which would 404 and read as a broken feature.
    throw new Error(
      'The Sentinel cloud engine is not configured. Set VITE_SENTINEL_API_URL, or use your own Gemini key locally.',
    );
  }
  const cleanBase = base.replace(/\/+$/, '');
  const subPath = path.replace(/^\/+/, '');
  return `${cleanBase}/${subPath}`;
}

async function getStoredAuthToken(): Promise<string | null> {
  try {
    const { getAuth } = await import('firebase/auth');
    const auth = getAuth();
    if (auth && auth.currentUser) {
      return await auth.currentUser.getIdToken();
    }
  } catch {
    /* ignore - Firebase might not be initialized */
  }

  return null;
}

export async function fetchSentinel<T>(
  endpoint: string,
  options: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, headers: customHeaders, ...rest } = options;
  const url = getSentinelUrl(endpoint);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(customHeaders as Record<string, string>),
  };

  const authToken = token || await getStoredAuthToken();
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const appToken = (import.meta.env?.VITE_API_APP_TOKEN as string | undefined)?.trim();
  if (appToken && !headers['X-Stratemark-Token'] && !headers['x-stratemark-token']) {
    headers['X-Stratemark-Token'] = appToken;
  }

  const res = await fetch(url, { ...rest, headers });

  if (!res.ok) {
    let errorMsg = `Sentinel API request failed (${res.status} ${res.statusText})`;
    try {
      const errJson = (await res.json()) as { error?: string; details?: string };
      if (errJson.error) errorMsg = errJson.error;
      if (errJson.details) errorMsg += `: ${errJson.details}`;
    } catch {
      // ignore json parse error
    }
    throw new Error(errorMsg);
  }

  return (await res.json()) as T;
}

/** Fetch legal & court alerts from Sentinel Cloud backend */
export async function getRecentAlerts(token?: string | null): Promise<SentinelAlert[]> {
  try {
    const data = await fetchSentinel<{ alerts: SentinelAlert[] }>('/api/alerts', { token });
    return data.alerts || [];
  } catch (err) {
    console.warn('Failed to fetch Sentinel alerts:', err);
    return [];
  }
}

/** Trigger real-time background market & legal scraper */
export async function triggerScrape(token?: string | null): Promise<{ ok: boolean; alertsSent: number }> {
  return fetchSentinel<{ ok: boolean; alertsSent: number }>('/api/scrape', {
    method: 'POST',
    token,
  });
}

/** Add a tracked company to Sentinel monitoring */
export async function createTrackedCompany(
  name: string,
  edgarCik?: string | null,
  token?: string | null,
): Promise<SentinelCompany> {
  const data = await fetchSentinel<{ company: SentinelCompany }>('/api/companies', {
    method: 'POST',
    body: JSON.stringify({ name, edgarCik: edgarCik ?? null }),
    token,
  });
  return data.company;
}

/** Execute 5-stage grounded research deck pipeline on Cloud Run backend */
export async function runCloudResearchDeck(
  prompt: string,
  region?: string | null,
  targetCompanies?: number,
  token?: string | null,
  deckId?: string,
): Promise<CloudResearchDeckResponse> {
  return fetchSentinel<CloudResearchDeckResponse>('/api/research/deck', {
    method: 'POST',
    body: JSON.stringify({
      prompt,
      query: prompt,
      region,
      targetCompanies,
      ...(deckId ? { deckId } : {}),
    }),
    token,
  });
}

/** Delete a research deck from Sentinel Cloud backend */
export async function deleteCloudDeck(
  deckId: string,
  token?: string | null,
): Promise<boolean> {
  try {
    const res = await fetchSentinel<{ success?: boolean }>(`/api/decks/${encodeURIComponent(deckId)}`, {
      method: 'DELETE',
      token,
    });
    return res.success ?? true;
  } catch (err) {
    console.warn(`Failed to delete cloud deck ${deckId}:`, err);
    return false;
  }
}

/** Fetch user's markets directly from Sentinel Cloud backend */
export async function getCloudMarkets(token?: string | null): Promise<Array<Record<string, unknown>>> {
  try {
    const data = await fetchSentinel<{ markets: Array<Record<string, unknown>> }>('/api/markets', { token });
    return data.markets || [];
  } catch (err) {
    console.warn('Failed to fetch cloud markets:', err);
    return [];
  }
}

/** Fetch a single market directly from Sentinel Cloud backend */
export async function getCloudMarket(
  marketId: string,
  token?: string | null,
): Promise<Record<string, unknown> | null> {
  try {
    const data = await fetchSentinel<{ market: Record<string, unknown> }>(`/api/markets/${encodeURIComponent(marketId)}`, { token });
    return data.market || null;
  } catch (err) {
    console.warn(`Failed to fetch cloud market ${marketId}:`, err);
    return null;
  }
}

/** Fetch user's research decks from Sentinel Cloud backend */
export async function getCloudDecks(token?: string | null): Promise<Array<Record<string, unknown>>> {
  try {
    const data = await fetchSentinel<{ decks: Array<Record<string, unknown>> }>('/api/decks', { token });
    return data.decks || [];
  } catch (err) {
    console.warn('Failed to fetch cloud decks:', err);
    return [];
  }
}

/** Fetch a single deck and its cards/companies/metrics/viceClaims from Sentinel Cloud backend */
export async function getCloudDeck(
  deckId: string,
  token?: string | null,
): Promise<{
  deck: Record<string, unknown>;
  market: Record<string, unknown>;
  cards: Array<Record<string, unknown>>;
  companies: Array<Record<string, unknown>>;
  metrics: Array<Record<string, unknown>>;
  viceClaims: Array<Record<string, unknown>>;
  companySourceAttempts?: unknown;
  originalSourceAttempts?: unknown;
  state?: { status?: string; error?: string };
} | null> {
  try {
    return await fetchSentinel(`/api/decks/${encodeURIComponent(deckId)}`, { token });
  } catch (err) {
    console.warn(`Failed to fetch cloud deck ${deckId}:`, err);
    return null;
  }
}

/** Fetch user's cards (optionally filtered by deckId) from Sentinel Cloud backend */
export async function getCloudCards(
  deckId?: string,
  token?: string | null,
): Promise<Array<Record<string, unknown>>> {
  try {
    const query = deckId ? `?deckId=${encodeURIComponent(deckId)}` : '';
    const data = await fetchSentinel<{ cards: Array<Record<string, unknown>> }>(`/api/cards${query}`, { token });
    return data.cards || [];
  } catch (err) {
    console.warn('Failed to fetch cloud cards:', err);
    return [];
  }
}

/** Import user brain snapshot into Firestore Cloud Storage */
export async function importCloudBrainSnapshot(
  snapshot: Record<string, unknown>,
  mode: 'merge' | 'replace' = 'merge',
  token?: string | null,
): Promise<{ status: string; importedCount: number; validItems: number }> {
  return fetchSentinel<{ status: string; importedCount: number; validItems: number }>(
    '/api/v1/brain/import',
    {
      method: 'POST',
      body: JSON.stringify({ snapshot, mode }),
      token,
    },
  );
}

/** Submit AI research question to Sentinel Cloud Run backend */
export async function askCloudResearch(
  input: { threadId?: string; scope?: unknown; question: string },
  token?: string | null,
): Promise<Record<string, unknown>> {
  return fetchSentinel<Record<string, unknown>>('/api/research/chat', {
    method: 'POST',
    body: JSON.stringify(input),
    token,
  });
}

/** Re-verify one Cloud Deck metric against fresh grounded evidence. */
export async function verifyCloudMetric(
  input: VerifyMetricInput,
  deckId?: string,
  token?: string | null,
): Promise<VerifyMetricResult> {
  return fetchSentinel<VerifyMetricResult>('/api/research/verify', {
    method: 'POST',
    body: JSON.stringify(deckId ? { ...input, deckId } : input),
    token,
  });
}

/** Fill missing or soft company metrics in a Cloud Deck. */
export async function huntCloudMetrics(
  companyId: string,
  deckId?: string,
  token?: string | null,
): Promise<HuntMetricsResult> {
  return fetchSentinel<HuntMetricsResult>('/api/research/hunt-metrics', {
    method: 'POST',
    body: JSON.stringify({ companyId, deckId }),
    token,
  });
}

export async function expandCloudDeck(
  marketId: string,
  focus: { tier?: number | null; cardType?: string | null },
  token?: string | null,
): Promise<{ added: number }> {
  return fetchSentinel<{ added: number }>('/api/research/expand', {
    method: 'POST',
    body: JSON.stringify({ marketId, focus }),
    token,
  });
}

/** Fetch user saved cards from Sentinel Cloud Run backend */
export async function listCloudSavedCards(
  token?: string | null,
): Promise<Array<Record<string, unknown>>> {
  try {
    const data = await fetchSentinel<{ cards: Array<Record<string, unknown>> }>('/api/cards/saved', { token });
    return data.cards || [];
  } catch {
    return [];
  }
}

/** Save a card to user's saved collection on Sentinel Cloud backend */
export async function saveCloudCard(
  cardId: string,
  token?: string | null,
): Promise<{ ok: boolean }> {
  return fetchSentinel<{ ok: boolean }>('/api/cards/saved', {
    method: 'POST',
    body: JSON.stringify({ cardId }),
    token,
  });
}

/** Remove a card from user's saved collection on Sentinel Cloud backend */
export async function unsaveCloudCard(
  cardId: string,
  token?: string | null,
): Promise<{ ok: boolean }> {
  return fetchSentinel<{ ok: boolean }>(`/api/cards/saved/${encodeURIComponent(cardId)}`, {
    method: 'DELETE',
    token,
  });
}
