/** The product report. */
import { Logo } from '@/features/card/Logo';
import type { ProductReportModel } from '../productReportModel';

export function ProductReportBody({ model }: { model: ProductReportModel }) {
  const noteOf = (url: string | null | undefined) => (url ? model.noteByUrl[url] : undefined);
  return (
    <>
      <section className="sm-cover">
        <div className="sm-cover-brand">
          <Logo name={model.company.name} website={model.company.website} logoUrl={model.company.logoUrl} className="sm-cover-logo" />
          <p className="sm-eyebrow">Stratemark · Product report</p>
        </div>
        <h1 className="sm-cover-title">{model.product.name}</h1>
        <div className="sm-rule" />
        <ul className="sm-cover-meta">
          <li>{model.company.name}{model.product.status ? ` · ${model.product.status}` : ''}</li>
          <li>{model.dateText}</li>
        </ul>
        <p className="sm-cover-note">
          Each figure carries its source. A figure nobody reports says <strong>Not reported</strong>; nothing is estimated.
          {model.researched ? '' : ' Only stored research is included: this product has not been researched in depth yet.'}
        </p>
      </section>

      <section className="sm-topic">
        <h2 className="sm-h2">Overview</h2>
        {model.overview.researched && <p className="sm-lede">{model.overview.researched}</p>}
        {model.overview.stored && <p className="sm-lede">{model.overview.stored}</p>}
        {!model.overview.researched && !model.overview.stored && <p className="sm-lede">Not reported.</p>}
        <h2 className="sm-h2" style={{ marginTop: '6mm' }}>Key metrics</h2>
        <table className="sm-table">
          <tbody>
            {model.metrics.map((m, i) => (
              <tr key={`${m.label}-${i}`} className={m.value ? undefined : 'sm-unknown'}>
                <th>{m.label}</th>
                <td>
                  {m.value ?? 'Not reported'}
                  {m.value && m.asOf ? ` (${m.asOf})` : ''}
                  {m.source && noteOf(m.source.url) ? <sup> [{noteOf(m.source.url)}]</sup> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {(model.sentiment || model.stories.length > 0) && (
        <section className="sm-topic">
          <h2 className="sm-h2">How it is received</h2>
          {model.sentiment?.summary && <p className="sm-lede">{model.sentiment.summary}</p>}
          {model.sentiment && model.sentiment.positive.length > 0 && (
            <>
              <p className="sm-kind">Praised for</p>
              <ul>{model.sentiment.positive.map((t) => <li key={t}>{t}</li>)}</ul>
            </>
          )}
          {model.sentiment && model.sentiment.negative.length > 0 && (
            <>
              <p className="sm-kind">Criticised for</p>
              <ul>{model.sentiment.negative.map((t) => <li key={t}>{t}</li>)}</ul>
            </>
          )}
          {model.stories.length > 0 && (
            <>
              <p className="sm-kind">In the news</p>
              {model.stories.map((st) => (
                <p key={st.url} className="sm-note-line">
                  <span className="sm-sentiment">{st.sentiment}</span> {st.title}
                  {st.publisher ? ` · ${st.publisher}` : ''}{st.date ? ` · ${st.date}` : ''}
                  {noteOf(st.url) ? <sup> [{noteOf(st.url)}]</sup> : null}
                </p>
              ))}
            </>
          )}
        </section>
      )}

      {model.timeline.length > 0 && (
        <section className="sm-topic">
          <h2 className="sm-h2">Growth timeline</h2>
          {model.timeline.map((t, i) => (
            <article key={`${t.title}-${i}`} className="sm-update">
              <p className="sm-kind">{t.date ?? 'Undated'}</p>
              <h3 className="sm-update-title">{t.title}</h3>
              {t.detail && <p>{t.detail}{noteOf(t.sourceUrl) ? <sup> [{noteOf(t.sourceUrl)}]</sup> : null}</p>}
            </article>
          ))}
        </section>
      )}

      {model.footnotes.length > 0 && (
        <section className="sm-topic">
          <h2 className="sm-h2">Sources</h2>
          <ol className="sm-notes">
            {model.footnotes.map((f) => (
              <li key={f.n} value={f.n}>
                <span className="sm-note-title">{f.title}</span>
                {f.direct && <> <span className="sm-note-url">{f.url}</span></>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
