/**
 * The market (deck) report as a designed document: full-bleed cover, contents, card lineup, overview with small
 * charts, then the "Companies" opener and one spread per company. Signals, methods and sources are B2's sections.
 * Styling lives in market.css; figures come only from the model (see FigureValue, PrintBars, CompanySpread).
 */
import type { FullReportModel } from '../fullReportModel';
import { CompanySpread } from './CompanySpread';
import { Contents } from './Contents';
import { Lineup } from './Lineup';
import { MarketCover } from './MarketCover';
import { MARKET_ANCHORS, marketOutline } from './marketOutline';
import { Overview } from './Overview';
import { SectionOpener } from './SectionOpener';
import './market.css';

export { UNSOURCED_PROFILE_NOTE } from './CompanySpread';

export function MarketReportBody({ model }: { model: FullReportModel }) {
  const outline = marketOutline(model);
  const n = model.companies.length;
  return (
    <div className="sm-mkt">
      <MarketCover model={model} />
      <Contents model={model} />
      <Lineup model={model} />
      <Overview model={model} />

      <SectionOpener
        id={MARKET_ANCHORS.companies}
        numeral={outline.companies}
        title="Companies"
        lead={`${n} ${n === 1 ? 'company' : 'companies'}, each with its card, its sourced figures and what the research found behind them.`}
      >
        <ol className="sm-roster">
          {model.companies.map((c, i) => (
            <li key={c.id}><span className="sm-roster__n">{String(i + 1).padStart(2, '0')}</span><span className="sm-roster__name">{c.name}</span><span className="sm-roster__role">{c.role}</span></li>
          ))}
        </ol>
      </SectionOpener>

      {model.companies.map((c, i) => <CompanySpread key={c.id} company={c} index={i} section={outline.companies} />)}

      {/* B2: signals, methods, sources */}
    </div>
  );
}
