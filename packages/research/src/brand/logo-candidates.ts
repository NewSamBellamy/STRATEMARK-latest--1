/**
 * Ranked logo candidates from already-fetched homepage HTML (no extra fetch).
 *
 * Ladder (lower rank wins):
 *   1 json-ld Organization.logo
 *   2 <img> inside header/nav/home-link whose class/id/alt/src names "logo"
 *   3 (Wikidata P154 — injected by the resolver, domain-verified)
 *   4 apple-touch-icon >=120px / og:logo / og:image only when its filename
 *     says logo/brand
 *   5 favicon >=64px (SVG counts at any size)
 * Gstatic's guessed favicon is never produced here; callers keep whatever
 * guess they already hold.
 */
import { registrableDomain } from '../registries/shared';
import { extractOrganizationJsonLd } from '../registries/jsonld';

export type LogoVia =
  | 'json-ld' | 'header-logo' | 'wikidata' | 'apple-touch-icon' | 'og:logo' | 'og:image-logo' | 'favicon' | 'inline-svg';

export interface LogoCandidate {
  url: string;
  via: LogoVia;
  rank: number;
  svg: boolean;
  size: number;
}

export function tagAttr(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|[\\s<])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m?.[1] ?? m?.[2] ?? m?.[3] ?? null;
}

const MIN_PX = 64;

export function resolveUrl(raw: string | null, base: URL): string | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(raw.trim().replaceAll('&amp;', '&'), base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = '';
    return u.href;
  } catch { return null; }
}

const OWN_CDN_HOST = /(?:^|\.)(?:cloudfront\.net|squarespace-cdn\.com|squarespace\.com|wixstatic\.com|website-files\.com|webflow\.com|ctfassets\.net|sanity\.io|framerusercontent\.com|prismic\.io|cloudinary\.com|imgix\.net|bigcommerce\.com)$/i;

/** Same registrable domain as the page, or a known site-builder CDN the
 * homepage itself references (Shopify only for /s/files store assets). */
export function allowedHost(url: string, pageUrl: URL): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const own = registrableDomain(pageUrl.hostname);
  if (own && registrableDomain(u.hostname) === own) return true;
  if (/(?:^|\.)shopify\.com$/i.test(u.hostname) || /shopifycdn\.com$/i.test(u.hostname)) return /\/s\/files\//.test(u.pathname);
  return OWN_CDN_HOST.test(u.hostname);
}

function isShopify(url: string): boolean {
  return /\/cdn\/shop\/|cdn\.shopify\.com\/s\/files\//i.test(url);
}

/** Smallest dimension hinted by URL params or a -32x32 filename suffix. */
function urlDimension(url: string): number | null {
  let min: number | null = null;
  try {
    const u = new URL(url);
    for (const k of ['width', 'height', 'w', 'h']) {
      const v = Number(u.searchParams.get(k));
      if (v > 0) min = min === null ? v : Math.min(min, v);
    }
    const f = /(\d{2,4})x(\d{2,4})(?=\.[a-z]+$)/i.exec(u.pathname);
    if (f) { const v = Math.min(Number(f[1]), Number(f[2])); min = min === null ? v : Math.min(min, v); }
  } catch { /* ignore */ }
  return min;
}

/** Strip Shopify crop/height params and request a usable width. */
export function upsizeShopify(url: string): string {
  if (!isShopify(url)) return url;
  try {
    const u = new URL(url);
    u.searchParams.delete('crop');
    u.searchParams.delete('height');
    u.searchParams.set('width', '512');
    return u.href;
  } catch { return url; }
}

const TRACKING = /pixel|beacon|1x1|spacer|tracking|analytics|\/collect\b|doubleclick|facebook\.com\/tr/i;

// Review-site, award and compliance badges sit in headers next to the real
// mark and often say "logo" (Rillet's header carried G2's). Bounded by
// non-alphanumerics because filenames join words with _ and -.
const THIRD_PARTY_MARK = /(?:^|[^a-z0-9])(?:g2|g2crowd|capterra|getapp|trustpilot|trustradius|gartner|forrester|idc|soc-?2|soc_2|aicpa|gdpr|hipaa|iso-?27001|pci-?dss|ccpa|forbes|techcrunch|inc-?5000|deloitte|product-?hunt|ycombinator|y-?combinator|app-?store|google-?play|badge|award|rating|reviews?)(?:[^a-z0-9]|$)/i;

/** True when an image's own attributes name someone else's mark. */
export function isThirdPartyMark(hay: string): boolean {
  return THIRD_PARTY_MARK.test(hay.toLowerCase());
}

