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

/** Set when the hosted Worker says today's free budget is spent (HTTP 402). */
export const useHostedBudget = create<{ exhausted: null | 'global' | 'visitor' }>(() => ({ exhausted: null }));

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
