/** The deck-wide numbered sources, in two columns of small type. Numbers match the notes used throughout the report. */
import type { DeckSource } from '../fullReportModel';
import { Section, Row } from './Section';
import './signals.css';

export function SourcesList({ sources }: { sources: readonly DeckSource[] }) {
  if (sources.length === 0) return null;
  return (
    <Section id="sm-sources" className="sm-sources" head={<div className="sm-signals-head"><p className="sm-sig-eyebrow">References</p><h2 className="sm-signals-title sm-signals-title--run">Sources</h2></div>}>
      <Row>
        <ol className="sm-sources__list" data-testid="sources-list">
          {sources.map((s) => (
            <li key={s.n} value={s.n} className="sm-sources__item" data-n={s.n}>
              <span className="sm-sources__n">{s.n}</span>
              <span className="sm-sources__text">
                <span className="sm-sources__pub">{s.publisher}</span>
                {s.title && s.title !== s.publisher && <span className="sm-sources__title">, {s.title}</span>}
                <span className="sm-sources__url" data-testid="source-url">{s.url}</span>
              </span>
            </li>
          ))}
        </ol>
      </Row>
    </Section>
  );
}