function isSvg(url: string): boolean {
  return /\.svg(?:[?#]|$)/i.test(url);
}

/** Returns a normalised URL or null when unusable (tiny, tracking, foreign).
 * `headDeclared` marks URLs the site's own <head> metadata names (icons,
 * og:logo, JSON-LD): the site chose them, so its separate CDN host is fine
 * (DJI serves every icon from djiits.com). Body images stay host-checked. */
function vet(url: string, pageUrl: URL, declared: number | null, headDeclared = false): { url: string; size: number } | null {
  if (TRACKING.test(url)) return null;
  if (!headDeclared && !allowedHost(url, pageUrl)) return null;
  const hinted = urlDimension(url);
  let out = url;
  if (hinted !== null && hinted < MIN_PX) {
    if (!isShopify(url)) return null;
    out = upsizeShopify(url);
  } else if (isShopify(url) && /[?&]crop=/i.test(url)) {
    out = upsizeShopify(url);
  }
  if (declared !== null && declared < MIN_PX && !isSvg(out)) return null;
  return { url: out, size: Math.max(declared ?? 0, hinted ?? 0) };
}

function largestSrcset(srcset: string | null): string | null {
  if (!srcset) return null;
  let best: { url: string; w: number } | null = null;
  for (const part of srcset.split(',')) {
    const [u, d] = part.trim().split(/\s+/);
    if (!u) continue;
    const w = d ? parseFloat(d) || 1 : 1;
    if (!best || w > best.w) best = { url: u, w };
  }
  return best?.url ?? null;
}

function declaredSize(sizes: string | null): number | null {
  if (!sizes || /any/i.test(sizes)) return null;
  let max = 0;
  for (const m of sizes.matchAll(/(\d+)x(\d+)/gi)) max = Math.max(max, Number(m[1]), Number(m[2]));
  return max || null;
}

function homeLinkRegions(html: string, pageUrl: URL): string[] {
  const out: string[] = [];
  const host = pageUrl.hostname.replace(/^www\./, '').replace(/\./g, '\\.');
  const homeHref = new RegExp(`href\\s*=\\s*["'](?:/|\\./|https?://(?:www\\.)?${host}/?)["']`, 'i');
  for (const m of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const open = /<a\b[^>]*>/i.exec(m[0])![0];
    if (homeHref.test(open)) out.push(m[0]);
  }
  return out;
}

function headerRegions(html: string, pageUrl: URL): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<(header|nav)\b[\s\S]*?<\/\1>/gi)) out.push(m[0]);
  return [...out, ...homeLinkRegions(html, pageUrl)];
}

/** The site's own name as it appears in asset names: "rillet" for www.rillet.com. */
function brandToken(pageUrl: URL): string | null {
  const label = (registrableDomain(pageUrl.hostname) ?? pageUrl.hostname).replace(/^www\./, '').split('.')[0] ?? '';
  return label.length >= 3 ? label.toLowerCase() : null;
}

