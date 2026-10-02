import { useEffect, useMemo, useState } from 'react';
import { knownCompanyDomain, knownCompanyLogoUrl } from '@mi/research';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';

/** Extract a clean root domain from a URL/host. */
function domainOf(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const host = website.includes('://') ? new URL(website).hostname : website.trim();
    const domain = host.replace(/^www\./, '').toLowerCase();
    // RFC 2606 reserved domains are placeholders (used by the demo dataset) —
    // icon services serve generic globes for them, so treat as "no site".
    if (/(^|\.)example\.(com|org|net)$/.test(domain) || domain.endsWith('.test') || domain.endsWith('.invalid')) {
      return null;
    }
    return domain || null;
  } catch {
    return null;
  }
}

/**
 * Hero-logo quality thresholds.
 *
 * Logo services return wildly different resolutions for the same mark — 256px
 * for one company, a 32px browser favicon for another. Two consequences we have
 * to engineer around:
 *
 *  1. Taking the FIRST source that loads means a 32px favicon can beat a 400px
 *     logo that was one position further down the chain → blurry hero art. So we
 *     probe for the BEST available resolution instead, stopping early once a
 *     source is clearly good enough.
 *  2. Rendering every winner at the same box size makes the deck look broken
 *     (crisp 256px marks filling the window next to postage stamps). So the
 *     footprint scales with the resolution we actually got, kept inside a narrow
 *     band so the grid still reads as one set.
 *
 * Below MIN_USABLE_PX it isn't brand art at all — it's a tab icon — and the
 * designed lettermark plate beats an upscaled smear.
 */
const GOOD_ENOUGH_PX = 96;
const MIN_USABLE_PX = 24;
/** Below this the mark can't fill the window without visible blur. */
const CRISP_PX = 64;
/** Hard ceiling on upscaling — past ~2x, raster marks turn to mush. */
const MAX_UPSCALE = 2;

/**
 * How much of the square art window a 1:1 mark occupies. Everything else is
 * fitted to the SAME optical area rather than the same bounding box.
 *
 * This is the part that makes a square window work. Real logos run from 1:1
 * icons to 6:1 wordmarks, and fitting both to a shared box means one of them
 * always loses: fit by width and the icon shrinks to a stamp, fit by height and
 * the wordmark overruns. Equal *area* is how identity designers normalise a
 * mixed logo set, and it's what keeps a deck reading as one printed set.
 */
const TARGET_FILL = 0.74;

/** Box for a mark of the given proportions, as a share of the square window. */
function fitToSquare(natural: { width: number; height: number }): {
  width: string;
  height: string;
} {
  const ratio = natural.width > 0 && natural.height > 0 ? natural.width / natural.height : 1;
  const s = Math.sqrt(ratio);
  return {
    width: `${Math.min(100, TARGET_FILL * s * 100).toFixed(1)}%`,
    height: `${Math.min(100, (TARGET_FILL / s) * 100).toFixed(1)}%`,
  };
}

interface Candidate {
  src: string;
  width: number;
  height: number;
  /** Vector art is sharp at ANY size, so resolution heuristics don't apply. */
  vector: boolean;
}

const isSvg = (src: string): boolean => /\.svg(\?|$)|image\/svg/i.test(src);

/** Load an image off-screen just to learn whether it exists and how big it is. */
function probe(src: string): Promise<Candidate | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () =>
      resolve(
        img.naturalWidth > 0
          ? {
              src,
              width: img.naturalWidth,
              height: img.naturalHeight,
              vector: isSvg(src),
            }
          : null,
      );
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Real company logo, resolved for free with no API key. Walks the source chain
 * and keeps the highest-resolution hit (short-circuiting once one is clearly
 * sharp enough), so hero art is as crisp as the open web allows.
 */
