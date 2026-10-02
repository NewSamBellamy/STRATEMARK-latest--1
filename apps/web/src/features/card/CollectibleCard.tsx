import type { CSSProperties } from 'react';
import type { CardWithCompany } from '@mi/contracts';
import { buildCardView, type CardView } from './card-view';
import { Logo } from './Logo';
import { MarketCardArt } from './MarketCardArt';
import './collectible.css';

const PALETTES = ['#466b61', '#6b5f76', '#8a6b4e', '#4d667c', '#7e5b58', '#5d7455'];

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
  const hash = Array.from(view.title).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
  const brand = ['scraped', 'manual'].includes(data.company?.brandTheme?.source ?? '')
    ? data.company?.brandTheme
    : null;
  const color = (value: string | undefined, fallback: string) =>
    value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  const accent = color(brand?.primary, PALETTES[hash % PALETTES.length]!);
  const highlight = color(brand?.accent, accent);
  const serial = hash.toString(16).slice(-4).toUpperCase().padStart(4, '0');
  const stage = view.maturity?.label ?? view.position;
  const provenance = view.signal
    ? `${view.citations.length} ${view.citations.length === 1 ? 'source' : 'sources'}`
    : view.sourcedCount > 0
      ? `${view.sourcedCount} sourced ${view.sourcedCount === 1 ? 'fact' : 'facts'}`
      : 'Research needed';

  return (
    <div
      className={`collectible ${view.signal ? 'collectible--signal' : ''} ${view.maturity && view.maturity.tier >= 7 && view.sourcedCount >= 2 ? 'collectible--foil' : ''}`}
      style={{ '--card-accent': accent, '--card-highlight': highlight } as CSSProperties}
      data-testid="collectible-card-front"
    >
      <div className="collectible__paper">
        <div className="collectible__edition">
          <span>STRATEMARK / RESEARCH</span>
          <span>{serial}</span>
        </div>
        <div className="collectible__art" aria-hidden="true">
          {view.signal ? (
            <div className="collectible__signal-art">
              <MarketCardArt type={data.card.cardType} seed={view.title} />
            </div>
          ) : (
            <div className="collectible__brand">
              <Logo
                name={view.title}
                website={data.company?.websiteUrl}
                bare
                logoUrl={logoUrlOverride ?? data.company?.logoUrl}
                retryNonce={logoRetryNonce}
                onAvailabilityChange={onLogoAvailabilityChange}
                className="h-full w-full"
              />
            </div>
          )}
          <span className="collectible__art-label">{view.type}</span>
          <span className="collectible__art-index">FIELD NOTE / {serial}</span>
        </div>
        <div className="collectible__identity">
          <span className="collectible__eyebrow">
            {view.signal ? view.type : data.company?.hqLocation?.trim() || 'Location unknown'}
          </span>
          <span className="collectible__name">{view.title}</span>
          {view.description && <p className="collectible__description">{view.description}</p>}
        </div>
        {view.signal ? (
          <div className="collectible__signal-copy">
            <span className="collectible__eyebrow">
              {data.card.cardType === 'vice' ? 'Risk finding' : 'Market finding'}
            </span>
            <p>
              {data.card.keyPoints[0] || 'Open the card to inspect the finding and its evidence.'}
            </p>
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
                <span className="collectible__confidence">{m.confidence}</span>
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
