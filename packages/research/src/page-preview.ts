/**
 * Real preview images: the picture a page already publishes for link previews
 * (og:image, twitter:image, <link rel="image_src">). Pure parsing, no network,
 * so it is unit tested in Node. Shared by the hosted Worker and the web app's
 * dev path.
 */

/** https only, no credentials or odd ports, no IP literals or internal names. */
function safeImageUrl(raw: string): URL | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  if (/(?:^|\.)(?:localhost|local|internal|test|invalid|home|lan|corp)$/.test(host)) return null;
  return url;
}

export interface PagePreview { image: string | null; title: string | null; site: string | null }

const ATTR = /([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(ATTR)) {
    out[m[1]!.toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  }
  return out;
}

function decodeEntities(v: string): string {
  return v
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

export function previewFromHtml(html: string, pageUrl: string): PagePreview {
  const head = html.slice(0, 400_000);
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attributes(tag);
    const key = (a.property ?? a.name ?? '').toLowerCase();
    if (key && a.content && !meta.has(key)) meta.set(key, decodeEntities(a.content));
  }
  let imageSrc: string | undefined;
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const a = attributes(tag);
    if ((a.rel ?? '').toLowerCase().split(/\s+/).includes('image_src') && a.href) { imageSrc = decodeEntities(a.href); break; }
  }
  const raw = ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']
    .map((k) => meta.get(k)).find(Boolean) ?? imageSrc ?? null;

  let image: string | null = null;
  if (raw) {
    try {
      const resolved = safeImageUrl(new URL(raw, pageUrl).href);
      // Skip tracking pixels and spacer images that some pages put in og:image.
      if (resolved && !/(?:pixel|spacer|blank|1x1)\.(?:gif|png)$/i.test(resolved.pathname)) image = resolved.href;
    } catch { image = null; }
  }
  const title = meta.get('og:title') ?? meta.get('twitter:title') ?? null;
  const site = meta.get('og:site_name') ?? null;
  return { image, title: title ? title.slice(0, 300) : null, site: site ? site.slice(0, 120) : null };
}
