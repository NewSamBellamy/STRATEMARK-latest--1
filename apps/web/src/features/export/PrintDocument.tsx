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
import type { ReportImage, TopicReportModel } from './topicReportModel';
import './print.css';

export type PrintJob =
  | { kind: 'report'; model: ReportModel }
  | { kind: 'topicReport'; model: TopicReportModel }
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
          <header className="sm-company-head">
            <Logo name={c.name} website={c.website} logoUrl={c.logoUrl} className="sm-logo" />
            <div>
              <h2 className="sm-h2">
                {multi && <span className="sm-h2-n">{String(i + 1).padStart(2, '0')}</span>}
                {c.name}
              </h2>
              {c.hq && <p className="sm-sub">{c.hq}</p>}
            </div>
          </header>
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
      {job.kind === 'report' ? <ReportBody model={job.model} /> : job.kind === 'topicReport' ? <TopicReportBody model={job.model} /> : <TranscriptBody job={job} />}
    </div>
  );
}
