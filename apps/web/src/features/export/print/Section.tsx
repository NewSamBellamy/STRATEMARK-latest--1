/**
 * The shared section wrapper. A section is a table whose <thead> holds its
 * heading: Chromium repeats a thead on every printed page, so a section that runs
 * onto a second page carries its name there. A table, never a <header>, which
 * index.css hides in print. Rows may break between blocks; blocks keep their own
 * break-inside: avoid.
 */
import type { ReactNode } from 'react';

/** One printed row of a running-head table: a block that may break across pages between rows. */
export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <tr><td className={className}>{children}</td></tr>;
}

export function Section({ id, className, head, children }: { id?: string; className?: string; head: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className={className}>
      <table className="sm-run">
        <thead><tr><th>{head}</th></tr></thead>
        <tbody>{children}</tbody>
      </table>
    </section>
  );
}
