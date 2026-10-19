/**
 * The printable report: cover, contents, one section per company (logo, key
 * metrics table, citations as numbered footnotes) and a closing note.
 * Rendered off-screen into document.body and shown only while printing, so
 * "Save as PDF" always produces this layout regardless of the page the user
 * was on. Styling lives in print.css.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isRedirectCitation, publisherOf, usableCitations, type ThreadMessage } from '@mi/contracts';
import { Logo } from '@/features/card/Logo';
import { splitFollowUps } from '@/features/deepdive/followUps';
import type { ReportModel } from './exportModel';
import type { FullReportCompany, FullReportModel, ReportSource, SignalBlock } from './fullReportModel';
import type { ReportImage, TopicReportModel } from './topicReportModel';
import type { DailyReportModel } from './dailyReportModel';
import type { PersonReportModel } from './personReportModel';
import type { ProductReportModel } from './productReportModel';
import './print.css';

export type PrintJob =
  | { kind: 'report'; model: ReportModel }
  | { kind: 'marketReport'; model: FullReportModel }
  | { kind: 'topicReport'; model: TopicReportModel }
  | { kind: 'dailyReport'; model: DailyReportModel }
  | { kind: 'personReport'; model: PersonReportModel }
  | { kind: 'productReport'; model: ProductReportModel }
  | { kind: 'transcript'; title: string; scopeLabel: string | null; dateText: string; messages: readonly ThreadMessage[] };


function Cover({ eyebrow, title, meta }: { eyebrow: string; title: string; meta: string[] }) {
  return (
    <section className="sm-cover">
      <p className="sm-eyebrow">{eyebrow}</p>
      <h1 className="sm-cover-title">{title}</h1>
      <div className="sm-rule" />
      <ul className="sm-cover-meta">
        {meta.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      <p className="sm-cover-note">
        Every figure in this document carries its source. Where the research does not support a figure it is shown as{' '}
        <strong>Unknown</strong> - never guessed or filled in. &ldquo;Estimated&rdquo; means a source reported the
        figure but it has not yet been checked against the original document.
      </p>
    </section>
  );
}

function ReportBody({ model }: { model: ReportModel }) {
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


/** "Sources: reuters.com, ft.com": publishers only, as a quiet line. */
function SourceLine({ sources }: { sources: readonly ReportSource[] }) {
  const names = [...new Set(sources.map((s) => s.title))];
  return names.length > 0 ? <p className="sm-srcline">Sources: {names.join(', ')}</p> : null;
}

function SignalList({ title, blocks }: { title: string; blocks: readonly SignalBlock[] }) {
  if (blocks.length === 0) return null;
  return (
    <div className="sm-signal-group">
      <h3 className="sm-h3">{title}</h3>
      {blocks.map((b) => (
        <article key={b.title} className="sm-signal">
          <p className="sm-signal-title">{b.title}</p>
          {b.summary && <p>{b.summary}</p>}
          {b.points.length > 0 && <ul>{b.points.map((p) => <li key={p}>{p}</li>)}</ul>}
          <SourceLine sources={b.sources} />
        </article>
      ))}
    </div>
  );
}

