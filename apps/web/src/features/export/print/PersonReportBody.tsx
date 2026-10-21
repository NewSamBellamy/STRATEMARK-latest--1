/** The person report: dark cover with the portrait (when one was verified), the facts, the research and its notes. */
import { SafeMarkdown } from '@/components/ResearchMarkdown';
import { Logo } from '@/features/card/Logo';
import type { PersonReportModel } from '../personReportModel';
import { Cover } from './Cover';
import { CoverPicture, NoteList, ReportSection, Row } from './reportParts';

export function PersonReportBody({ model }: { model: PersonReportModel }) {
  const p = model.person;
  const co = model.company;
  return (
    <>
      <Cover
        eyebrow="Person report"
        title={p.name}
        subtitle={p.role}
        logo={<Logo name={co.name} website={co.website} logoUrl={co.logoUrl} className="sm-cv-logo-img" />}
        hero={model.portrait ? <CoverPicture src={model.portrait.src} caption={model.portrait.credit} portrait /> : undefined}
        meta={[`${co.name} · ${p.group}`, model.dateText]}
        note={
          <>
            <span>
              What research reported, with its source. A detail research did not surface says &ldquo;Not reported&rdquo;; nothing is
              inferred.
            </span>
            {!model.portrait && <span>No verified portrait was found, so none is shown.</span>}
          </>
        }
      />

      <ReportSection about={p.name} title="At a glance">
        <Row>
          <table className="sm-r-table sm-r-table--facts">
            <tbody>
              {model.facts.map((f) => (
                <tr key={f.label} className={f.value ? undefined : 'sm-r-row--unknown'}>
                  <th>{f.label}</th>
                  <td>{f.value ?? 'Not reported'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Row>
        {model.bio && <Row><p className="sm-r-lede" style={{ marginTop: '4mm' }}>{model.bio}</p></Row>}
        {model.evidence && (
          <Row>
            <blockquote className="sm-r-quote">
              <p>&ldquo;{model.evidence.quote}&rdquo;</p>
              <cite>
                {model.evidence.sourceTitle}{model.evidence.retrieved ? ` · retrieved ${model.evidence.retrieved}` : ''} &middot; {model.evidence.url}
              </cite>
            </blockquote>
          </Row>
        )}
      </ReportSection>

      {model.deeper && (
        <ReportSection about={p.name} title="Deeper research">
          <Row>
            <div className="sm-md sm-r-md">
              <SafeMarkdown>{model.deeper.markdown}</SafeMarkdown>
            </div>
          </Row>
          {model.deeper.footnotes.length > 0 && <Row><NoteList notes={model.deeper.footnotes} /></Row>}
        </ReportSection>
      )}
    </>
  );
}
