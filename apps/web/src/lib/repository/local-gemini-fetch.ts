import { hasLocalSourceBridge } from './local-source-reader';
import { HOSTED_KEY, hasHostedApi, hostedUrl, useHostedBudget } from '@/lib/hostedApi';

/**
 * Gemini transport shim.
 *   - A user's own key: dev loopback uses the guarded bridge; published builds
 *     call Google directly. The key goes only to Google.
 *   - The hosted stand-in key: the call goes to the Stratemark Worker, which
 *     adds the server-held key. The stand-in is stripped and never leaves.
 */
export const previewGeminiFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const match = url.match(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,119}):generateContent$/);
  const headers = new Headers(init?.headers);
  if (headers.get('x-goog-api-key') === HOSTED_KEY) {
    if (!match || !hasHostedApi()) {
      return Promise.reject(new Error('Hosted research is not available. Add your own Gemini key in Settings.'));
    }
    headers.delete('x-goog-api-key');
    return fetch(hostedUrl(`gemini/${match[1]}:generateContent`), {
      ...init, headers, credentials: 'omit', redirect: 'error', cache: 'no-store',
    }).then(async (res) => {
      if (res.status === 402) {
        const body = await res.clone().json().catch(() => null) as { reason?: 'global' | 'visitor' } | null;
        useHostedBudget.setState({ exhausted: body?.reason === 'visitor' ? 'visitor' : 'global' });
      }
      return res;
    });
  }
  if (!hasLocalSourceBridge() || !match) return fetch(input, init);
  headers.set('X-Stratemark-Source', 'local-preview');
  return fetch(`/__stratemark/gemini/${match[1]}:generateContent`, {
    ...init, headers, credentials: 'omit', redirect: 'error', cache: 'no-store',
  });
};
