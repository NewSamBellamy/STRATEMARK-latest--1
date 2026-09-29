import type { CSSProperties } from 'react';
import { publisherOf, type CardWithCompany } from '@mi/contracts';
import { buildCardView, type CardView } from './card-view';
import { Logo } from './Logo';
import { MarketCardArt } from './MarketCardArt';
import './collectible.css';

const PALETTES = ['#466b61', '#6b5f76', '#8a6b4e', '#4d667c', '#7e5b58', '#5d7455'];

/** The front is an identity and two useful facts; the reverse is the research receipt. */
export function CollectibleCard({ data, back = false, view = buildCardView(data) }: {
  data: CardWithCompany; back?: boolean; view?: CardView;
}) {
  const hash = Array.from(view.title).reduce((n, c) => ((n * 31 + c.charCodeAt(0)) >>> 0), 0);
  const brand = ['scraped', 'manual'].includes(data.company?.brandTheme?.source ?? '')
    ? data.company?.brandTheme : null;
  const color = (value: string | undefined, fallback: string) =>
    value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  const accent = color(brand?.primary, PALETTES[hash % PALETTES.length] ?? PALETTES[0]!);
  const secondary = color(brand?.secondary, accent);
  const highlight = color(brand?.accent, secondary);
  const facts = view.metrics.filter((m) => m.metric.value != null && m.metric.metricType !== 'market_share')
    .sort((a, b) => b.citations.length - a.citations.length);
  const reverseFacts = [...view.faceMetrics, ...facts.filter((m) => !view.faceMetrics.includes(m))].slice(0, 3);
  const sourceCount = view.citations.length;
  return (
    <div className={`collectible ${back ? 'collectible--back' : ''} ${view.signal ? 'collectible--signal' : ''} ${view.maturity && view.maturity.tier >= 7 && view.sourcedCount >= 2 ? 'collectible--foil' : ''}`}
      style={{ '--card-accent': accent, '--card-secondary': secondary, '--card-highlight': highlight } as CSSProperties}
      data-testid={`collectible-card-${back ? 'back' : 'front'}`}>
      <div className="collectible__paper">
        <div className="collectible__edition"><span>STRATEMARK</span><span>{back ? 'RESEARCH RECORD' : view.type}</span></div>
        {back ? <>
          <div className="collectible__reverse-head">
            <span className="collectible__eyebrow">{view.type} / Research file</span>
            <span className="collectible__name">{view.title}</span>
          </div>
          {view.signal ? <div className="collectible__reverse-body">
            <span className="collectible__eyebrow">Evidence on file</span>
            {data.card.keyPoints.slice(0, 2).map((point, i) => <p className="collectible__reverse-point" key={i}>{point}</p>)}
            {sourceCount ? <div className="collectible__reverse-facts">{view.citations.slice(0, 3).map((c) =>
              <div className="collectible__reverse-fact" key={c.url}>
                <span className="collectible__reverse-label">{publisherOf(c.url, c.title)}</span>
                <span className="collectible__reverse-source">Source receipt</span>
              </div>)}</div> : <p className="collectible__reverse-empty">No clickable source receipts are on file yet.</p>}
          </div> : <div className="collectible__reverse-body">
            <span className="collectible__eyebrow">Evidence on file</span>
            {reverseFacts.length ? <div className="collectible__reverse-facts">{reverseFacts.map((m) =>
              <div className="collectible__reverse-fact" key={m.metric.id}>
                <span className="collectible__reverse-value">{m.display}</span>
                <span className="collectible__reverse-label">{m.label}</span>
                <span className="collectible__reverse-source">{m.confidence} · {m.citations[0]
                  ? publisherOf(m.citations[0].url, m.citations[0].title) : 'No source receipt'}</span>
              </div>)}</div> : <p className="collectible__reverse-empty">No comparable company figures are on file yet. This card is a profile, not a ranking.</p>}
          </div>}
          <div className="collectible__footer"><span>{sourceCount} research {sourceCount === 1 ? 'source' : 'sources'}</span><span>Details in Evidence ↗</span></div>
        </> : <>
          <div className="collectible__art" aria-hidden="true">
            {view.signal ? <div className="collectible__signal-art"><MarketCardArt type={data.card.cardType} seed={view.title} /></div> :
              <div className="collectible__brand"><Logo name={view.title} website={data.company?.websiteUrl} bare
                logoUrl={data.company?.logoUrl} className="h-full w-full" /></div>}
          </div>
          <div className="collectible__identity">
            {data.company?.hqLocation && <span className="collectible__eyebrow">{data.company.hqLocation}</span>}
            <span className="collectible__name">{view.title}</span>
            {view.description && <p className="collectible__description">{view.description}</p>}
          </div>
          {view.signal ? <div className="collectible__signal-copy">
            <span className="collectible__eyebrow">{data.card.cardType === 'vice' ? 'Risk finding' : 'Market finding'}</span>
            <p>{data.card.keyPoints[0] || 'Inspect this card for its thesis and sources.'}</p>
          </div> : view.faceMetrics.length ? <div className="collectible__metrics">{view.faceMetrics.map((m) => <div key={m.metric.id}>
            <span className="collectible__metric-value">{m.display}</span>
            <span className="collectible__metric-label">{m.label}</span>
            <span className="collectible__confidence">{m.confidence}</span>
          </div>)}</div> : <div className="collectible__profile">
            <span className="collectible__eyebrow">Research gap</span>
            <span>{view.knownCount === 0 ? 'No figures on file' : 'No comparable figures'}</span>
          </div>}
          <div className="collectible__footer"><span>{view.position}</span>
            <span>{view.signal ? `${sourceCount} sources` : `${view.sourcedCount} sourced ${view.sourcedCount === 1 ? 'figure' : 'figures'}`}</span></div>
        </>}
      </div>
      <div className="collectible__foil" aria-hidden="true" />
    </div>
  );
}
