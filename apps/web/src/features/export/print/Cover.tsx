/** The shared cover page of the deck, company and transcript reports. */

export function Cover({ eyebrow, title, meta }: { eyebrow: string; title: string; meta: string[] }) {
  return (
    <section className="sm-cover">
      <p className="sm-eyebrow">{eyebrow}</p>
      <h1 className="sm-cover-title">{title}</h1>
      <div className="sm-rule" />
      <ul className="sm-cover-meta">
        {meta.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      <p className="sm-cover-note">
        Every figure in this document carries its source. Where the research does not support a figure it is shown as{' '}
        <strong>Unknown</strong> - never guessed or filled in. &ldquo;Estimated&rdquo; means a source reported the
        figure but it has not yet been checked against the original document.
      </p>
    </section>
  );
}
