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

export type PreviewImageKind = 'og' | 'jsonld' | 'content';

/** A page's preview with where the picture came from and the page's own icon (used as a last-resort picture). */
export interface PagePreviewDetail extends PagePreview {
  imageKind: PreviewImageKind | null;
  icon: string | null;
}

const BAD_CONTENT_IMAGE = /(?:sprite|icon|logo|avatar|pixel|spacer|blank|tracking|badge|emoji|gravatar|placeholder|1x1|loading|button)|\.(?:svg|gif|ico)(?:$|\?)/i;

function resolveSafe(raw: string | null | undefined, pageUrl: string): string | null {
  if (!raw) return null;
  try {
    const url = safeImageUrl(new URL(decodeEntities(raw), pageUrl).href);
    return url && !/(?:pixel|spacer|blank|1x1)\.(?:gif|png)$/i.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

/** The first picture a JSON-LD block names (image, thumbnailUrl), looking through arrays and @graph. */
function jsonLdImage(html: string, pageUrl: string): string | null {
  const blocks = html.match(/<script\b[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const find = (node: unknown, depth: number): string | null => {
    if (depth > 6 || node == null) return null;
    if (Array.isArray(node)) { for (const n of node) { const f = find(n, depth + 1); if (f) return f; } return null; }
    if (typeof node !== 'object') return null;
    const o = node as Record<string, unknown>;
    for (const key of ['image', 'thumbnailUrl', 'primaryImageOfPage']) {
      const v = o[key];
      const candidates = Array.isArray(v) ? v : [v];
      for (const c of candidates) {
        const raw = typeof c === 'string' ? c : c && typeof c === 'object' ? (c as Record<string, unknown>).url ?? (c as Record<string, unknown>).contentUrl : null;
        const safe = typeof raw === 'string' ? resolveSafe(raw, pageUrl) : null;
        if (safe) return safe;
      }
    }
    return find(o['@graph'], depth + 1);
  };
  for (const block of blocks.slice(0, 6)) {
    const body = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    if (body.length > 200_000) continue;
    try { const found = find(JSON.parse(body), 0); if (found) return found; } catch { /* malformed JSON-LD is common; skip it */ }
  }
  return null;
}

/** The first large content image: sized in the markup at 300px or more, or unsized but not an icon, sprite or avatar. */
function contentImage(html: string, pageUrl: string): string | null {
  for (const tag of (html.match(/<img\b[^>]*>/gi) ?? []).slice(0, 80)) {
    const a = attributes(tag);
    const srcset = (a.srcset ?? a['data-srcset'] ?? '').split(',').map((s) => s.trim().split(/\s+/)).filter((p) => p[0]);
    const widest = srcset.sort((x, y) => (parseInt(y[1] ?? '0', 10) || 0) - (parseInt(x[1] ?? '0', 10) || 0))[0]?.[0];
    const raw = widest ?? a.src ?? a['data-src'];
    if (!raw || raw.startsWith('data:') || BAD_CONTENT_IMAGE.test(raw) || BAD_CONTENT_IMAGE.test(a.class ?? '') || BAD_CONTENT_IMAGE.test(a.alt ?? '')) continue;
    const w = parseInt(a.width ?? '', 10);
    const h = parseInt(a.height ?? '', 10);
    if ((Number.isFinite(w) && w < 300) || (Number.isFinite(h) && h < 160)) continue;
    const safe = resolveSafe(raw, pageUrl);
    if (safe) return safe;
  }
  return null;
}

/** The page's own icon, the largest declared (apple-touch-icon first); a fallback picture, never a hero. */
function pageIcon(html: string, pageUrl: string): string | null {
  const icons: Array<{ href: string; size: number; touch: boolean }> = [];
  for (const tag of (html.slice(0, 400_000).match(/<link\b[^>]*>/gi) ?? [])) {
    const a = attributes(tag);
    const rel = (a.rel ?? '').toLowerCase().split(/\s+/);
    if (!a.href || !(rel.includes('icon') || rel.includes('apple-touch-icon'))) continue;
    if (/\.svg(?:$|\?)/i.test(a.href)) continue;
    icons.push({ href: a.href, size: parseInt((a.sizes ?? '').split('x')[0] ?? '', 10) || 0, touch: rel.includes('apple-touch-icon') });
  }
  icons.sort((x, y) => (Number(y.touch) - Number(x.touch)) || (y.size - x.size));
  for (const icon of icons) { const safe = resolveSafe(icon.href, pageUrl); if (safe) return safe; }
  return null;
}

/**
 * The same preview with more ways to find a picture, in order: the og/twitter image, a JSON-LD image or thumbnail, the first
 * large content image. A page that publishes none still reports its own icon so a surface can show something real.
 */
export function previewDetailFromHtml(html: string, pageUrl: string): PagePreviewDetail {
  const base = previewFromHtml(html, pageUrl);
  const icon = pageIcon(html, pageUrl);
  if (base.image) return { ...base, imageKind: 'og', icon };
  const body = html.slice(0, 900_000);
  const ld = jsonLdImage(body, pageUrl);
  if (ld) return { ...base, image: ld, imageKind: 'jsonld', icon };
  const content = contentImage(body, pageUrl);
  if (content) return { ...base, image: content, imageKind: 'content', icon };
  return { ...base, image: null, imageKind: null, icon };
}