function ProfileBlocks({ c }: { c: FullReportCompany }) {
  return (
    <>
      {c.overview.length > 0 && (
        <div className="sm-block">
          <h3 className="sm-h3">Overview</h3>
          {c.overview.map((p) => <p key={p}>{p}</p>)}
        </div>
      )}
      {c.products.length > 0 && (
        <div className="sm-block">
          <h3 className="sm-h3">Products</h3>
          <ul>{c.products.map((p) => <li key={p.name}><strong>{p.name}</strong>{p.description ? <> &mdash; {p.description}</> : null}</li>)}</ul>
        </div>
      )}
      {c.leaders.length > 0 && (
        <div className="sm-block">
          <h3 className="sm-h3">Leadership</h3>
          <ul className="sm-cols">{c.leaders.map((l) => <li key={`${l.name}-${l.role}`}><strong>{l.name}</strong>, {l.role}</li>)}</ul>
        </div>
      )}
      {c.timeline.length > 0 && (
        <div className="sm-block">
          <h3 className="sm-h3">History</h3>
          <ul className="sm-timeline">{c.timeline.map((e) => <li key={`${e.date}-${e.title}`}><span className="sm-when">{e.date}</span> {e.title}</li>)}</ul>
        </div>
      )}
      {c.news.length > 0 && (
        <div className="sm-block">
          <h3 className="sm-h3">Recent news</h3>
          <ul>{c.news.map((n) => {
            const by = [n.publisher, n.date].filter(Boolean).join(', ');
            return <li key={n.url}>{n.title}{by ? <span className="sm-muted"> ({by})</span> : null}</li>;
          })}</ul>
        </div>
      )}
      {(c.risks.length > 0 || c.culture) && (
        <div className="sm-block">
          <h3 className="sm-h3">Risks and culture</h3>
          {c.risks.length > 0 && (
            <ul>{c.risks.map((r) => <li key={r.text}>{r.text}<span className="sm-muted"> ({r.source.title})</span></li>)}</ul>
          )}
          {c.culture && (
            <p>
              <strong>Culture.</strong> {c.culture.note}
              {c.culture.sources.length > 0 ? <span className="sm-muted"> ({[...new Set(c.culture.sources.map((s) => s.title))].join(', ')})</span> : null}
            </p>
          )}
          {c.risks.length > 0 && <p className="sm-methods">Each risk is attributed to the source that reports it and is not asserted as established fact.</p>}
        </div>
      )}
    </>
  );
}

