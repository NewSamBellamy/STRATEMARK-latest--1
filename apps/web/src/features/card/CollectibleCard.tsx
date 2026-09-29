import type { CSSProperties } from 'react';
import type { CardWithCompany } from '@mi/contracts';
import { buildCardView, type CardView } from './card-view';
import { Logo } from './Logo';
import { MarketCardArt } from './MarketCardArt';
import './collectible.css';

const PALETTES = ['#466b61', '#6b5f76', '#8a6b4e', '#4d667c', '#7e5b58', '#5d7455'];

/** Pure card surface: no links, controls, requests, or persistence. */
export function CollectibleCard({ data, back = false, view = buildCardView(data) }: {
  data: CardWithCompany; back?: boolean; view?: CardView;
}) {
  const hash = Array.from(view.title).reduce((n, c) => ((n * 31 + c.charCodeAt(0)) >>> 0), 0);
  const brand = data.company?.brandTheme?.source === 'default' ? null : data.company?.brandTheme;
  const color = (value: string | undefined, fallback: string) =>
    value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  const accent = color(brand?.primary, PALETTES[hash % PALETTES.length] ?? PALETTES[0]!);
  const highlight = color(brand?.accent, accent);
  const serial = hash.toString(16).slice(-4).toUpperCase().padStart(4, '0');
  return (
    <div className={`collectible ${back ? 'collectible--back' : ''}`}
      style={{ '--card-accent': accent, '--card-highlight': highlight } as CSSProperties}
      data-testid={`collectible-card-${back ? 'back' : 'front'}`}>
      <div className="collectible__paper">
        <div className="collectible__edition"><span>STRATEMARK / RESEARCH</span><span>{serial}</span></div>
        {back ? <>
          <div className="collectible__reverse-mark" aria-hidden="true">S / M</div>
          <div className="collectible__identity"><span className="collectible__eyebrow">Research reverse</span>
            <span className="collectible__name">{view.title}</span></div>
          <div className="collectible__reverse-copy">
            <span className="collectible__eyebrow">The thesis</span>
            <p>{data.card.summary || view.description || 'The research thesis has not been recorded yet.'}</p>
            {data.card.keyPoints.length > 0 && <ul>{data.card.keyPoints.slice(0, 3).map((point, i) =>
              <li key={i}>{point}</li>)}</ul>}
          </div>
          <div className="collectible__footer"><span>Open Evidence for source receipts</span><span>↗</span></div>
        </> : <>
          <div className={`collectible__art ${view.signal ? 'collectible__art--signal' : ''}`} aria-hidden="true">
            {view.signal ? <div className="collectible__signal-art"><MarketCardArt type={data.card.cardType} seed={view.title} /></div> :
              <div className="collectible__brand"><Logo name={view.title} website={data.company?.websiteUrl} bare
                logoUrl={data.company?.logoUrl} className="h-full w-full" /></div>}
            <span className="collectible__art-label">{view.type}</span>
            <span className="collectible__art-index">FIELD NOTES / {serial}</span>
          </div>
          <div className="collectible__identity"><span className="collectible__eyebrow">{view.type} / Company profile</span>
            <span className="collectible__name">{view.title}</span>
            <p className="collectible__description">{view.description || 'Research still taking shape.'}</p>
          </div>
          {view.signal ? <div className="collectible__signal-copy">
            <span className="collectible__eyebrow">{data.card.cardType === 'vice' ? 'Risk signal' : 'Market signal'}</span>
            <p>{data.card.keyPoints[0] || 'Inspect this card for its thesis and sources.'}</p>
          </div> : view.faceMetrics.length ? <div className="collectible__metrics">{view.faceMetrics.map((m) => <div key={m.label}>
            <span className="collectible__metric-value">{m.display}</span>
            <span className="collectible__metric-label">{m.label}</span>
            <span className="collectible__confidence">{m.confidence}</span>
          </div>)}</div> : !view.signal && <div className="collectible__profile">
            <span className="collectible__eyebrow">Evidence status</span>
            <span>{view.knownCount === 0 ? 'No usable figures recorded' : `${view.knownCount} other figures recorded`}</span>
          </div>}
          <div className="collectible__footer"><span>{view.position}</span>
            <span>{view.signal ? `${view.citations.length} sources` : `${view.sourcedCount} sourced ${view.sourcedCount === 1 ? 'figure' : 'figures'}`}</span></div>
        </>}
      </div>
      <div className="collectible__foil" aria-hidden="true" />
    </div>
  );
}
