/**
 * The hosted Stratemark API (Cloudflare Worker `stratemark-api`).
 *
 * Set `VITE_STRATEMARK_API_URL` at build time (for example
 * https://stratemark-api.<account>.workers.dev). When it is set, a production
 * build:
 *   - runs research on the server-held Gemini key when the user has not added
 *     their own (free beta, capped per day on the server), and
 *   - reads original sources, logo pages and logo images through the Worker,
 *     the way the dev-only Vite bridges do locally.
 * A user's own key always wins and is still sent only to Google.
 */
import { create } from 'zustand';

/** What the hosted Worker has said about the covered research: why it refused (HTTP 402), and how much of the beta allowance this person has used. */
export interface HostedAllowance { usedUsd: number; allowanceUsd: number }
export type HostedExhausted = null | 'global' | 'visitor' | 'allowance';
export const useHostedBudget = create<{ exhausted: HostedExhausted; allowance: HostedAllowance | null }>(() => ({ exhausted: null, allowance: null }));

/** Record a hosted answer's refusal or allowance headers. Only changes the store when something differs (no needless re-render). */
export function noteHostedAnswer(status: number, body: { reason?: unknown; usedUsd?: unknown; allowanceUsd?: unknown } | null, headers: Headers): void {
  const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
  const state = useHostedBudget.getState();
  if (status === 402) {
    const reason = body?.reason === 'allowance' || body?.reason === 'visitor' ? body.reason : 'global';
    const used = number(body?.usedUsd);
    const cap = number(body?.allowanceUsd);
    useHostedBudget.setState({ exhausted: reason, ...(reason === 'allowance' && used !== null && cap !== null ? { allowance: { usedUsd: used, allowanceUsd: cap } } : {}) });
    return;
  }
  const used = headers.get('x-allowance-used-usd');
  const cap = headers.get('x-allowance-usd');
  if (used === null || cap === null || used.trim() === '' || cap.trim() === '') return;
  const next = { usedUsd: Number(used), allowanceUsd: Number(cap) };
  if (!Number.isFinite(next.usedUsd) || !Number.isFinite(next.allowanceUsd) || next.usedUsd < 0 || next.allowanceUsd <= 0) return;
  if (state.allowance?.usedUsd !== next.usedUsd || state.allowance?.allowanceUsd !== next.allowanceUsd) useHostedBudget.setState({ allowance: next });
}

// A share page never talks to the hosted Worker, whatever the build was configured with.
export const HOSTED_API_URL: string = import.meta.env.MODE === 'share'
  ? ''
  : String(import.meta.env.VITE_STRATEMARK_API_URL ?? '').trim().replace(/\/+$/, '');

/** Stand-in "key" that marks the hosted engine. Never sent anywhere: the fetch shim strips it. */
export const HOSTED_KEY = 'stratemark-hosted';

export function hasHostedApi(): boolean {
  return /^https:\/\//.test(HOSTED_API_URL) || (import.meta.env.DEV && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(HOSTED_API_URL));
}

/**
 * The Worker that stores share links. The research relay above is off in a share page, but the page still
 * reads its own share from here (one GET by id), so this one is set in every build.
 */
export const SHARE_API_URL: string = String(import.meta.env.VITE_STRATEMARK_API_URL ?? '').trim().replace(/\/+$/, '');

/** True when a Worker is configured to store share links (https, or localhost while developing). */
export function hasShareApi(apiUrl: string = SHARE_API_URL): boolean {
  return /^https:\/\//.test(apiUrl) || (import.meta.env.DEV && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(apiUrl));
}

export function hostedUrl(path: string): string {
  return `${HOSTED_API_URL}/v1/${path.replace(/^\/+/, '')}`;
}

/**
 * The referrer policy for an <img> whose address may be the Worker's image reader. An image tag sends no Origin header, so
 * the Worker names the page that asked from its Referer (GET /v1/image only): `no-referrer` sends neither header and the
 * Worker answers 403, so a picture through the Worker must say `origin` (this app's own origin to our own Worker; no path,
 * no query). A picture loaded straight from a publisher's host keeps `no-referrer`: that host must not learn the page.
 */
export function imageReferrerPolicy(src: string, apiUrl: string = HOSTED_API_URL): 'origin' | 'no-referrer' {
  return apiUrl !== '' && src.startsWith(`${apiUrl}/v1/image?`) ? 'origin' : 'no-referrer';
}
