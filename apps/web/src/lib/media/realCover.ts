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
import { previewDetailFromHtml } from '@mi/research/page-preview';
import { hasHostedApi, hostedUrl } from '@/lib/hostedApi';
import { LruCache, fetchWithTimeout } from '@/lib/media/lookupCache';
import { hasLocalSourceBridge, readAssetSource } from '@/lib/repository/local-source-reader';

export interface RealCover {
  /** Displayable image URL, or null when the page publishes none. */
  src: string | null;
  /** Who published it, for the credit line ("Image: reuters.com"). */
  publisher: string | null;
}

export type RealCoverState = { status: 'loading' } | { status: 'none' } | ({ status: 'ready' } & RealCover);

/**
 * Settled answers ("this page's image", "this page publishes none") are kept
 * until evicted; a lookup that failed — network error, timeout, unreadable
 * page — answers null now and is retried after FAILURE_RETRY_MS.
 */
interface CacheEntry {
  promise: Promise<RealCover | null>;
  retryAt: number;
}

const CACHE_MAX = 500;
const FAILURE_RETRY_MS = 60_000;
/** A page with no picture is asked again after this long: publishers rate-limit and recover, and pages gain images. */
const NO_PICTURE_RETRY_MS = 10 * 60_000;
const cache = new LruCache<string, CacheEntry>(CACHE_MAX);

/** The page could not be read, as distinct from a page with no image. */
class LookupFailed extends Error {}

const hostOf = (u: string): string | null => {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; }
};

async function resolve(pageUrl: string): Promise<RealCover | null> {
  if (hasHostedApi()) {
    const res = await fetchWithTimeout(hostedUrl(`preview?url=${encodeURIComponent(pageUrl)}`), { credentials: 'omit' });
    if (!res.ok) throw new LookupFailed(`preview ${res.status}`);
    const p = await res.json() as { image: string | null; site: string | null };
    if (!p.image) return null;
    // `page` is sent to the image host as Referer, which hotlink rules expect.
    return { src: hostedUrl(`image?url=${encodeURIComponent(p.image)}&page=${encodeURIComponent(pageUrl)}`), publisher: p.site ?? hostOf(p.image) };
  }
  if (hasLocalSourceBridge()) {
    const receipt = await readAssetSource(pageUrl);
    if (receipt.status !== 'retrieved' || !receipt.text) throw new LookupFailed(receipt.status);
    const finalUrl = receipt.finalUrl ?? pageUrl;
    const p = previewDetailFromHtml(receipt.text, finalUrl);
    return p.image ? { src: p.image, publisher: p.site ?? hostOf(finalUrl) } : null;
  }
  return null;
}

export function getRealCover(pageUrl: string): Promise<RealCover | null> {
  const hit = cache.get(pageUrl);
  if (hit && Date.now() < hit.retryAt) return hit.promise;
  const entry: CacheEntry = { promise: Promise.resolve(null), retryAt: Number.POSITIVE_INFINITY };
  entry.promise = resolve(pageUrl).then((cover) => {
    if (!cover) entry.retryAt = Date.now() + NO_PICTURE_RETRY_MS;
    return cover;
  }, () => {
    entry.retryAt = Date.now() + FAILURE_RETRY_MS;
    return null;
  });
  cache.set(pageUrl, entry);
  return entry.promise;
}

/** Test seam: forget every cached lookup. */
export function clearRealCoverCache(): void {
  cache.clear();
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
