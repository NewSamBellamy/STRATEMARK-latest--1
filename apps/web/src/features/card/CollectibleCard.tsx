import type { CSSProperties } from 'react';
import { isSignalCardType, usableCitations, type CardWithCompany } from '@mi/contracts';
import { buildCardView, sourceUrl, type CardView } from './card-view';
import { Logo } from './Logo';
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
  const { card, company } = data;
  const finding = isSignalCardType(card.cardType);
  const unreviewed = data.evidenceState === 'legacy_unreviewed';
  const type = card.cardType === 'culture' ? 'Community' : view.type;
  const evidence = card.evidencePoints?.find(
    (point) =>
      usableCitations(point.citations.filter((citation) => sourceUrl(citation.url))).length > 0,
  );
  const viceClaim = data.viceClaims.find((claim) => sourceUrl(claim.sourceUrl));
  // Findings own their support. Associated company figures never establish a story.
  const citations = finding
    ? usableCitations([
        ...(card.citations ?? []).filter((citation) => sourceUrl(citation.url)),
        ...(card.evidencePoints ?? []).flatMap((point) =>
          point.citations.filter((citation) => sourceUrl(citation.url)),
        ),
        ...(card.cardType === 'vice' && viceClaim
          ? [{ url: viceClaim.sourceUrl, title: viceClaim.sourceTitle ?? '' }]
          : []),
      ])
    : view.citations;
  const unsupportedVice = card.cardType === 'vice' && (unreviewed || citations.length === 0);
  const title = unsupportedVice
    ? 'Risk finding needs review'
    : finding
      ? card.title || view.title
      : view.title;
  const description = unsupportedVice ? null : finding ? card.summary : view.description;
  const contextLabel = {
    company: 'Market relevance',
    infrastructure: 'What it enables',
    distribution: 'Audience & access',
    culture: 'Public activity',
    vice: 'Attributed event',
    insight: 'Supporting observation',
    barrier: 'Entry requirement',
  }[card.cardType];
  const context = unreviewed
    ? 'Saved research has not been revalidated.'
    : unsupportedVice
      ? 'Add an attributed source before displaying this event.'
      : (finding
          ? evidence?.text || (card.cardType === 'vice' ? viceClaim?.claimText : null)
          : card.summary || evidence?.text) ||
        {
          company: 'Market relevance has not been recorded.',
          infrastructure: 'Capabilities and dependencies need research.',
          distribution: 'Audience and access terms need research.',
          culture: 'Participants and public activity need research.',
          vice: 'An attributed event has not been recorded.',
          insight: 'Supporting observations need research.',
          barrier: 'Requirements and affected entrants need research.',
        }[card.cardType];
  const hash = Array.from(title).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
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
  const status = unreviewed
    ? 'Unreviewed'
    : citations.length
      ? 'Source links saved'
      : 'Research needed';
  const asOf =
    !finding && !unreviewed && view.latestCapturedAt
      ? new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }).format(view.latestCapturedAt)
      : null;
  const provenance = unreviewed
    ? 'Not revalidated'
    : citations.length > 0
      ? `${citations.length} ${citations.length === 1 ? 'source' : 'sources'}${asOf ? ` · Captured ${asOf}` : ''}`
      : 'No sources saved';

  return (
    <div
      className={`collectible collectible--${card.cardType} ${finding ? 'collectible--finding' : 'collectible--entity'} ${!finding && !unreviewed && view.faceMetrics.length ? 'collectible--with-metrics' : ''}`}
      style={
        {
          '--card-accent': accent,
          '--card-highlight': highlight,
          '--card-mark-ink': markInk,
        } as CSSProperties
      }
      data-testid="collectible-card-front"
      data-card-type={card.cardType}
    >
      <div className="collectible__paper">
        <div className="collectible__edition">
          <span>STRATEMARK / RESEARCH</span>
          {finding && <span>{type}</span>}
        </div>
        {!finding && (
          <div className="collectible__art">
            <div className="collectible__brand">
              <Logo
                name={title}
                website={
                  data.evidenceState === 'legacy_unreviewed' ? null : data.company?.websiteUrl
                }
                bare
                logoUrl={data.company?.logoUrl}
                className="h-full w-full"
              />
            </div>
            <span className="collectible__art-label">{type}</span>
          </div>
        )}
        <div className="collectible__identity">
          <span className="collectible__eyebrow">
            {finding
              ? {
                  culture: 'Participants & significance',
                  vice: 'Risk finding',
                  insight: 'Implication & scope',
                  barrier: 'Obstacle to entering the market',
                  company: '',
                  infrastructure: '',
                  distribution: '',
                }[card.cardType]
              : company?.hqLocation
                ? `${type} · ${company.hqLocation}`
                : type}
          </span>
          <span className="collectible__name" title={title}>
            {title}
          </span>
          {description && <p className="collectible__description">{description}</p>}
        </div>
        <div className="collectible__context">
          <span className="collectible__eyebrow">
            {unreviewed ? 'Legacy research' : contextLabel}
          </span>
          <p>{context}</p>
        </div>
        {finding && (
          <div className="collectible__orientation">
            <span>{company ? `Subject · ${company.name}` : 'Market-level finding'}</span>
            <span>
              {!unreviewed && evidence?.timeWindow
                ? `Reported period · ${evidence.timeWindow}`
                : 'Event / scope date not recorded'}
            </span>
            {card.cardType === 'vice' && <span>Response / resolution · inspect sources</span>}
          </div>
        )}
        {!finding && !unreviewed && view.faceMetrics.length ? (
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
          <span>{status}</span>
          <span>{provenance}</span>
        </div>
      </div>
    </div>
  );
}
