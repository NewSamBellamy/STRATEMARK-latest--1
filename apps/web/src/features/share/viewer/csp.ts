/**
 * The content-security policy of the share page (share.html), as a <meta> tag written at build time.
 *
 * The page's own guard (guard.ts) is JavaScript, and JavaScript that runs before it can be undone; this is the browser's
 * own rule, and it holds even if some script ever ran. A shared page may:
 *   - run its own inline script (the viewer is one self-contained file) and nothing loaded from elsewhere;
 *   - call out only to its own address, to the public reference sources its screens read (the same list the guard
 *     allows), and to the share Worker it was built against;
 *   - show pictures from any https address (logos, page captures, favicons) but load no fonts, media, objects,
 *     workers or manifests from anywhere;
 *   - frame only the privacy-enhanced YouTube player (the History video, after a click), and never submit a form,
 *     or change its base address.
 *
 * Red-team findings 4 and 7 against the hosted share viewer.
 */

const REFERENCE_SOURCES = ['https://*.wikipedia.org', 'https://*.wikidata.org', 'https://*.wikimedia.org'];

function originOf(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** The policy text. `apiUrl` is the share Worker this build reads shares from, when it has one. */
export function shareContentPolicy(apiUrl?: string): string {
  const worker = originOf(apiUrl);
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src https: data: blob:',
    'font-src data:',
    `connect-src 'self' ${[...REFERENCE_SOURCES, ...(worker ? [worker] : [])].join(' ')}`,
    'frame-src https://www.youtube-nocookie.com',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
  ].join('; ');
}

export const SHARE_CSP_TOKEN = '<!--STRATEMARK_SHARE_CSP-->';

/** share.html with its policy tag written in. */
export function withSharePolicy(html: string, apiUrl?: string): string {
  return html.replace(SHARE_CSP_TOKEN, `<meta http-equiv="Content-Security-Policy" content="${shareContentPolicy(apiUrl)}" />`);
}
