/**
 * A section opener: a half-page band with a large numeral, the section title and one line saying what follows.
 * The market report uses it for "Companies"; the signals and methods sections call it the same way, e.g.
 *   <SectionOpener id="sm-signals-open" numeral="03" title="Signals" lead="What the research reports about risks, barriers and culture." />
 * `children` render beneath the band (a short roster, say); leave them out for a clean break page.
 */
import type { ReactNode } from 'react';

export interface SectionOpenerProps {
  /** Two-digit section number, written by the caller ("02"). */
  numeral: string;
  title: string;
  /** One line saying what follows. */
  lead: string;
  id?: string;
  children?: ReactNode;
}

export function SectionOpener({ numeral, title, lead, id, children }: SectionOpenerProps) {
  return (
    <section id={id} className="sm-opener">
      <div className="sm-opener__band">
        <p className="sm-opener__n" data-testid="opener-numeral">{numeral}</p>
        <h2 className="sm-opener__title">{title}</h2>
        <p className="sm-opener__lead">{lead}</p>
      </div>
      {children ? <div className="sm-opener__below">{children}</div> : null}
    </section>
  );
}
