/**
 * A share as files you can host: the viewer page with the research inside, the
 * link-preview picture, and a firebase.json so one command publishes it.
 *
 *   <id>/index.html   the page (a card or a whole deck, read-only)
 *   <id>/og.png       the picture chat apps show when the link is pasted
 *   firebase.json     hosting settings (the shares are unlisted and not indexed)
 *   README.txt        the one deploy command
 *
 * Publishing needs the owner's Firebase login, so the app stops at the files.
 */
import type { ShareSnapshot } from '@mi/contracts';
import { buildShareHtml, newShareId, ogLayout, shareMeta, SHARE_DATA_SLOT, SHARE_META_TOKEN } from './bundle';
import { buildZip } from './zip';

export const SHARE_FIREBASE_JSON = JSON.stringify(
  {
    hosting: {
      public: '.',
      ignore: ['firebase.json', 'README.txt', '**/.*', '**/node_modules/**'],
      cleanUrls: true,
      headers: [
        { source: '**', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Referrer-Policy', value: 'no-referrer' }] },
        { source: '**/*.png', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
        { source: '**/index.html', headers: [{ key: 'Cache-Control', value: 'public, max-age=300' }] },
      ],
    },
  },
  null,
  2,
);

function readme(id: string, baseUrl: string | null): string {
  return [
    'Stratemark share',
    '',
    `This folder holds one share (${id}). To publish it, from this folder:`,
    '',
    '    firebase deploy --only hosting',
    '',
    '(Sign in once with `firebase login`, and pick your project with `firebase use <project>`.)',
    '',
    baseUrl
      ? `It will be served at ${baseUrl}/${id}/ . Send that address to anyone: no account is needed to open it.`
      : `It will be served at <your hosting address>/${id}/ . Send that address to anyone: no account is needed to open it.\nNo public address was set when this was made, so the link preview has no picture. Set the share address in the Share dialog and make it again to add one.`,
    '',
    'Adding more shares: unzip another share into the same folder and deploy again.',
    '',
  ].join('\n');
}

/** A built viewer is one self-contained page. The dev server's copy loads scripts from the dev server, so it cannot travel. */
export function assertSelfContained(template: string): void {
  if (!SHARE_DATA_SLOT.test(template) || !template.includes(SHARE_META_TOKEN)) {
    throw new Error('The share page template is missing. Rebuild the web app, then try again.');
  }
  if (/<script\b[^>]*\bsrc=/i.test(template) || /<link\b[^>]*rel=["']stylesheet["']/i.test(template)) {
    throw new Error('Sharing as a page needs the built app. Run `pnpm build` (or use the packaged app) and try again.');
  }
}

export async function fetchViewerTemplate(
  fetcher: typeof fetch = (...args) => fetch(...args),
  baseHref: string = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/',
): Promise<string> {
  const url = new URL('share.html', baseHref).href;
  const response = await fetcher(url, { credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error('The share page template could not be loaded. Rebuild the web app, then try again.');
  const text = await response.text();
  assertSelfContained(text);
  return text;
}

export interface SharePackage {
  id: string;
  fileName: string;
  zip: Uint8Array;
  html: string;
  hasImage: boolean;
  title: string;
}

export async function createSharePackage(input: {
  snapshot: ShareSnapshot;
  template: string;
  baseUrl?: string | null;
  signupUrl?: string;
  /** Draws the preview picture; null when drawing is not available (the share still works, without a picture). */
  renderImage?: ((snapshot: ShareSnapshot) => Promise<Uint8Array | null>) | null;
  id?: string;
}): Promise<SharePackage> {
  assertSelfContained(input.template);
  const id = input.id ?? newShareId();
  const png = input.renderImage ? await input.renderImage(input.snapshot).catch(() => null) : null;
  const baseUrl = input.baseUrl && /^https:\/\//i.test(input.baseUrl) ? input.baseUrl.replace(/\/+$/, '') : null;
  const html = buildShareHtml({
    template: input.template,
    snapshot: input.snapshot,
    ...(input.signupUrl ? { signupUrl: input.signupUrl } : {}),
    baseUrl,
    shareId: id,
    withImage: png !== null,
  });
  const zip = buildZip([
    { path: 'firebase.json', data: SHARE_FIREBASE_JSON },
    { path: 'README.txt', data: readme(id, baseUrl) },
    { path: `${id}/index.html`, data: html },
    ...(png ? [{ path: `${id}/og.png`, data: png }] : []),
  ]);
  const slug = (ogLayout(input.snapshot).title || 'share').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'share';
  return { id, fileName: `stratemark-share-${slug}-${id}.zip`, zip, html, hasImage: png !== null, title: shareMeta(input.snapshot).title };
}

/** Where og.png is drawn in the browser; kept apart so tests and node scripts do not need a canvas. */
export async function drawPreview(snapshot: ShareSnapshot): Promise<Uint8Array | null> {
  const { renderOgImage } = await import('./ogImage');
  return renderOgImage(ogLayout(snapshot));
}
