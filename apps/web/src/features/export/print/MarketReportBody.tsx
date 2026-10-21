/** The market (deck) report: cover, contents, glance table, signals and one profile per company. */
import { Logo } from '@/features/card/Logo';
import type { FullReportCompany, FullReportModel } from '../fullReportModel';
import { Cover } from './Cover';
import { Row, Section } from './Section';
import { SignalSection } from './SignalSection';
import { MethodsPage } from './MethodsPage';
import { SourcesList } from './SourcesList';

/** Rule 9: an item the stored profile holds without a source says so, rather than looking sourced by sitting on a sourced page. */
export const UNSOURCED_PROFILE_NOTE = 'From the stored company profile; no source was attached to this item.';
function UnsourcedNote({ items }: { items: ReadonlyArray<{ sourced: boolean }> }) {
  return items.some((i) => !i.sourced) ? <p className="sm-methods sm-unsourced">{UNSOURCED_PROFILE_NOTE}</p> : null;
}

function ProfileBlocks({ c }: { c: FullReportCompany }) {
  return (
    <>
      {c.overview.length > 0 && (
        <Row>
          <div className="sm-block">
            <h3 className="sm-h3">Overview</h3>
            {c.overview.map((p) => <p key={p}>{p}</p>)}
          </div>
        </Row>
      )}
      {c.products.length > 0 && (
        <Row>
          <div className="sm-block">
            <h3 className="sm-h3">Products</h3>
            <ul>{c.products.map((p) => <li key={p.name}><strong>{p.name}</strong>{p.description ? <> &mdash; {p.description}</> : null}</li>)}</ul>
            <UnsourcedNote items={c.products} />
          </div>
        </Row>
      )}
      {c.leaders.length > 0 && (
        <Row>
          <div className="sm-block">
            <h3 className="sm-h3">Leadership</h3>
            <ul className="sm-cols">{c.leaders.map((l) => <li key={`${l.name}-${l.role}`}><strong>{l.name}</strong>, {l.role}</li>)}</ul>
            <UnsourcedNote items={c.leaders} />
          </div>
        </Row>
      )}
      {c.timeline.length > 0 && (
        <Row>
          <div className="sm-block">
            <h3 className="sm-h3">History</h3>
            <ul className="sm-timeline">{c.timeline.map((e) => <li key={`${e.date}-${e.title}`}><span className="sm-when">{e.date}</span> {e.title}</li>)}</ul>
            <UnsourcedNote items={c.timeline} />
          </div>
        </Row>
      )}
      {c.news.length > 0 && (
        <Row>
          <div className="sm-block">
            <h3 className="sm-h3">Recent news</h3>
            <ul>{c.news.map((n) => {
              const by = [n.publisher, n.date].filter(Boolean).join(', ');
              return <li key={n.url}>{n.title}{by ? <span className="sm-muted"> ({by})</span> : null}</li>;
            })}</ul>
          </div>
        </Row>
      )}
      {(c.risks.length > 0 || c.culture) && (
        <Row>
          <div className="sm-block">
            <h3 className="sm-h3">Risks and culture</h3>
            {c.risks.length > 0 && (
              <ul>{c.risks.map((r) => <li key={r.text}>{r.text}<span className="sm-muted"> ({r.source.title})</span></li>)}</ul>
            )}
            {c.culture && (
              <p>
                <strong>Culture.</strong> {c.culture.note}
                {c.culture.sources.length > 0 ? <span className="sm-muted"> ({[...new Set(c.culture.sources.map((s) => s.title))].join(', ')})</span> : null}
              </p>
            )}
            {c.risks.length > 0 && <p className="sm-methods">Each risk is attributed to the source that reports it and is not asserted as established fact.</p>}
          </div>
        </Row>
      )}
    </>
  );
}

