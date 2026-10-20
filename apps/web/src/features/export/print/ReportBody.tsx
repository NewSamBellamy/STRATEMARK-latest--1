/** The company report (one or many companies) from `ExportModel`. */
import { Logo } from '@/features/card/Logo';
import type { ReportModel } from '../exportModel';
import { Cover } from './Cover';

export function ReportBody({ model }: { model: ReportModel }) {
  const multi = model.companies.length > 1;
  return (
    <>
      <Cover
        eyebrow={model.kind === 'deck' ? 'Stratemark · Market report' : 'Stratemark · Company report'}
        title={model.title}
        meta={[
          model.dateText,
          `${model.companies.length} ${model.companies.length === 1 ? 'company' : 'companies'}`,
          `${model.figureCount} sourced figures · ${model.unknownCount} marked Unknown`,
        ]}
      />

      {multi && (
        <section className="sm-toc">
          <h2 className="sm-h2">Contents</h2>
          <ol>
            {model.companies.map((c, i) => (
              <li key={c.id}>
                <a href={`#sm-co-${c.id}`}>
                  <span className="sm-toc-n">{String(i + 1).padStart(2, '0')}</span>
                  <span className="sm-toc-name">{c.name}</span>
                  <span className="sm-toc-meta">{c.hq ?? ''}</span>
                </a>
              </li>
            ))}
          </ol>
          <p className="sm-toc-note">Sources appear as numbered footnotes beneath each company's table.</p>
        </section>
      )}

      {model.companies.map((c, i) => (
        <section key={c.id} id={`sm-co-${c.id}`} className="sm-company">
          <div className="sm-company-head">
            <Logo name={c.name} website={c.website} logoUrl={c.logoUrl} className="sm-logo" />
            <div>
              <h2 className="sm-h2">
                {multi && <span className="sm-h2-n">{String(i + 1).padStart(2, '0')}</span>}
                {c.name}
              </h2>
              {c.hq && <p className="sm-sub">{c.hq}</p>}
            </div>
          </div>
          {c.oneLiner && <p className="sm-lede">{c.oneLiner}</p>}

          <table className="sm-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
                <th>Confidence</th>
                <th>As of</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {c.rows.map((r) => (
                <tr key={r.type} className={r.unknown ? 'sm-unknown' : undefined}>
                  <td>{r.label}</td>
                  <td className="sm-num">{r.unknown ? 'Unknown' : r.valueText}</td>
                  <td>{r.unknown ? 'No sourced figure' : r.confidence.replace('_', ' ')}</td>
                  <td>{r.asOf ?? (r.unknown ? '—' : 'not stated')}</td>
                  <td>{r.footnotes.length ? r.footnotes.map((n) => <sup key={n}>[{n}]</sup>) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {c.footnotes.length > 0 && (
            <ol className="sm-notes">
              {c.footnotes.map((f) => (
                <li key={f.n} value={f.n}>
                  <span className="sm-note-title">{f.title}</span>
                  {f.direct && <> <span className="sm-note-url">{f.url}</span></>}
                </li>
              ))}
            </ol>
          )}
          {c.rows.some((r) => r.note) && (
            <p className="sm-methods">
              {c.rows
                .filter((r) => r.note && !r.unknown)
                .map((r) => `${r.label}: ${r.note}`)
                .join(' · ')}
            </p>
          )}
        </section>
      ))}
    </>
  );
}
