/** The product report: dark cover, overview, key metrics, reception, growth timeline and the sources behind them. */
import { Logo } from '@/features/card/Logo';
import type { ProductReportModel } from '../productReportModel';
import { Cover } from './Cover';
import { NoteList, Ref, ReportSection, Row } from './reportParts';

export function ProductReportBody({ model }: { model: ProductReportModel }) {
  const noteOf = (url: string | null | undefined) => (url ? model.noteByUrl[url] : undefined);
  const name = model.product.name;
  const co = model.company;
  return (
    <>
      <Cover
        eyebrow="Product report"
        title={name}
        subtitle={co.name}
        logo={<Logo name={co.name} website={co.website} logoUrl={co.logoUrl} className="sm-cv-logo-img" />}
        meta={[model.product.status ?? '', co.name, model.dateText].filter(Boolean)}
        note={
          <>
            <span>Each figure carries its source. A figure nobody reports says &ldquo;Not reported&rdquo;; nothing is estimated.</span>
            {!model.researched && <span>Only stored research is included: this product has not been researched in depth yet.</span>}
          </>
        }
      />

      <ReportSection about={`${name} · ${co.name}`} title="Overview and key metrics">
        <Row>
          <div className="sm-r-block">
            <h3 className="sm-r-h3">Overview</h3>
            {model.overview.researched && <p className="sm-r-lede">{model.overview.researched}</p>}
            {model.overview.stored && <p className="sm-r-lede">{model.overview.stored}</p>}
            {!model.overview.researched && !model.overview.stored && <p className="sm-r-lede">Not reported.</p>}
            {model.audience && <p style={{ margin: 0 }}><strong>Who it is for.</strong> {model.audience}</p>}
            {model.launched && <p style={{ margin: 0 }}><strong>First launch.</strong> {model.launched.date}: {model.launched.title}</p>}
          </div>
        </Row>
        <Row>
          <div className="sm-r-block">
            <h3 className="sm-r-h3">Key metrics</h3>
            <table className="sm-r-table sm-r-table--facts">
              <tbody>
                {model.metrics.map((m, i) => (
                  <tr key={`${m.label}-${i}`} className={m.value ? undefined : 'sm-r-row--unknown'}>
                    <th>{m.label}</th>
                    <td>
                      {m.value ?? 'Not reported'}
                      {m.value && m.asOf ? ` (${m.asOf})` : ''}
                      {m.source ? <Ref n={noteOf(m.source.url)} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Row>
      </ReportSection>

      {model.news.length > 0 && (
        <ReportSection about={`${name} · ${co.name}`} title="What's new">
          {model.news.map((n) => (
            <Row key={n.url}>
              <p className="sm-r-source">
                {n.title}{n.publisher ? ` · ${n.publisher}` : ''}{n.date ? ` · ${n.date}` : ''}<Ref n={noteOf(n.url)} />
              </p>
            </Row>
          ))}
        </ReportSection>
      )}

      {model.videos.length > 0 && (
        <ReportSection about={`${name} · ${co.name}`} title="Videos">
          {model.videos.map((v) => (
            <Row key={v.url}>
              <p className="sm-r-source">
                {v.title} · {v.channel}{v.official ? ' (official channel)' : ''}{v.date ? ` · ${v.date}` : ''}<Ref n={noteOf(v.url)} />
              </p>
            </Row>
          ))}
        </ReportSection>
      )}

      {(model.sentiment || model.stories.length > 0) && (
        <ReportSection about={`${name} · ${co.name}`} title="How it is received">
          {model.sentiment?.summary && <Row><p className="sm-r-lede">{model.sentiment.summary}</p></Row>}
          {model.sentiment && model.sentiment.positive.length > 0 && (
            <Row>
              <div className="sm-r-block">
                <h3 className="sm-r-h3">Praised for</h3>
                <ul>{model.sentiment.positive.map((t) => <li key={t}>{t}</li>)}</ul>
              </div>
            </Row>
          )}
          {model.sentiment && model.sentiment.negative.length > 0 && (
            <Row>
              <div className="sm-r-block">
                <h3 className="sm-r-h3">Criticised for</h3>
                <ul>{model.sentiment.negative.map((t) => <li key={t}>{t}</li>)}</ul>
              </div>
            </Row>
          )}
          {model.stories.length > 0 && (
            <Row>
              <div className="sm-r-block">
                <h3 className="sm-r-h3">In the news</h3>
                {model.stories.map((st) => (
                  <p key={st.url} className="sm-r-source">
                    <span className="sm-r-sentiment">{st.sentiment}</span> {st.title}
                    {st.publisher ? ` · ${st.publisher}` : ''}{st.date ? ` · ${st.date}` : ''}
                    <Ref n={noteOf(st.url)} />
                  </p>
                ))}
              </div>
            </Row>
          )}
        </ReportSection>
      )}

      {model.timeline.length > 0 && (
        <ReportSection about={`${name} · ${co.name}`} title="Growth timeline">
          {model.timeline.map((t, i) => (
            <Row key={`${t.title}-${i}`}>
              <article className="sm-r-update">
                <p className="sm-r-kind">{t.date ?? 'Undated'}</p>
                <h3 className="sm-r-update-title">{t.title}</h3>
                {t.detail && <p style={{ margin: 0 }}>{t.detail}<Ref n={noteOf(t.sourceUrl)} /></p>}
              </article>
            </Row>
          ))}
        </ReportSection>
      )}

      {model.footnotes.length > 0 && (
        <ReportSection about={`${name} · ${co.name}`} title="Sources">
          <Row><NoteList notes={model.footnotes} /></Row>
        </ReportSection>
      )}
    </>
  );
}
