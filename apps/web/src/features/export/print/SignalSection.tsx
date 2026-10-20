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
          <p className="sm-eyebrow">Findings</p>
          <h2 className="sm-signals-title">Signals</h2>
          <p className="sm-signals-line">What the evidence says about this market beyond the figures. Each finding names its sources; a finding without one is left out.</p>
        </div>
      )}
    >
      {GROUPS.flatMap(({ kind, title }) => {
        const entries = printable.filter((s) => s.kind === kind);
        if (entries.length === 0) return [];
        return [
          <Row key={`${kind}-h`} className="sm-signals-grouprow"><h3 className={`sm-signals-group sm-signals-group--${kind}`}>{title}</h3></Row>,
          ...entries.map((e) => <Row key={e.cardId}><SignalCard entry={e} /></Row>),
        ];
      })}
    </Section>
  );
}
