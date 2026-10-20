/**
 * One printable signal (risk, culture, barrier, insight): the real card face beside what we can stand behind.
 * Text comes ONLY from the model entry: a brief (lead and every sourced point, each with its own note numbers), else the
 * card's stored summary, points and sources. The card's raw summary is never read here, and a held-back entry
 * (`card: null`) renders nothing at all.
 */
import type { SignalEntry, SignalKind } from '../fullReportModel';
import { PrintCardFace } from './PrintCardFace';
import './signals.css';

export const KIND_LABEL: Record<SignalKind, string> = { risk: 'Risk', culture: 'Culture', barrier: 'Barrier to entry', insight: 'Insight' };

export function Notes({ notes }: { notes: readonly number[] }) {
  if (notes.length === 0) return null;
  return <sup className="sm-signal__note" data-testid="note-refs">{notes.join(', ')}</sup>;
}

export function SignalCard({ entry }: { entry: SignalEntry }) {
  if (!entry.printable || !entry.card) return null;
  const { brief, stored } = entry;
  if (!brief && !stored) return null;
  const title = stored?.title ?? entry.card.card.title?.trim() ?? KIND_LABEL[entry.kind];
  // Per-point notes only where the model pairs a point with its own source (risk claims); otherwise one group of notes.
  const perPoint = entry.kind === 'risk' && stored !== null && stored.notes.length === stored.points.length;
  return (
    <article className={`sm-signal sm-signal--${entry.kind}`} data-testid="signal-card" data-kind={entry.kind}>
      <PrintCardFace data={entry.card} width="hero" />
      <div className="sm-signal__body">
        <p className="sm-signal__kind">{KIND_LABEL[entry.kind]}</p>
        <h3 className="sm-signal__title">{title}</h3>
        {brief ? (
          <>
            {brief.lead && <p className="sm-signal__lead">{brief.lead}<Notes notes={brief.notes} /></p>}
            <ul className="sm-signal__points">
              {brief.points.map((p, i) => <li key={i}>{p.text}<Notes notes={p.notes} /></li>)}
            </ul>
          </>
        ) : stored ? (
          <>
            {stored.summary && <p className="sm-signal__lead">{stored.summary}{stored.points.length === 0 && <Notes notes={stored.notes} />}</p>}
            {stored.points.length > 0 && (
              <ul className="sm-signal__points">
                {stored.points.map((t, i) => <li key={i}>{t}{perPoint && <Notes notes={[stored.notes[i]!]} />}</li>)}
              </ul>
            )}
            {!perPoint && stored.points.length > 0 && <p className="sm-signal__srcs">Sources <Notes notes={stored.notes} /></p>}
          </>
        ) : null}
      </div>
    </article>
  );
}