/** Candidates in rank order, best first. */
export function collectLogoCandidates(html: string, pageUrl: URL): LogoCandidate[] {
  const found = new Map<string, LogoCandidate>();
  const push = (url: string | null, via: LogoVia, rank: number, declared: number | null) => {
    if (!url) return;
    const v = vet(url, pageUrl, declared, via !== 'header-logo');
    if (!v) return;
    const prior = found.get(v.url);
    if (prior && prior.rank <= rank) return;
    found.set(v.url, { url: v.url, via, rank, svg: isSvg(v.url), size: v.size });
  };

  // 1. JSON-LD
  const org = extractOrganizationJsonLd(html);
  if (org?.logo) push(resolveUrl(org.logo, pageUrl), 'json-ld', 1, null);

  // 2. header / nav / home-link <img> naming "logo". Headers also carry
  // customer and badge marks that say "logo" (Rillet: G2, Mercor, Temporal).
  // A site puts its own mark first; any later logo-like image must sit in the
  // home link or name the site itself.
  const seen = new Set<string>();
  const homeRegions = new Set(homeLinkRegions(html, pageUrl));
  const token = brandToken(pageUrl);
  for (const region of headerRegions(html, pageUrl)) {
    const inHomeLink = homeRegions.has(region);
    let firstLogoSeen = false;
    for (const m of region.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      if (seen.has(tag)) continue;
      seen.add(tag);
      const raw = [
        tagAttr(tag, 'data-src'), largestSrcset(tagAttr(tag, 'srcset')), largestSrcset(tagAttr(tag, 'data-srcset')),
        tagAttr(tag, 'src'),
      ].find((v) => v && !v.startsWith('data:')) ?? null;
      const hay = `${tagAttr(tag, 'class') ?? ''} ${tagAttr(tag, 'id') ?? ''} ${tagAttr(tag, 'alt') ?? ''} ${raw ?? ''}`;
      if (!/logo/i.test(hay)) continue;
      const first = !firstLogoSeen;
      firstLogoSeen = true;
      if (/partner|client|sponsor|footer-logo/i.test(hay) || isThirdPartyMark(hay)) continue;
      if (!first && !inHomeLink && !(token && hay.toLowerCase().includes(token))) continue;
      const w = Number(tagAttr(tag, 'width')) || null;
      const h = Number(tagAttr(tag, 'height')) || null;
      const declared = w && h ? Math.min(w, h) : w ?? h;
      push(resolveUrl(raw, pageUrl), 'header-logo', 2, declared && declared > 0 ? declared : null);
    }
  }

  // 4. apple-touch-icon / og:logo / og:image-if-logo-like; 5. favicon
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (tagAttr(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    const url = resolveUrl(tagAttr(tag, 'href'), pageUrl);
    if (!url) continue;
    const sizes = declaredSize(tagAttr(tag, 'sizes'));
    if (rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) {
      if (sizes === null || sizes >= 120) push(url, 'apple-touch-icon', 4, sizes ?? 180);
    } else if (rel.includes('icon')) {
      const type = (tagAttr(tag, 'type') ?? '').toLowerCase();
      const svg = type === 'image/svg+xml' || isSvg(url);
      if (/\.ico(?:[?#]|$)/i.test(url) && !svg) continue; // .ico size is unknowable; honest skip
      if (svg || (sizes !== null && sizes >= MIN_PX) || (sizes === null && isShopify(url))) {
        push(url, 'favicon', 5, svg ? null : sizes);
      }
    }
  }
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = (tagAttr(tag, 'property') ?? tagAttr(tag, 'name') ?? '').trim().toLowerCase();
    const url = resolveUrl(tagAttr(tag, 'content'), pageUrl);
    if (!url) continue;
    if (key === 'og:logo') push(url, 'og:logo', 4, null);
    else if (key === 'og:image' && /(?:^|[/_.-])(?:logo|brand|wordmark|logotype)/i.test(new URL(url).pathname.split('/').pop() ?? '')) {
      push(url, 'og:image-logo', 4, null);
    }
  }

  return [...found.values()].sort((a, b) => a.rank - b.rank || Number(b.svg) - Number(a.svg) || b.size - a.size);
}

/** Inline <svg> markup inside header/nav/home-link regions that names "logo". */
export function inlineHeaderSvgs(html: string, pageUrl: URL): string[] {
  const out: string[] = [];
  for (const region of headerRegions(html, pageUrl)) {
    for (const m of region.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
      const open = /<svg\b[^>]*>/i.exec(m[0])![0];
      const before = region.slice(Math.max(0, (m.index ?? 0) - 200), m.index ?? 0);
      if (isThirdPartyMark(`${open} ${/<title>([^<]*)<\/title>/i.exec(m[0])?.[1] ?? ''}`)) continue;
      if (/logo/i.test(open) || /logo/i.test(before)) out.push(m[0]);
    }
  }
  return out;
}

const MAX_INLINE_SVG_BYTES = 30_000;

/** Make a header <svg> safe and self-contained, or null when it cannot be. */
export function sanitizeInlineSvg(svg: string): string | null {
  if (/<use\b/i.test(svg) || /<image\b/i.test(svg)) return null; // external/sprite references
  let out = svg
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none')
    .replace(/currentColor/gi, '#111111');
  const open = /<svg\b[^>]*>/i.exec(out)?.[0];
  if (!open) return null;
  // Needs an intrinsic box to render as an <img>.
  if (!/\bviewBox\s*=/i.test(open) && !(/\bwidth\s*=/i.test(open) && /\bheight\s*=/i.test(open))) return null;
  if (!/\bxmlns\s*=/i.test(open)) out = out.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  out = out.replace(/\s+/g, ' ').trim();
  return new TextEncoder().encode(out).length <= MAX_INLINE_SVG_BYTES ? out : null;
}

/**
 * The site's own inline header logo as a self-contained data URI. Only an
 * <svg> inside header/nav/home-link whose aria-label/title/class/id names the
 * company or "logo" qualifies; third-party marks are already filtered.
 */
export function inlineLogoSvg(html: string, pageUrl: URL, name?: string): { svg: string; dataUri: string } | null {
  const wanted = (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const token = brandToken(pageUrl);
  for (const raw of inlineHeaderSvgs(html, pageUrl)) {
    const open = /<svg\b[^>]*>/i.exec(raw)![0];
    const hay = `${open} ${/<title[^>]*>([^<]*)<\/title>/i.exec(raw)?.[1] ?? ''}`.toLowerCase();
    const flat = hay.replace(/[^a-z0-9]+/g, '');
    const named = /logo/.test(hay) || (wanted.length >= 3 && flat.includes(wanted)) || (!!token && flat.includes(token));
    if (!named) continue;
    const svg = sanitizeInlineSvg(raw);
    if (svg) return { svg, dataUri: `data:image/svg+xml,${encodeURIComponent(svg)}` };
  }
  return null;
}
