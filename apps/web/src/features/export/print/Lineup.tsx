/** The lineup page: every company's card face at lineup size in a clean grid. */
import type { FullReportModel } from '../fullReportModel';
import { PrintCardFace } from './PrintCardFace';
import { MARKET_ANCHORS } from './marketOutline';

export function Lineup({ model }: { model: FullReportModel }) {
  return (
    <section id={MARKET_ANCHORS.lineup} className={model.companies.length <= 12 ? 'sm-lineup sm-lineup--big' : 'sm-lineup'} data-testid="lineup">
      <p className="sm-eyebrow2">The market</p>
      <h2 className="sm-h2b">The market, card by card</h2>
      <div className="sm-lineup__grid">
        {model.companies.map((c) => (
          <div key={c.id} className="sm-lineup__cell"><PrintCardFace data={c.card} width="lineup" /></div>
        ))}
      </div>
    </section>
  );
}