function MarketReportBody({ model }: { model: FullReportModel }) {
  const n = model.companies.length;
  const hasSignals = model.barriers.length > 0 || model.insights.length > 0 || model.companies.some((c) => c.risks.length > 0 || c.culture);
  return (
    <>
      <Cover
        eyebrow="Stratemark · Market report"
        title={model.title}
        meta={[
          model.dateText,
          `${n} ${n === 1 ? 'company' : 'companies'}${model.signalCount > 0 ? ` · ${model.signalCount} market signals` : ''}`,
          `${model.figureCount} sourced figures · ${model.unknownCount} marked Unknown`,
        ]}
      />

      <section className="sm-toc">
        <h2 className="sm-h2">Contents</h2>
        <ol>
          <li><a href="#sm-glance"><span className="sm-toc-n">&middot;</span><span className="sm-toc-name">The market at a glance</span><span className="sm-toc-meta" /></a></li>
          {hasSignals && <li><a href="#sm-signals"><span className="sm-toc-n">&middot;</span><span className="sm-toc-name">Market signals</span><span className="sm-toc-meta">barriers, insights, risks, culture</span></a></li>}
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
        <p className="sm-toc-note">Sources appear as numbered footnotes beneath each company&apos;s figures, and as publishers beneath each finding.</p>
      </section>

      <section id="sm-glance" className="sm-glance">
        <h2 className="sm-h2">The market at a glance</h2>
        <table className="sm-table sm-glance-table">
          <thead><tr><th>Company</th><th>Based in</th><th>Key figures</th></tr></thead>
          <tbody>
            {model.companies.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong><br /><span className="sm-muted">{c.role}</span></td>
                <td>{c.hq ?? '—'}</td>
                <td>{c.keyFigures.length > 0 ? c.keyFigures.map((f) => `${f.display} ${f.label.split(' ').map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ')}`).join(' · ') : <span className="sm-muted">No sourced figure yet</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sm-methods">Figures are the four strongest sourced ones each card shows. &ldquo;Estimated&rdquo; figures were reported by a source and have not been checked against the original document.</p>
      </section>

      {hasSignals && (
        <section id="sm-signals" className="sm-signals">
          <h2 className="sm-h2">Market signals</h2>
          <SignalList title="Barriers to entry" blocks={model.barriers} />
          <SignalList title="Insights" blocks={model.insights} />
        </section>
      )}

      {model.companies.map((c, i) => (
        <section key={c.id} id={`sm-co-${c.id}`} className="sm-company sm-profile">
          <div className="sm-company-head">
            <Logo name={c.name} website={c.website} logoUrl={c.logoUrl} className="sm-logo" />
            <div>
              <h2 className="sm-h2"><span className="sm-h2-n">{String(i + 1).padStart(2, '0')}</span>{c.name}</h2>
              <p className="sm-sub">{[c.hq, c.ownership, c.founded ? `Founded ${c.founded}` : null, c.role].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
          {c.oneLiner && <p className="sm-lede">{c.oneLiner}</p>}
          <ProfileBlocks c={c} />

          <div className="sm-block">
            <h3 className="sm-h3">Figures</h3>
            <table className="sm-table">
              <thead><tr><th>Metric</th><th>Value</th><th>Confidence</th><th>As of</th><th>Source</th></tr></thead>
              <tbody>
                {c.rows.map((r) => (
                  <tr key={r.type} className={r.unknown ? 'sm-unknown' : undefined}>
                    <td>{r.label}</td>
                    <td className="sm-num">{r.unknown ? 'Unknown' : r.valueText}</td>
                    <td>{r.unknown ? 'No sourced figure' : r.confidence.replace('_', ' ')}</td>
                    <td>{r.asOf ?? (r.unknown ? '—' : 'not stated')}</td>
                    <td>{r.footnotes.length ? r.footnotes.map((k) => <sup key={k}>[{k}]</sup>) : '—'}</td>
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
              <p className="sm-methods">{c.rows.filter((r) => r.note && !r.unknown).map((r) => `${r.label}: ${r.note}`).join(' · ')}</p>
            )}
          </div>
        </section>
      ))}
    </>
  );
}

function imageCaption(i: ReportImage): string {
  return i.kind === 'screenshot' ? `Capture of the source page, ${i.credit}` : `Image: ${i.credit}`;
}

function TopicReportBody({ model }: { model: TopicReportModel }) {
  return (
    <>
      <section className="sm-cover">
        <div className="sm-cover-brand">
          <Logo name={model.company.name} website={model.company.website} logoUrl={model.company.logoUrl} className="sm-cover-logo" />
          <p className="sm-eyebrow">Stratemark · Company report</p>
        </div>
        {model.hero && (
          <figure className="sm-cover-hero">
            <img src={model.hero.src} alt="" />
            <figcaption>{imageCaption(model.hero)}</figcaption>
          </figure>
        )}
        <h1 className="sm-cover-title">{model.company.name}</h1>
        <div className="sm-rule" />
        <ul className="sm-cover-meta">
          <li>{model.dateText}</li>
          {model.company.hq && <li>{model.company.hq}</li>}
          <li>{model.sections.map((s) => s.title).join(' · ')}</li>
        </ul>
        {model.demo && (
          <p className="sm-cover-note">
            Demo report: compiled from the sample deck&apos;s stored research. A live report researches what is missing.
          </p>
        )}
        <p className="sm-cover-note">
          Every figure carries its source as a numbered footnote. Where the research did not support a figure the report
          says <strong>not found</strong> - nothing is guessed or filled in.
        </p>
      </section>

      <section className="sm-toc">
        <h2 className="sm-h2">Contents</h2>
        <ol>
          {model.sections.map((s, i) => (
            <li key={s.topic}>
              <a href={`#sm-sec-${s.topic}`}>
                <span className="sm-toc-n">{String(i + 1).padStart(2, '0')}</span>
                <span className="sm-toc-name">{s.title}</span>
                <span className="sm-toc-meta">
                  {s.gaps.length > 0 ? 'has gaps' : s.researchedDeeper ? 'researched further' : ''}
                </span>
              </a>
            </li>
          ))}
        </ol>
      </section>

      {model.sections.map((s, i) => (
        <section key={s.topic} id={`sm-sec-${s.topic}`} className="sm-topic">
          <h2 className="sm-h2">
            <span className="sm-h2-n">{String(i + 1).padStart(2, '0')}</span>
            {s.title}
          </h2>
          {s.images.length > 0 && (
            <div className={s.images.length > 1 ? 'sm-figs sm-figs-2' : 'sm-figs'}>
              {s.images.map((img) => (
                <figure key={img.src} className="sm-fig">
                  <img src={img.src} alt="" />
                  <figcaption>{imageCaption(img)}</figcaption>
                </figure>
              ))}
            </div>
          )}
          <div className="sm-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.markdown}</ReactMarkdown>
          </div>
          {s.gaps.length > 0 && (
            <p className="sm-gap">
              <strong>Not found.</strong> {s.gaps.join(' ')}
            </p>
          )}
          {s.researchedDeeper && <p className="sm-gap sm-gap-note">This section needed research beyond what was already stored.</p>}
          {s.footnotes.length > 0 && (
            <ol className="sm-notes">
              {s.footnotes.map((f) => (
                <li key={f.n} value={f.n}>
                  <span className="sm-note-title">{f.title}</span>
                  {f.direct && <> <span className="sm-note-url">{f.url}</span></>}
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}

      {model.costLine && <p className="sm-methods">{model.costLine}.</p>}
    </>
  );
}

function DailyReportBody({ model }: { model: DailyReportModel }) {
  return (
    <>
      <section className="sm-cover">
        <div className="sm-cover-brand">
          <Logo name={model.company.name} website={model.company.website} logoUrl={model.company.logoUrl} className="sm-cover-logo" />
          <p className="sm-eyebrow">Stratemark · Today</p>
        </div>
        <h1 className="sm-cover-title">{model.company.name}</h1>
        <div className="sm-rule" />
        <ul className="sm-cover-meta">
          <li>{model.dateText}</li>
          <li>
            {model.items.length} {model.items.length === 1 ? 'update' : 'updates'}
            {model.counts.length > 0 && <> · {model.counts.map((c) => `${c.count} ${c.label.toLowerCase()}`).join(' · ')}</>}
          </li>
        </ul>
        <p className="sm-cover-note">
          Every update shows who reported it and when, and links to its source. Headlines are the publishers&apos; own. Social
          items show the sentiment research tagged them with; nothing here is guessed.
        </p>
      </section>

      {model.items.map((item) => (
        <section key={item.n} className="sm-topic sm-update">
          <p className="sm-kind">
            {item.kindLabel}
            {item.sentiment && <span className="sm-sentiment"> · {item.sentiment}</span>}
          </p>
          <h2 className="sm-h2 sm-update-title">
            <span className="sm-h2-n">{String(item.n).padStart(2, '0')}</span>
            {item.title}
          </h2>
          <p className="sm-sub">{item.byline}</p>
          {item.images.length > 0 && (
            <div className="sm-figs">
              {item.images.map((img) => (
                <figure key={img.src} className="sm-fig">
                  <img src={img.src} alt="" />
                  <figcaption>{imageCaption(img)}</figcaption>
                </figure>
              ))}
            </div>
          )}
          {item.summary && <p className="sm-lede">{item.summary}</p>}
          <p className="sm-note-line">
            <sup>[{item.n}]</sup> <span className="sm-note-title">{item.source.title}</span>
            {item.source.direct && <> <span className="sm-note-url">{item.source.url}</span></>}
          </p>
        </section>
      ))}
    </>
  );
}

function ProductReportBody({ model }: { model: ProductReportModel }) {
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

function PersonReportBody({ model }: { model: PersonReportModel }) {
  return (
    <>
      <section className="sm-cover">
        <div className="sm-cover-brand">
          <Logo name={model.company.name} website={model.company.website} logoUrl={model.company.logoUrl} className="sm-cover-logo" />
          <p className="sm-eyebrow">Stratemark · Person report</p>
        </div>
        {model.portrait && (
          <figure className="sm-portrait">
            <img src={model.portrait.src} alt="" />
            <figcaption>{model.portrait.credit}</figcaption>
          </figure>
        )}
        <h1 className="sm-cover-title">{model.person.name}</h1>
        <div className="sm-rule" />
        <ul className="sm-cover-meta">
          <li>{model.person.role}</li>
          <li>{model.company.name} · {model.person.group}</li>
          <li>{model.dateText}</li>
        </ul>
        <p className="sm-cover-note">
          What research reported, with its source. A detail research did not surface says <strong>Not reported</strong>; nothing is
          inferred. {model.portrait ? '' : 'No verified portrait was found, so none is shown.'}
        </p>
      </section>

      <section className="sm-topic">
        <h2 className="sm-h2">At a glance</h2>
        <table className="sm-table">
          <tbody>
            {model.facts.map((f) => (
              <tr key={f.label} className={f.value ? undefined : 'sm-unknown'}>
                <th>{f.label}</th>
                <td>{f.value ?? 'Not reported'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {model.bio && <p className="sm-lede" style={{ marginTop: '4mm' }}>{model.bio}</p>}
        {model.evidence && (
          <blockquote className="sm-quote">
            <p>&ldquo;{model.evidence.quote}&rdquo;</p>
            <cite>
              {model.evidence.sourceTitle}{model.evidence.retrieved ? ` · retrieved ${model.evidence.retrieved}` : ''} · {model.evidence.url}
            </cite>
          </blockquote>
        )}
      </section>

      {model.deeper && (
        <section className="sm-topic">
          <h2 className="sm-h2">Deeper research</h2>
          <div className="sm-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{model.deeper.markdown}</ReactMarkdown>
          </div>
          {model.deeper.footnotes.length > 0 && (
            <ol className="sm-notes">
              {model.deeper.footnotes.map((f) => (
                <li key={f.n} value={f.n}>
                  <span className="sm-note-title">{f.title}</span>
                  {f.direct && <> <span className="sm-note-url">{f.url}</span></>}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </>
  );
}

function TranscriptBody({ job }: { job: Extract<PrintJob, { kind: 'transcript' }> }) {
  return (
    <>
      <Cover
        eyebrow="Stratemark · Research conversation"
        title={job.title}
        meta={[job.dateText, job.scopeLabel ?? '', `${job.messages.length} messages`].filter(Boolean)}
      />
      <section className="sm-transcript">
        {job.messages.map((m) => {
          if (m.role === 'user') {
            return (
              <div key={m.id} className="sm-turn sm-turn-user">
                <p className="sm-who">You</p>
                <p>{m.text}</p>
              </div>
            );
          }
          const cites = usableCitations(m.citations ?? []);
          return (
            <div key={m.id} className="sm-turn">
              <p className="sm-who">Stratemark</p>
              <div className="sm-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{splitFollowUps(m.text).body}</ReactMarkdown>
              </div>
              {cites.length > 0 && (
                <ol className="sm-notes">
                  {cites.map((c, i) => (
                    <li key={c.url} value={i + 1}>
                      <span className="sm-note-title">{publisherOf(c.url, c.title)}</span>
                      {/* A grounding redirect is opaque and expires; printing it helps no reader. */}
                      {!isRedirectCitation(c.url) && <> <span className="sm-note-url">{c.url}</span></>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}

export function PrintDocument({ job }: { job: PrintJob }) {
  return (
    <div className="sm-print-doc" aria-hidden>
      {job.kind === 'marketReport' ? <MarketReportBody model={job.model} /> : job.kind === 'report' ? <ReportBody model={job.model} /> : job.kind === 'topicReport' ? <TopicReportBody model={job.model} /> : job.kind === 'dailyReport' ? <DailyReportBody model={job.model} /> : job.kind === 'personReport' ? <PersonReportBody model={job.model} /> : job.kind === 'productReport' ? <ProductReportBody model={job.model} /> : <TranscriptBody job={job} />}
    </div>
  );
}
