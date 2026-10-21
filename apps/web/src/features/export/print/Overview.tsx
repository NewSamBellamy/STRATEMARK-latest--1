/**
 * The market overview page: one comparison table (company, type, HQ and the four face figures with note numbers and
 * as-of dates), then one small bar chart per metric series. Every figure string is the model's `display`.
 */
import type { FullReportModel } from '../fullReportModel';
import { FigureValue } from './FigureValue';
import { MARKET_ANCHORS } from './marketOutline';
import { PrintBars } from './PrintBars';

export function Overview({ model }: { model: FullReportModel }) {
  return (
    <section id={MARKET_ANCHORS.overview} className="sm-overview" data-testid="overview">
      <p className="sm-eyebrow2">The market</p>
      <h2 className="sm-h2b">The market at a glance</h2>
      <table className="sm-ov-table">
        <thead>
          <tr>
            <th className="sm-ov-co">Company</th>
            <th>Based in</th>
            {model.overview.map((s) => <th key={s.key} className="sm-ov-fig">{s.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {model.companies.map((c) => (
            <tr key={c.id}>
              <td className="sm-ov-co"><strong>{c.name}</strong><span className="sm-ov-role">{c.role}</span></td>
              <td className="sm-ov-hq">{c.hq ?? <span className="sm-fv sm-fv--unknown">Unknown</span>}</td>
              {model.overview.map((s) => {
                const e = s.entries.find((x) => x.companyId === c.id) ?? null;
                return (
                  <td key={s.key} className="sm-ov-fig">
                    <FigureValue entry={e} />
                    {e?.asOf ? <span className="sm-ov-asof">{e.asOf}</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sm-ov-key">Numbers beside a figure are the notes that name its source. <em>Italic</em> figures are estimates a source reported. Unknown means no source could be found.</p>
      <div className="sm-charts">
        {model.overview.map((s) => <PrintBars key={s.key} series={s} sources={model.sources} />)}
      </div>
    </section>
  );
}
