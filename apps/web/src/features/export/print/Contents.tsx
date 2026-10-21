/**
 * The contents page: numbered sections, and under "Companies" each company with "n/4 figures sourced".
 * No page numbers: Chromium has no target-counter(), so the entries are links to the section anchors instead.
 */
import type { FullReportModel } from '../fullReportModel';
import { MARKET_ANCHORS, marketOutline } from './marketOutline';

export function Contents({ model }: { model: FullReportModel }) {
  const o = marketOutline(model);
  return (
    <section className="sm-toc2" data-testid="contents">
      <p className="sm-eyebrow2">Contents</p>
      <ol className="sm-toc2__list">
        <li className="sm-toc2__sec">
          <a href={`#${MARKET_ANCHORS.lineup}`}><span className="sm-toc2__n">{o.market}</span><span className="sm-toc2__name">The market</span></a>
          <ul className="sm-toc2__sub">
            <li><a href={`#${MARKET_ANCHORS.lineup}`}>The market, card by card</a></li>
            <li><a href={`#${MARKET_ANCHORS.overview}`}>The market at a glance</a></li>
          </ul>
        </li>
        <li className="sm-toc2__sec">
          <a href={`#${MARKET_ANCHORS.companies}`}><span className="sm-toc2__n">{o.companies}</span><span className="sm-toc2__name">Companies</span></a>
          <ul className="sm-toc2__sub sm-toc2__sub--companies">
            {model.companies.map((c) => (
              <li key={c.id}>
                <a href={`#sm-co-${c.id}`}>
                  <span className="sm-toc2__co">{c.name}</span>
                  <span className="sm-toc2__meta">{c.faceSourced}/{c.faceFigures.length} figures sourced</span>
                </a>
              </li>
            ))}
          </ul>
        </li>
        {o.signals && (
          <li className="sm-toc2__sec">
            <a href={`#${MARKET_ANCHORS.signals}`}><span className="sm-toc2__n">{o.signals}</span><span className="sm-toc2__name">Signals</span></a>
          </li>
        )}
        <li className="sm-toc2__sec">
          <a href={`#${MARKET_ANCHORS.methods}`}><span className="sm-toc2__n">{o.methods}</span><span className="sm-toc2__name">Method and sources</span></a>
        </li>
      </ol>
      <div className="sm-toc2__legend">
        <p className="sm-eyebrow2">How figures are marked</p>
        <dl>
          <div><dt><span className="sm-fv">Solid ink</span></dt><dd>A figure a source supports. The note number beside it names the source.</dd></div>
          <div><dt><span className="sm-fv sm-fv--estimated">Italic <span className="sm-fv-est">est.</span></span></dt><dd>A source reported it; it has not been checked against the original document.</dd></div>
          <div><dt><span className="sm-fv sm-fv--unknown">Unknown</span></dt><dd>No source could be found. Nothing is guessed or filled in.</dd></div>
        </dl>
      </div>
    </section>
  );
}
