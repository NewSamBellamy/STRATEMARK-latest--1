/** The company (topic) report: dark cover, contents, one section per researched topic with its notes. */
import { SafeMarkdown } from '@/components/ResearchMarkdown';
import { Logo } from '@/features/card/Logo';
import type { TopicReportModel } from '../topicReportModel';
import { imageCaption } from './shared';
import { Cover } from './Cover';
import { CoverPicture, Figures, NoteList, ReportSection, Row } from './reportParts';

export function TopicReportBody({ model }: { model: TopicReportModel }) {
  const co = model.company;
  return (
    <>
      <Cover
        eyebrow="Company report"
        title={co.name}
        subtitle={model.sections.map((s) => s.title).join(' · ')}
        logo={<Logo name={co.name} website={co.website} logoUrl={co.logoUrl} className="sm-cv-logo-img" />}
        layout={model.hero ? 'stack' : 'side'}
        hero={model.hero ? <CoverPicture src={model.hero.src} caption={imageCaption(model.hero)} /> : undefined}
        meta={[model.dateText, co.hq ?? '', `${model.sections.length} ${model.sections.length === 1 ? 'section' : 'sections'}`].filter(Boolean)}
        note={
          <>
            {model.demo && (
              <span>Demo report: compiled from the sample deck&apos;s stored research. A live report researches what is missing.</span>
            )}
            <span>
              Every figure carries its source as a numbered note. Where the research did not support a figure the report says
              &ldquo;not found&rdquo;; nothing is guessed or filled in.
            </span>
          </>
        }
      />

      <section className="sm-r-toc">
        <p className="sm-r-eyebrow">{co.name}</p>
        <h2 className="sm-r-h2" style={{ marginBottom: '6mm' }}>Contents</h2>
        <ol>
          {model.sections.map((s, i) => (
            <li key={s.topic}>
              <a href={`#sm-sec-${s.topic}`}>
                <span className="sm-r-toc-n">{String(i + 1).padStart(2, '0')}</span>
                <span className="sm-r-toc-name">{s.title}</span>
                <span className="sm-r-toc-meta">
                  {s.gaps.length > 0 ? 'has gaps' : s.researchedDeeper ? 'researched further' : ''}
                </span>
              </a>
            </li>
          ))}
        </ol>
      </section>

      {model.sections.map((s, i) => (
        <ReportSection key={s.topic} id={`sm-sec-${s.topic}`} about={co.name} n={i + 1} title={s.title}>
          {s.images.length > 0 && <Row><Figures images={s.images} /></Row>}
          <Row>
            <div className="sm-md sm-r-md">
              <SafeMarkdown>{s.markdown}</SafeMarkdown>
            </div>
          </Row>
          {s.gaps.length > 0 && (
            <Row>
              <p className="sm-r-gap">
                <strong>Not found.</strong> {s.gaps.join(' ')}
              </p>
            </Row>
          )}
          {s.researchedDeeper && (
            <Row><p className="sm-r-gap sm-r-gap--note">This section needed research beyond what was already stored.</p></Row>
          )}
          {s.footnotes.length > 0 && <Row><NoteList notes={s.footnotes} /></Row>}
        </ReportSection>
      ))}

      {model.costLine && <p className="sm-r-label">{model.costLine}.</p>}
    </>
  );
}
