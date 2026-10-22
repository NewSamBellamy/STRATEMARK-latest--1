import { useState, type CSSProperties } from 'react';
import { ownershipLabel, type CardWithCompany } from '@mi/contracts';
import { clampForChrome, deriveTriad } from '@/lib/brand';
import { buildCardView, type CardView } from './card-view';
import { Logo } from './Logo';

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
}: {
  data: CardWithCompany;
  view?: CardView;
  logoRetryNonce?: number;
  logoUrlOverride?: string | null;
  onLogoAvailabilityChange?: (available: boolean) => void;
}) {
  const artwork = DEFAULT_CARD_ART[data.card.cardType];
  const companyKey = data.company?.id ?? view.title;
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
  // The frame wears the logo's colours: two-tone when the logo has two or more, the brand colour and a
  // deeper shade of it when it has one. A third colour becomes the thin inner stripe. No logo colours, no
  // brand frame: the card keeps its standard border.
  const frame = logoPalette.length > 0 ? {
    '--card-c1': clampForChrome(logoPalette[0]!),
    '--card-c2': logoPalette[1] ? clampForChrome(logoPalette[1]) : `color-mix(in srgb, ${clampForChrome(logoPalette[0]!)} 70%, #0b1512)`,
    ...(logoPalette[2] ? { '--card-c3': clampForChrome(logoPalette[2]) } : {}),
  } : null;
  const stage = view.position;
  const complete = view.faceMetrics.length > 0 &&
    view.faceMetrics.every((m) => (m.metric?.value != null || m.metric?.reportedBand != null) && (m.citations.length > 0 || m.metric?.confidence === 'user_verified'));
  const provenance = view.sourceCount > 0
    ? `${view.sourceCount} ${view.sourceCount === 1 ? 'source' : 'sources'} tracked`
      : 'Research needed';

  return (
    <div
      className={`collectible ${view.signal || artwork ? 'collectible--signal' : ''} ${!view.signal && complete ? 'collectible--foil' : ''} ${frame ? 'collectible--brand' : ''}`}
      style={{ '--card-accent': accent, '--card-highlight': frame ? frame['--card-c2'] : highlight, ...frame } as CSSProperties}
      data-brand-colors={logoPalette.length > 0 ? logoPalette.join(' ') : undefined}
      data-testid="collectible-card-front"
    >
      <div className="collectible__paper">
        <div className="collectible__edition">
          <span>STRATEMARK</span>
        </div>
        <div className="collectible__art" aria-hidden="true">
          {view.signal || artwork ? (
            <div className="collectible__signal-art">
              <MarketCardArt type={data.card.cardType} />
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
          <span>{stage}</span>
          <span>{provenance}</span>
        </div>
      </div>
      <div className="collectible__foil" aria-hidden="true" />
    </div>
  );
}
