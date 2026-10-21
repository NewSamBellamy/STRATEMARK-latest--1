/** "How to read this report": what verified, estimated and unknown mean, and the counts behind this report. */
import type { FullReportModel } from '../fullReportModel';
import { Section, Row } from './Section';
import './signals.css';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function MethodsPage({ model }: { model: Pick<FullReportModel, 'methods'> }) {
  const m = model.methods;
  return (
    <Section id="sm-methods" className="sm-methodspage" head={<div><p className="sm-sig-eyebrow">Method</p><h2 className="sm-signals-title">How to read this report</h2></div>}>
      <Row>
        <p className="sm-methods__rule">Nothing in this report is invented. A figure appears only with the source that states it.</p>
        <dl className="sm-methods__defs">
          <div className="sm-methods__def" data-testid="methods-verified">
            <dt>Verified <span className="sm-methods__count">{m.verified}</span></dt>
            <dd>A source states the figure, or a person confirmed it. Printed in plain type with its source note.</dd>
          </div>
          <div className="sm-methods__def" data-testid="methods-estimated">
            <dt>Estimated <span className="sm-methods__count">{m.estimated}</span></dt>
            <dd><em>Derived by a stated method, or reported by a source.</em> Printed in italics and marked &ldquo;est.&rdquo;</dd>
          </div>
          <div className="sm-methods__def" data-testid="methods-unknown">
            <dt>Unknown <span className="sm-methods__count">{m.unknown}</span></dt>
            <dd><span className="sm-methods__unknown">Unknown</span> No source states it, so no number is shown. Never a zero, never a guess.</dd>
          </div>
        </dl>
        <ul className="sm-methods__facts">
          <li data-testid="methods-signals">{plural(m.signalsPrinted, 'signal', 'signals')} printed; {plural(m.signalsHeldBack, 'signal', 'signals')} held back for lack of a source.</li>
          <li data-testid="methods-profile">{plural(m.unsourcedProfileItems, 'profile item', 'profile items')} came from the stored company profile with no source attached. Each is labelled where it appears.</li>
        </ul>
      </Row>
    </Section>
  );
}
