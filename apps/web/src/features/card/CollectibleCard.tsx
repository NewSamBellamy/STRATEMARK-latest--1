import type { CSSProperties } from 'react';
import type { CardWithCompany } from '@mi/contracts';
import { buildCardView, type CardView } from './card-view';
import { Logo } from './Logo';
import { MarketCardArt } from './MarketCardArt';
import './collectible.css';
import { contrastRatio } from '@/lib/brand';

const PALETTES = ['#466b61', '#6b5f76', '#8a6b4e', '#4d667c', '#7e5b58', '#5d7455'];

/** One evidence-led collectible face. Deeper research belongs in the inspector. */
export function CollectibleCard({
  data,
  view = buildCardView(data),
}: {
  data: CardWithCompany;
  view?: CardView;
}) {
  const hash = Array.from(view.title).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
  const brand = ['scraped', 'manual'].includes(data.company?.brandTheme?.source ?? '')
    ? data.company?.brandTheme
    : null;
  const color = (value: string | undefined, fallback: string) =>
    value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  const accent = color(brand?.primary, PALETTES[hash % PALETTES.length]!);
  // The hero is pale paper, not a brand-colored surface. Preserve the palette
  // but use editorial ink when its accent would make an offline mark disappear.
  const markInk = contrastRatio(accent, '#d2d0c8') >= 4.5 ? accent : '#1c2b28';
  const highlight = color(brand?.accent, accent);
  const stage = data.evidenceState === 'legacy_unreviewed' ? 'Saved profile' : view.position;
  const asOf = view.latestCapturedAt
    ? new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(view.latestCapturedAt)
    : null;
  const provenance =
    view.citations.length > 0
      ? `${view.citations.length} ${view.citations.length === 1 ? 'source' : 'sources'}${asOf ? ` · ${asOf}` : ''}`
      : data.evidenceState === 'legacy_unreviewed'
        ? 'Unreviewed'
        : 'Research needed';

  return (
    <div
      className={`collectible ${view.signal ? 'collectible--signal' : ''}`}
      style={
        {
          '--card-accent': accent,
          '--card-highlight': highlight,
          '--card-mark-ink': markInk,
        } as CSSProperties
      }
      data-testid="collectible-card-front"
    >
      <div className="collectible__paper">
        <div className="collectible__edition">
          <span>STRATEMARK / RESEARCH</span>
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
                website={
                  data.evidenceState === 'legacy_unreviewed' ? null : data.company?.websiteUrl
                }
                bare
                logoUrl={data.company?.logoUrl}
                className="h-full w-full"
              />
            </div>
          )}
          <span className="collectible__art-label">{view.type}</span>
        </div>
        <div className="collectible__identity">
          <span className="collectible__eyebrow">
            {data.marketRoles?.join(' · ') || data.company?.hqLocation || view.type}
          </span>
          <span className="collectible__name">{view.title}</span>
          {view.description && <p className="collectible__description">{view.description}</p>}
        </div>
        {data.evidenceState === 'legacy_unreviewed' ? (
          <div className="collectible__signal-copy">
            <span className="collectible__eyebrow">Legacy research</span>
            <p>Not revalidated</p>
          </div>
        ) : view.signal ? (
          <div className="collectible__signal-copy">
            <span className="collectible__eyebrow">
              {data.card.cardType === 'vice' ? 'Risk finding' : 'Market finding'}
            </span>
            <p>
              {data.card.evidencePoints?.[0]?.text ||
                'Open to inspect this finding and its sources.'}
            </p>
          </div>
        ) : view.faceMetrics.length ? (
          <div className="collectible__metrics">
            {view.faceMetrics.map((m) => (
              <div key={m.metric.id}>
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
    </div>
  );
}
