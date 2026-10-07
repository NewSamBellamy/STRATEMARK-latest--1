import { hasLocalSourceBridge } from './local-source-reader';

/** Dev loopback uses the guarded bridge; published web builds call Google directly. */
export const previewGeminiFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const match = url.match(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,119}):generateContent$/);
  if (!hasLocalSourceBridge() || !match) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set('X-Stratemark-Source', 'local-preview');
  return fetch(`/__stratemark/gemini/${match[1]}:generateContent`, {
    ...init, headers, credentials: 'omit', redirect: 'error', cache: 'no-store',
  });
};