export function MarketReportBody({ model }: { model: FullReportModel }) {
  const n = model.companies.length;
  // Exactly what the section prints: risks and culture notes print inside each company's profile, not here.
  const hasSignals = model.signals.some((x) => x.printable);
  return (
    <>
      <Cover
        eyebrow="Stratemark · Market report"
        title={model.title}
        meta={[
          model.dateText,
          `${n} ${n === 1 ? 'company' : 'companies'}${model.marketSignalCount > 0 ? ` · ${model.marketSignalCount} market signals` : ''}`,
          `${model.figureCount} sourced figures · ${model.unknownCount} marked Unknown`,
        ]}
      />

      <section className="sm-toc">
        <h2 className="sm-h2">Contents</h2>
        <ol>
          <li><a href="#sm-glance"><span className="sm-toc-n">&middot;</span><span className="sm-toc-name">The market at a glance</span><span className="sm-toc-meta" /></a></li>
          {hasSignals && <li><a href="#sm-signals"><span className="sm-toc-n">&middot;</span><span className="sm-toc-name">Signals</span><span className="sm-toc-meta">findings and their sources</span></a></li>}
          {model.companies.map((c, i) => (
            <li key={c.id}>
              <a href={`#sm-co-${c.id}`}>
                <span className="sm-toc-n">{String(i + 1).padStart(2, '0')}</span>
                <span className="sm-toc-name">{c.name}</span>
                <span className="sm-toc-meta">{c.hq ?? ''}</span>
              </a>
            </li>
          ))}
        </ol>
        <p className="sm-toc-note">Sources appear as numbered footnotes beneath each company&apos;s figures, and as publishers beneath each finding.</p>
      </section>

      <section id="sm-glance" className="sm-glance">
        <h2 className="sm-h2">The market at a glance</h2>
        <table className="sm-table sm-glance-table">
          <thead><tr><th>Company</th><th>Based in</th><th>Key figures</th></tr></thead>
          <tbody>
            {model.companies.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong><br /><span className="sm-muted">{c.role}</span></td>
                <td>{c.hq ?? '—'}</td>
                <td>{c.keyFigures.length > 0 ? c.keyFigures.map((f) => `${f.display} ${f.label.split(' ').map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ')}`).join(' · ') : <span className="sm-muted">No sourced figure yet</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sm-methods">Figures are the four strongest sourced ones each card shows. &ldquo;Estimated&rdquo; figures were reported by a source and have not been checked against the original document.</p>
      </section>

      {/* B2: signals, methods, sources */}
      <SignalSection model={model} />

      {model.companies.map((c, i) => (
        <Section
          key={c.id}
          id={`sm-co-${c.id}`}
          className="sm-company sm-profile"
          head={
            <div className="sm-company-head">
              <Logo name={c.name} website={c.website} logoUrl={c.logoUrl} className="sm-logo" />
              <div>
                <h2 className="sm-h2"><span className="sm-h2-n">{String(i + 1).padStart(2, '0')}</span>{c.name}</h2>
                <p className="sm-sub">{[c.hq, c.ownership, c.founded ? `Founded ${c.founded}` : null, c.role].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
          }
        >
              {c.oneLiner && <Row><p className="sm-lede">{c.oneLiner}</p></Row>}
              <ProfileBlocks c={c} />
              <Row>
          <div className="sm-block">
            <h3 className="sm-h3">Figures</h3>
            <table className="sm-table">
              <thead><tr><th>Metric</th><th>Value</th><th>Confidence</th><th>As of</th><th>Source</th></tr></thead>
              <tbody>
                {c.rows.map((r) => (
                  <tr key={r.type} className={r.unknown ? 'sm-unknown' : undefined}>
                    <td>{r.label}</td>
                    <td className="sm-num">{r.unknown ? 'Unknown' : r.valueText}</td>
                    <td>{r.unknown ? 'No sourced figure' : r.confidence.replace('_', ' ')}</td>
                    <td>{r.asOf ?? (r.unknown ? '—' : 'not stated')}</td>
                    <td>{r.footnotes.length ? r.footnotes.map((k) => <sup key={k}>[{k}]</sup>) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {c.footnotes.length > 0 && (
              <ol className="sm-notes">
                {c.footnotes.map((f) => (
                  <li key={f.n} value={f.n}>
                    <span className="sm-note-title">{f.title}</span>
                    {f.direct && <> <span className="sm-note-url">{f.url}</span></>}
                  </li>
                ))}
              </ol>
            )}
            {c.rows.some((r) => r.note) && (
              <p className="sm-methods">{c.rows.filter((r) => r.note && !r.unknown).map((r) => `${r.label}: ${r.note}`).join(' · ')}</p>
            )}
          </div>
              </Row>
        </Section>
      ))}
      <MethodsPage model={model} />
      <SourcesList sources={model.sources} />
    </>
  );
}
