import { useState, type CSSProperties } from 'react';
import { ownershipLabel, type CardWithCompany } from '@mi/contracts';
import { clampForChrome, deriveTriad } from '@/lib/brand';
import { buildCardView, type CardView } from './card-view';
import { faceFooter } from './faceFooter';
import { Logo } from './Logo';
import { useSignalHero } from './useSignalHero';
import { recordImage } from '@/lib/media/imageAudit';
import { DEFAULT_CARD_SKIN, inkFor, type CardSkin } from './card-skin';
import { coverSpec } from '@/features/markets/coverArt';

import { DEFAULT_CARD_ART, MarketCardArt } from './MarketCardArt';
import './collectible.css';

export const SIGNAL_FINDING_LABEL = {
  culture: 'Why it matters',
  vice: 'Risk signal',
  insight: 'Market evidence',
  barrier: 'Barrier evidence',
} as const;

/** One evidence-led collectible face. Deeper research belongs in the inspector. */
export function CollectibleCard({
  data,
  view = buildCardView(data),
  logoRetryNonce,
  logoUrlOverride,
  onLogoAvailabilityChange,
  skin = DEFAULT_CARD_SKIN,
}: {
  data: CardWithCompany;
  view?: CardView;
  logoRetryNonce?: number;
  logoUrlOverride?: string | null;
  onLogoAvailabilityChange?: (available: boolean) => void;
  /** Frame skin for where the card lives: deck (split, default), Saved (foil), Today (acrylic). */
  skin?: CardSkin;
}) {
  const artwork = DEFAULT_CARD_ART[data.card.cardType];
  const companyKey = data.company?.id ?? view.title;
  // A signal card's hero is the picture its own source published; the default art holds until one loads.
  const [heroRef, hero] = useSignalHero(data, Boolean(view.signal));
  const [heroFailed, setHeroFailed] = useState<string | null>(null);
  const heroShown = hero && heroFailed !== hero.src ? hero : null;
  const [extractedBrand, setExtractedBrand] = useState<{ key: string; colors: string[] } | null>(null);
  // The brand's own colours, read from its logo (one to three, most present first).
  const logoPalette = !artwork && !view.signal && extractedBrand?.key === companyKey ? extractedBrand.colors : [];
  const logoColor = logoPalette[0] ?? null;
  const brand = ['scraped', 'manual'].includes(data.company?.brandTheme?.source ?? '')
    ? data.company?.brandTheme
    : null;
  const triad = deriveTriad(brand ?? null, logoColor);
  const hasBrandEvidence = Boolean(logoColor || brand?.primary);
  const accent = artwork
    ? artwork.accent
    : hasBrandEvidence
      ? triad.primary
      : '#46524e';
  const highlight = artwork
    ? artwork.highlight
    : hasBrandEvidence
      ? triad.accent
      : '#6a756f';
  // The frame is the brand's primary-to-secondary gradient. The logo's own colours lead when they could be
  // read; a logo that blocks pixel reads falls back to the researched brand theme, so every branded card
  // gets the frame. A single known colour gets the researched secondary, else a deeper shade of itself.
  // A third logo colour becomes the thin inner stripe. No brand evidence at all keeps the standard border.
  const themedSecondary = brand?.secondary && /^#[0-9a-f]{6}$/i.test(brand.secondary) ? brand.secondary : null;
  const framePrimary = logoPalette[0] ?? (brand?.primary ? triad.primary : null);
  const frameSecondary = logoPalette[1]
    ?? (themedSecondary && themedSecondary.toLowerCase() !== (logoPalette[0] ?? brand?.primary ?? '').toLowerCase()
      ? themedSecondary
      : null);
  const frame = framePrimary ? {
    '--card-c1': clampForChrome(framePrimary),
    '--card-c2': frameSecondary ? clampForChrome(frameSecondary) : `color-mix(in srgb, ${clampForChrome(framePrimary)} 70%, #0b1512)`,
    ...(logoPalette[2] ? { '--card-c3': clampForChrome(logoPalette[2]) } : {}),
  } : null;
  const footer = faceFooter(data);
  const complete = view.faceMetrics.length > 0 &&
    view.faceMetrics.every((m) => (m.metric?.value != null || m.metric?.reportedBand != null) && (m.citations.length > 0 || m.metric?.confidence === 'user_verified'));

  return (
    <div
      ref={heroRef}
      className={`collectible ${view.signal || artwork ? 'collectible--signal' : ''} ${!view.signal && complete ? 'collectible--foil' : ''} ${frame ? 'collectible--brand' : ''} collectible--skin-${skin}`}
      style={{ '--card-accent': accent, '--card-highlight': frame ? frame['--card-c2'] : highlight, ...frame, ...(frame ? { '--card-ink': inkFor(frame['--card-c1']), '--card-ink2': inkFor(frameSecondary ? frame['--card-c2'] : null) } : {}) } as CSSProperties}
      data-brand-colors={logoPalette.length > 0 ? logoPalette.join(' ') : framePrimary ? [framePrimary, frameSecondary].filter(Boolean).join(' ') : undefined}
      data-testid="collectible-card-front"
    >
      {skin === 'acrylic' && (
        <div className="collectible__label" aria-hidden="true">
          <span className="collectible__lmark">
            {!view.signal && <Logo name={view.title} website={data.company?.websiteUrl} bare logoUrl={logoUrlOverride ?? data.company?.logoUrl} className="h-full w-full" />}
          </span>
          <span className="collectible__ltext"><b>{view.frontTitle}</b><small>{view.type}</small></span>
          <span className="collectible__lno">STRATEMARK<em>No.{String(coverSpec(data.card.id).ordinal).padStart(2, '0')}</em></span>
        </div>
      )}
      <div className="collectible__paper">
        <div className="collectible__edition">
          <span>STRATEMARK</span>
        </div>
        <div className="collectible__art" aria-hidden="true">
          {view.signal || artwork ? (
            <div className="collectible__signal-art">
              {heroShown ? (
                <>
                  <img src={heroShown.src} className="h-full w-full object-cover" alt="" draggable={false} loading="lazy"
                    referrerPolicy="no-referrer" data-testid="signal-hero"
                    onLoad={() => recordImage('signal-hero', 'loaded', heroShown.src)}
                    onError={() => { recordImage('signal-hero', 'fallback', heroShown.src); setHeroFailed(heroShown.src); }} />
                  {heroShown.credit && <span className="collectible__hero-credit">{heroShown.credit}</span>}
                </>
              ) : <MarketCardArt type={data.card.cardType} />}
            </div>
          ) : (
            <div className="collectible__brand">
              <Logo
                name={view.title}
                website={data.company?.websiteUrl}
                bare
                logoUrl={logoUrlOverride ?? data.company?.logoUrl}
                retryNonce={logoRetryNonce}
                onPalette={(colors) => setExtractedBrand({ key: companyKey, colors })}
                onAvailabilityChange={onLogoAvailabilityChange}
                className="h-full w-full"
              />
            </div>
          )}
          {!view.signal && <span className="collectible__art-label">{view.type}</span>}
        </div>
        <div className="collectible__identity">
          <span className="collectible__eyebrow">
            {view.signal ? view.type : data.company?.hqLocation?.trim() || 'Location unknown'}
            {!view.signal && ownershipLabel(data.company?.ownership) && <> · {ownershipLabel(data.company?.ownership)}</>}
          </span>
          <span className="collectible__name">{view.frontTitle}</span>
          {view.frontDescription && <p className="collectible__description">{view.frontDescription}</p>}
        </div>
        {view.signal && view.frontFinding ? (
          <div className="collectible__signal-copy">
            <span className="collectible__eyebrow">
              {SIGNAL_FINDING_LABEL[data.card.cardType as keyof typeof SIGNAL_FINDING_LABEL] ?? 'Research finding'}
            </span>
            <p>{view.frontFinding}</p>
          </div>
        ) : view.faceMetrics.length ? (
          <div className="collectible__metrics">
            {view.faceMetrics.map((m) => (
              <div
                key={`${m.key}-${m.label}`}
                className={m.metric?.value == null && m.metric?.reportedBand == null ? 'collectible__metric--unknown' : undefined}
              >
                <span className="collectible__metric-value">{m.display}</span>
                <span className="collectible__metric-label">{m.label}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="collectible__footer">
          <span>{footer.lead}</span>
          <span>{footer.updated}</span>
        </div>
      </div>
      <div className="collectible__foil" aria-hidden="true" />
    </div>
  );
}
