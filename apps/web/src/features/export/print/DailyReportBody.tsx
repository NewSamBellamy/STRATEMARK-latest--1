/** The Today report: dark cover, then one block per dated update, each with its source. */
import { Logo } from '@/features/card/Logo';
import type { DailyReportModel } from '../dailyReportModel';
import { Cover } from './Cover';
import { Figures, ReportSection, Row } from './reportParts';

export function DailyReportBody({ model }: { model: DailyReportModel }) {
  const co = model.company;
  return (
    <>
      <Cover
        eyebrow="Today"
        title={co.name}
        logo={<Logo name={co.name} website={co.website} logoUrl={co.logoUrl} className="sm-cv-logo-img" />}
        meta={[
          model.dateText,
          `${model.items.length} ${model.items.length === 1 ? 'update' : 'updates'}`,
          ...(model.counts.length > 0 ? [model.counts.map((c) => `${c.count} ${c.label.toLowerCase()}`).join(' · ')] : []),
        ]}
        note="Every update shows who reported it and when, and links to its source. Headlines are the publishers' own. Social items show the sentiment research tagged them with; nothing here is guessed."
      />

      <ReportSection about={co.name} title="Updates">
        {model.items.map((item) => (
          <Row key={item.n}>
            <article className="sm-r-update">
              <p className="sm-r-kind">
                {item.kindLabel}
                {item.sentiment && <span className="sm-r-sentiment"> &middot; {item.sentiment}</span>}
              </p>
              <h3 className="sm-r-update-title">
                <span className="sm-r-n">{String(item.n).padStart(2, '0')}</span>
                {item.title}
              </h3>
              <p className="sm-r-byline">{item.byline}</p>
              <Figures images={item.images} />
              {item.summary && <p className="sm-r-lede" style={{ marginBottom: 0 }}>{item.summary}</p>}
              <p className="sm-r-source">
                <sup className="sm-r-ref">[{item.n}]</sup> <span className="sm-r-note-title">{item.source.title}</span>
                {item.source.direct && <> <span className="sm-r-note-url">{item.source.url}</span></>}
              </p>
            </article>
          </Row>
        ))}
      </ReportSection>
    </>
  );
}
