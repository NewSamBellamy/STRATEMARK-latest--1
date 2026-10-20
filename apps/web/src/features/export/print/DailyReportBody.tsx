/** The Today report: one block per dated update. */
import { Logo } from '@/features/card/Logo';
import type { DailyReportModel } from '../dailyReportModel';
import { imageCaption } from './shared';

export function DailyReportBody({ model }: { model: DailyReportModel }) {
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