export function Logo({
  name,
  website,
  className,
  onColor,
  bare = false,
  retryNonce = 0,
  logoUrl,
  onAvailabilityChange,
}: {
  name: string;
  website: string | null | undefined;
  /**
   * Logo resolved during the research pass (Wikidata/Commons vector art where
   * available) and stored on the company. When present it's tried FIRST, which
   * is what collapses per-card probing from ~3 requests to 1 (audit 2.2).
   */
  logoUrl?: string | null;
  className?: string;
  /** Fires with the logo's dominant color when extraction succeeds (CORS-permitting). */
  onColor?: (hex: string) => void;
  /** Render without the chip chrome (used inside the card's hero window). */
  bare?: boolean;
  /** Bump to re-walk the source chain with fresh (cache-busted) requests. */
  retryNonce?: number;
  /** Lets the card show a retry control only after every candidate has failed. */
  onAvailabilityChange?: (available: boolean) => void;
}) {
  const heroThreshold = knownCompanyDomain(name) === 'minimax.io' ? 32 : CRISP_PX;
  const sources = useMemo(() => {
    const bust = retryNonce > 0 ? `r=${retryNonce}` : '';
    const q = (sep: string) => (bust ? `${sep}${bust}` : '');
    // Pre-resolved art wins: it was chosen at research time from a trusted
    // source and is usually vector, so there's nothing better to look for.
    const preferredLogo = knownCompanyLogoUrl(name) ?? logoUrl;
    const preferred = preferredLogo ? [preferredLogo + (bust ? (preferredLogo.includes('?') ? `&${bust}` : `?${bust}`) : '')] : [];
    // A reviewed alias beats a model-researched URL. The latter may point at a
    // product, regional site, or similarly named company and return the wrong mark.
    const domain = knownCompanyDomain(name) ?? domainOf(website);
    if (!domain) return preferred;
    // NOTE: icon.horse is deliberately absent (returns its own grey placeholder
    // with HTTP 200) and gstatic runs WITHOUT fallback_opts (so it 404s instead
    // of serving a default globe). Sources must fail honestly — a generic
    // placeholder poisons both the hero and the brand-color extraction.
    return [
      ...preferred,
      `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&url=https://${domain}&size=256${q('&')}`,
      `https://unavatar.io/${domain}?fallback=false${q('&')}`,
      `https://icons.duckduckgo.com/ip3/${domain}.ico${q('?')}`,
    ];
  }, [website, retryNonce, logoUrl, name]);

  const [best, setBest] = useState<Candidate | null>(null);
  const [settled, setSettled] = useState(false);
  const key = sources.join('|');

  useEffect(() => {
    setBest(null);
    setSettled(false);
    if (sources.length === 0) {
      setSettled(true);
      onAvailabilityChange?.(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      let winner: Candidate | null = null;
      for (const src of sources) {
        const hit = await probe(src);
        if (cancelled) return;
        if (hit && (!winner || hit.vector || hit.width > winner.width)) {
          winner = hit;
          setBest(winner);
          // Vector wins outright; raster only if it's already sharp enough.
          if (hit.vector || hit.width >= GOOD_ENOUGH_PX) break;
        }
      }
      if (!cancelled) {
        setSettled(true);
        onAvailabilityChange?.(Boolean(winner && (winner.vector || winner.width >= (bare ? heroThreshold : MIN_USABLE_PX))));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, bare, heroThreshold, onAvailabilityChange]);

  // Brand-color extraction runs on the winning source only.
  useEffect(() => {
    if (!onColor || !best || best.width < MIN_USABLE_PX) return;
    let cancelled = false;
    void import('@/lib/extractColor').then(({ extractDominantColor }) =>
      extractDominantColor(best.src).then((hex) => {
        if (!cancelled && hex) onColor(hex);
      }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [best?.src]);

  const usable = best && (best.vector || best.width >= (bare ? heroThreshold : MIN_USABLE_PX)) ? best : null;

  return (
    <div
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden font-display font-bold text-content',
        bare ? 'text-2xl' : 'game-card__logo rounded-xl text-sm',
        className,
      )}
    >
      {usable ? (
        <img
          src={usable.src}
          alt={`${name} logo`}
          className={cn('object-contain', bare ? 'p-1' : 'h-full w-full p-1.5')}
          style={
            bare
              ? {
                  ...fitToSquare(usable),
                  // Raster art may not be upscaled past its honest resolution,
                  // whichever constraint bites first.
                  maxWidth: usable.vector ? undefined : usable.width * MAX_UPSCALE,
                  maxHeight: usable.vector ? undefined : usable.height * MAX_UPSCALE,
                }
              : undefined
          }
          referrerPolicy="no-referrer"
        />
      ) : !settled ? (
        // Probing — hold the space so cards don't jump as art resolves.
        <span aria-hidden className="block h-full w-full" />
      ) : bare ? (
        // A designed lettermark plate is preferable to stretching a tiny favicon.
        <span
          aria-label={`${name} monogram`}
          className="collectible__monogram"
        >
          {initials(name)}
        </span>
      ) : (
        <span aria-label={`${name} monogram`}>{initials(name)}</span>
      )}
    </div>
  );
}
