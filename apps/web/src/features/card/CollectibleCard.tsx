import type { CSSProperties } from 'react';
import type { CardWithCompany } from '@mi/contracts';
import { buildCardView, type CardView } from './card-view';
import { Logo } from './Logo';
import { MarketCardArt } from './MarketCardArt';
import './collectible.css';

const PALETTES = ['#8fb7a9', '#b4a3ca', '#c5a778', '#86a5be'];

/** Pure card surface: no links, controls, requests, or persistence. */
export function CollectibleCard({ data, back = false, view = buildCardView(data) }: {
  data: CardWithCompany; back?: boolean; view?: CardView;
}) {
  const hash = Array.from(view.title).reduce((n, c) => ((n * 31 + c.charCodeAt(0)) >>> 0), 0);
  const accent = PALETTES[hash % PALETTES.length];
  const serial = hash.toString(16).slice(-4).toUpperCase().padStart(4, '0');
  return (
    <div className={`collectible ${back ? 'collectible--back' : ''}`}
      style={{ '--card-accent': accent } as CSSProperties}
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
          <div className="collectible__art" aria-hidden="true">
            <div className="collectible__orbit collectible__orbit--one" />
            <div className="collectible__orbit collectible__orbit--two" />
            <div className="collectible__orbit collectible__orbit--three" />
            <div className="collectible__axis" />
            {view.signal ? <div className="collectible__signal-art"><MarketCardArt type={data.card.cardType} seed={view.title} /></div> :
              <div className="collectible__brand"><Logo name={view.title} website={data.company?.websiteUrl}
                logoUrl={data.company?.logoUrl} className="h-full w-full" /></div>}
            <span className="collectible__art-label">{view.type}</span>
            <span className="collectible__art-index">FIELD NOTES / {serial}</span>
          </div>
          <div className="collectible__identity"><span className="collectible__eyebrow">{view.type} · Research snapshot</span>
            <span className="collectible__name">{view.title}</span>
            <p className="collectible__description">{view.description || 'Research still taking shape.'}</p>
          </div>
          {view.signal ? <div className="collectible__signal-copy">
            <span className="collectible__eyebrow">{data.card.cardType === 'vice' ? 'Risk signal' : 'Market signal'}</span>
            <p>{data.card.keyPoints[0] || 'Inspect this card for its thesis and sources.'}</p>
          </div> : <div className="collectible__metrics">{view.faceMetrics.map((m) => <div key={m.label}>
            <span className="collectible__metric-value">{m.display}</span>
            <span className="collectible__metric-label">{m.label}</span>
            <span className="collectible__confidence">{m.confidence}</span>
          </div>)}</div>}
          <div className="collectible__footer"><span>{view.maturity ? `Maturity · T${view.maturity.tier}` : view.signal ? 'Signal · Not scored' : 'Maturity · Unscored'}</span>
            <span>{view.signal ? `${view.citations.length} sources` : `${view.sourcedCount} ${view.sourcedCount === 1 ? 'metric' : 'metrics'} with sources`}</span></div>
        </>}
      </div>
      <div className="collectible__foil" aria-hidden="true" />
    </div>
  );
}
