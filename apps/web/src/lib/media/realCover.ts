/**
 * Real cover images: the picture a story, product or company page already
 * publishes for link previews (og:image). Free to fetch, true to the source,
 * and credited — preferred over generated art everywhere a cover has a URL.
 *
 *   hosted build → the Worker's /v1/preview (edge-cached for everyone), and the
 *                  image is shown through /v1/image so publishers never see
 *                  our users' addresses;
 *   local dev    → the dev bridge reads the page; the image loads directly;
 *   otherwise    → none, and the designed editorial cover holds the frame.
 */
import { useEffect, useState } from 'react';
import { previewFromHtml } from '@mi/research/page-preview';
import { hasHostedApi, hostedUrl } from '@/lib/hostedApi';
import { hasLocalSourceBridge, readAssetSource } from '@/lib/repository/local-source-reader';

export interface RealCover {
  /** Displayable image URL, or null when the page publishes none. */
  src: string | null;
  /** Who published it, for the credit line ("Image: reuters.com"). */
  publisher: string | null;
}

export type RealCoverState = { status: 'loading' } | { status: 'none' } | ({ status: 'ready' } & RealCover);

const cache = new Map<string, Promise<RealCover | null>>();

const hostOf = (u: string): string | null => {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; }
};

async function resolve(pageUrl: string): Promise<RealCover | null> {
  if (hasHostedApi()) {
    const res = await fetch(hostedUrl(`preview?url=${encodeURIComponent(pageUrl)}`), { credentials: 'omit' });
    if (!res.ok) return null;
    const p = await res.json() as { image: string | null; site: string | null };
    if (!p.image) return null;
    return { src: hostedUrl(`image?url=${encodeURIComponent(p.image)}`), publisher: p.site ?? hostOf(p.image) };
  }
  if (hasLocalSourceBridge()) {
    const receipt = await readAssetSource(pageUrl);
    if (receipt.status !== 'retrieved' || !receipt.text) return null;
    const finalUrl = receipt.finalUrl ?? pageUrl;
    const p = previewFromHtml(receipt.text, finalUrl);
    return p.image ? { src: p.image, publisher: p.site ?? hostOf(finalUrl) } : null;
  }
  return null;
}

export function getRealCover(pageUrl: string): Promise<RealCover | null> {
  let hit = cache.get(pageUrl);
  if (!hit) {
    hit = resolve(pageUrl).catch(() => null);
    cache.set(pageUrl, hit);
  }
  return hit;
}

/** Only real web pages can have a preview image. */
function isPageUrl(u: string | null | undefined): u is string {
  return !!u && /^https:\/\//i.test(u);
}

export function useRealCover(pageUrl: string | null | undefined): RealCoverState {
  const [state, setState] = useState<RealCoverState>(isPageUrl(pageUrl) ? { status: 'loading' } : { status: 'none' });
  useEffect(() => {
    if (!isPageUrl(pageUrl)) { setState({ status: 'none' }); return; }
    let live = true;
    setState({ status: 'loading' });
    void getRealCover(pageUrl).then((c) => {
      if (live) setState(c?.src ? { status: 'ready', ...c } : { status: 'none' });
    });
    return () => { live = false; };
  }, [pageUrl]);
  return state;
}
