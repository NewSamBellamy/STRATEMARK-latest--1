/**
 * The beta's promises, in one place so every surface says the same thing.
 * Keep these true in code: research lives in the browser, the hosted Worker
 * passes requests through without storing or logging them, and the export
 * file imports into the open-source app.
 */
import { hasHostedApi } from '@/lib/hostedApi';

/** When the open-source, bring-your-own-key version ships. */
export const OPEN_SOURCE_LAUNCH = 'December 1, 2026';

/**
 * Where honest feedback goes. Set VITE_FEEDBACK_URL at build time (a form,
 * a mailto: link or an issues page); without it the feedback links are hidden.
 */
export const FEEDBACK_URL: string = String(import.meta.env.VITE_FEEDBACK_URL ?? '').trim();

/** The free hosted beta: we pay for AI and backend so people can try it. */
export function isHostedBeta(): boolean {
  return hasHostedApi();
}
