/** The company (topic) report: cover, contents, one section per researched topic. */
import { SafeMarkdown } from '@/components/ResearchMarkdown';
import { Logo } from '@/features/card/Logo';
import type { TopicReportModel } from '../topicReportModel';
import { imageCaption } from './shared';

export function TopicReportBody({ model }: { model: TopicReportModel }) {
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
            <SafeMarkdown>{s.markdown}</SafeMarkdown>
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
