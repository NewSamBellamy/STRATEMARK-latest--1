/**
 * The pieces of the preview-image readers (/v1/preview, /v1/image) that are
 * pure policy, kept out of index.ts so they can be tested without a Worker:
 * how we introduce ourselves to a publisher, what Referer an image host sees,
 * how long a "no picture" answer may be cached, and a head-only page read.
 * None of this touches authentication, origin checks or quotas.
 */

/**
 * Publishers' bot filters often turn away anything that does not look like a
 * browser, which is why a plain bot UA misses real og:images. A browser-shaped
 * UA that still names us at the end: we identify, we just do not get filtered on a
 * keyword. Used only for link-preview page reads and image fetches.
 */
export const PREVIEW_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Stratemark-Preview/1.0 (+https://getstratemark.com)';

/** Modest increase over the old 2 MB: large editorial hero images are routinely 2-4 MB. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** A "this page has no picture" answer is retried soon (publishers rate-limit and recover); a real picture is kept for a week. */
export const PREVIEW_HIT_TTL_S = 604_800;
export const PREVIEW_MISS_TTL_S = 600;

export function previewCacheSeconds(body: { image: string | null }): number {
  return body.image ? PREVIEW_HIT_TTL_S : PREVIEW_MISS_TTL_S;
}

/**
 * Headers for fetching a publisher's page. Accept-Language keeps CDNs from
 * serving an interstitial; no cookies, no credentials.
 */
export function pageRequestHeaders(): Record<string, string> {
  return {
    'User-Agent': PREVIEW_UA,
    Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    'Accept-Language': 'en-US,en;q=0.8',
  };
}

/**
 * Headers for fetching a picture. Hotlink protection usually admits the page
 * that embeds the picture (or the picture's own site), so the Referer is the
 * page the picture was found on when the caller says so, else the picture's own
 * origin. The visitor's address and our app origin are never sent.
 */
export function imageRequestHeaders(image: URL, page: URL | null): Record<string, string> {
  return {
    'User-Agent': PREVIEW_UA,
    Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.8',
    Referer: page ? page.href : `${image.origin}/`,
  };
}

/**
 * Read at most `limit` bytes and keep what was read. Unlike a hard cap that
 * fails a long page outright, the head of a page is all a preview needs: the
 * tags sit near the top, so an over-long page still yields its picture.
 */
export async function readPrefix(res: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = limit - size;
    if (value.byteLength >= room) {
      chunks.push(value.subarray(0, room));
      size += room;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}

/** The image types served through /v1/image. SVG stays excluded: it can carry script, and colour sampling needs a raster. */
export const SERVABLE_IMAGE_TYPE = /^image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|avif)$/;
