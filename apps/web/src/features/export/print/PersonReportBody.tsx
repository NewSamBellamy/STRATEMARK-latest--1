/** The person report. */
import { SafeMarkdown } from '@/components/ResearchMarkdown';
import { Logo } from '@/features/card/Logo';
import type { PersonReportModel } from '../personReportModel';

export function PersonReportBody({ model }: { model: PersonReportModel }) {
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
            <SafeMarkdown>{model.deeper.markdown}</SafeMarkdown>
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
