/** "Signals": every printable signal, grouped by kind. Prints nothing at all when none is printable. */
import type { FullReportModel, SignalKind } from '../fullReportModel';
import { Row, Section } from './Section';
import { SignalCard } from './SignalCard';
import './signals.css';

const GROUPS: ReadonlyArray<{ kind: SignalKind; title: string }> = [
  { kind: 'barrier', title: 'Barriers to entry' },
  { kind: 'insight', title: 'Insights' },
  { kind: 'risk', title: 'Risks' },
  { kind: 'culture', title: 'Culture' },
];

export function SignalSection({ model }: { model: Pick<FullReportModel, 'signals'> }) {
  const printable = model.signals.filter((s) => s.printable && s.card);
  if (printable.length === 0) return null;
  return (
    <Section
      id="sm-signals"
      className="sm-signals-sec"
      head={(
        <div className="sm-signals-head">
          <p className="sm-sig-eyebrow">Findings</p>
          <h2 className="sm-signals-title sm-signals-title--run">Signals</h2>
        </div>
      )}
    >
      {GROUPS.flatMap(({ kind, title }, g) => printable.filter((s) => s.kind === kind).map((e, i) => (
        // The group title and the opener line travel inside the first card's row, so they can never be stranded alone on a page.
        <Row key={e.cardId} className="sm-signals-row">
          {g === GROUPS.findIndex(({ kind: k }) => k === printable[0]!.kind) && i === 0 && (
            <p className="sm-signals-line">What the evidence says about this market beyond the figures. Each finding names its sources; a finding without one is left out.</p>
          )}
          {i === 0 && <h3 className={`sm-signals-group sm-signals-group--${kind}`}>{title}</h3>}
          <SignalCard entry={e} />
        </Row>
      )))}
    </Section>
  );
}
