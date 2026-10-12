/**
 * Brand asset resolver: a ranked logo ladder plus real-colour extraction,
 * both fed by the homepage HTML the asset lane already fetched.
 *
 * Product law: no fabrication. A logo is returned only from the company's own
 * markup (or its own CDN), or from a Wikidata entry verified by domain.
 * Colours come only from the site's markup or the chosen logo; when nothing
 * is found the theme is null and the caller keeps source:'default'.
 */
import type { OriginalSourceReceipt } from '../original-source';
import { wikidataSource } from '../registries/wikidata';
import { extractOrganizationJsonLd, wikidataQidFromUrl } from '../registries/jsonld';
import { registrableDomain } from '../registries/shared';
import { pickRoles } from './color';
import {
  htmlSignals, rasterLogoPalette, svgLogoPalette, type ColorSignal, type SignalPalette,
} from './colors';
import { collectLogoCandidates, inlineHeaderSvgs, inlineLogoSvg, tagAttr, type LogoCandidate, type LogoVia } from './logo-candidates';

export type { LogoVia } from './logo-candidates';

export interface ScrapedBrandColors {
  primary: string;
  secondary: string;
  accent: string;
  /** Which signal supplied the primary colour. */
  signal: ColorSignal;
}

export interface BrandResolution {
  logo: { url: string; via: LogoVia; sourceUrl: string; retrievedAt: string } | null;
  colors: ScrapedBrandColors | null;
}

export interface BrandOptions {
  read: (url: string) => Promise<OriginalSourceReceipt>;
  fetchImpl?: typeof fetch;
  /** Company name — only used to seed the Wikidata search; domain decides. */
  name?: string;
  /** Test seam / override: returns a domain-verified Wikidata logo URL or null. */
  wikidataLogo?: (identity: { name: string; domain: string; qid: string | null }) => Promise<string | null>;
  /** Skip the Wikidata rung (e.g. offline). */
  skipWikidata?: boolean;
}

function pageBase(websiteUrl: string): URL | null {
  try {
    const url = new URL(websiteUrl.includes('://') ? websiteUrl : `https://${websiteUrl}`);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

async function defaultWikidataLogo(
  identity: { name: string; domain: string; qid: string | null },
  fetchImpl: typeof fetch | undefined,
): Promise<string | null> {
  const result = await wikidataSource.lookup(
    { name: identity.name, domain: identity.domain, wikidataQid: identity.qid },
    { fetchImpl: fetchImpl ?? fetch },
  );
  return result.status === 'matched' ? (result.enrichment.logoUrl ?? null) : null;
}

function siteName(html: string, host: string): string {
  const org = extractOrganizationJsonLd(html);
  if (org?.name) return org.name;
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    if ((tagAttr(m[0], 'property') ?? '').toLowerCase() === 'og:site_name') {
      const v = tagAttr(m[0], 'content');
      if (v) return v;
    }
  }
  return host.replace(/^www\./, '').split('.')[0] ?? host;
}

/** Pure ladder: HTML in, ordered candidates out (Wikidata handled by caller). */
export { collectLogoCandidates };

export async function resolveBrand(websiteUrl: string, opts: BrandOptions): Promise<BrandResolution> {
  const empty: BrandResolution = { logo: null, colors: null };
  const base = pageBase(websiteUrl);
  if (!base) return empty;
  const home = await opts.read(base.href).catch(() => null);
  const ok = home?.status === 'retrieved' && !!home.text;
  let pageUrl = base;
  try { if (home?.finalUrl ?? home?.requestedUrl) pageUrl = new URL((home!.finalUrl ?? home!.requestedUrl)!); } catch { /* keep base */ }
  const html = ok ? home!.text! : '';
  const retrievedAt = home?.retrievedAt ?? new Date().toISOString();

  const candidates: LogoCandidate[] = html ? collectLogoCandidates(html, pageUrl) : [];
  let chosen: { url: string; via: LogoVia } | null = null;
  const early = candidates.find((c) => c.rank <= 2);
  if (early) chosen = early;

  if (!chosen && !opts.skipWikidata) {
    const domain = registrableDomain(pageUrl.hostname);
    if (domain) {
      const qid = html ? (extractOrganizationJsonLd(html)?.sameAs ?? []).map(wikidataQidFromUrl).find(Boolean) ?? null : null;
      const name = opts.name ?? siteName(html, pageUrl.hostname);
      const lookup = opts.wikidataLogo ?? ((id) => defaultWikidataLogo(id, opts.fetchImpl));
      const url = await lookup({ name, domain, qid }).catch(() => null);
      if (url) chosen = { url, via: 'wikidata' };
    }
  }
  // The site's own inline header <svg> (sharp at any size) beats apple-touch /
  // favicon rungs; og:image is never a logo unless its filename says so.
  let inlineSvg: { svg: string; dataUri: string } | null = null;
  if (!chosen && html) {
    inlineSvg = inlineLogoSvg(html, pageUrl, opts.name);
    if (inlineSvg) chosen = { url: inlineSvg.dataUri, via: 'inline-svg' };
  }
  if (!chosen) {
    const late = candidates.find((c) => c.rank >= 4);
    if (late) chosen = late;
  }

  const signals: SignalPalette[] = html ? htmlSignals(html, inlineHeaderSvgs(html, pageUrl)) : [];
  if (chosen) {
    let sig: SignalPalette | null = null;
    if (inlineSvg && chosen.url === inlineSvg.dataUri) {
      sig = svgLogoPalette(inlineSvg.svg);
    } else if (/\.svg(?:[?#]|$)/i.test(chosen.url)) {
      const receipt = await opts.read(chosen.url).catch(() => null);
      let text = receipt?.status === 'retrieved' && receipt.text && /<svg\b/i.test(receipt.text) ? receipt.text : null;
      if (!text) {
        try {
          const res = await (opts.fetchImpl ?? fetch)(chosen.url, { mode: 'cors' });
          if (res.ok) text = await res.text();
        } catch { /* CORS or network — skip honestly */ }
      }
      sig = text ? svgLogoPalette(text) : null;
    } else {
      sig = await rasterLogoPalette(chosen.url, opts.fetchImpl);
    }
    if (sig) signals.push(sig);
  }

  let colors: ScrapedBrandColors | null = null;
  const picked = pickRoles(signals.map((s) => s.palette));
  if (picked) {
    const owner = signals.find((s) => s.palette.some((e) => e.hex === picked.colors.primary));
    colors = {
      ...picked.colors,
      signal: owner?.signal ?? 'theme-color',
    };
  }

  return {
    logo: chosen ? { url: chosen.url, via: chosen.via, sourceUrl: pageUrl.href, retrievedAt } : null,
    colors,
  };
}
