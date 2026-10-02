import { useState, type CSSProperties } from 'react';
import type { CardWithCompany } from '@mi/contracts';
import { deriveTriad } from '@/lib/brand';
import { buildCardView, type CardView } from './card-view';
import { Logo } from './Logo';
import { DEFAULT_CARD_ART, MarketCardArt } from './MarketCardArt';
import './collectible.css';

const SIGNAL_FINDING_LABEL = {
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
  const [extractedBrand, setExtractedBrand] = useState<{ key: string; color: string } | null>(null);
  const logoColor = extractedBrand?.key === companyKey ? extractedBrand.color : null;
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
  const stage = view.maturity?.label ?? view.position;
  const provenance = view.sourceCount > 0
    ? `${view.sourceCount} ${view.sourceCount === 1 ? 'source' : 'sources'} tracked`
      : 'Research needed';

  return (
    <div
      className={`collectible ${view.signal || artwork ? 'collectible--signal' : ''} ${view.maturity && view.maturity.tier >= 7 && view.sourcedCount >= 2 ? 'collectible--foil' : ''}`}
      style={{ '--card-accent': accent, '--card-highlight': highlight } as CSSProperties}
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
                onColor={(color) => setExtractedBrand({ key: companyKey, color })}
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
        ) : view.profileMetrics.length ? (
          <div className="collectible__metrics">
            {view.profileMetrics.map((m) => (
              <div
                key={m.key}
                className={m.metric?.value == null ? 'collectible__metric--unknown' : undefined}
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
