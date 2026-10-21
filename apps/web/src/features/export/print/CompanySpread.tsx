/**
 * One company in the market report: a spread (the real card face on the left; name, HQ, ownership, one-liner and the
 * four face figures on the right) followed by the stored profile blocks, the figures table and its notes.
 *
 * The section is a Section (running-head table), so a profile that runs onto a second page carries the company name
 * there. The head is a small folio line; the large name belongs to the spread on the first page.
 *
 * Integrity (Rule 9): every figure is the model's string (overview entry `display`, row `valueText`); confidence prints
 * one way (FigureValue, and the table below); unsourced stored text keeps its label.
 */
import { Logo } from '@/features/card/Logo';
import type { FaceFigure, FullReportCompany } from '../fullReportModel';
import { FigureValue } from './FigureValue';
import { PrintCardFace } from './PrintCardFace';
import { Row, Section } from './Section';

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
      {(c.leaders.length > 0 || c.timeline.length > 0) && (
        <Row>
          <div className={c.leaders.length > 0 && c.timeline.length > 0 ? 'sm-pair' : undefined}>
            {c.leaders.length > 0 && (
              <div className="sm-block">
                <h3 className="sm-h3">Leadership</h3>
                <ul className="sm-cols">{c.leaders.map((l) => <li key={`${l.name}-${l.role}`}><strong>{l.name}</strong>, {l.role}</li>)}</ul>
                <UnsourcedNote items={c.leaders} />
              </div>
            )}
            {c.timeline.length > 0 && (
              <div className="sm-block">
                <h3 className="sm-h3">History</h3>
                <ul className="sm-timeline">{c.timeline.map((e) => <li key={`${e.date}-${e.title}`}><span className="sm-when">{e.date}</span> {e.title}</li>)}</ul>
                <UnsourcedNote items={c.timeline} />
              </div>
            )}
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

/** The deck-wide number of one of the company's own footnotes (its local number is only a position in `footnotes`). */
const deckNote = (c: FullReportCompany, local: number) => c.deckNotes[local - 1] ?? local;

function FiguresTable({ c }: { c: FullReportCompany }) {
  return (
    <div className="sm-block sm-figblock">
      <h3 className="sm-h3">Figures</h3>
      <table className="sm-table sm-fig-table">
        <thead><tr><th>Metric</th><th>Value</th><th>As of</th><th>Source</th></tr></thead>
        <tbody>
          {c.rows.map((r) => {
            const estimated = !r.unknown && r.confidence === 'estimated';
            return (
              <tr key={r.type} className={r.unknown ? 'sm-unknown' : undefined}>
                <td>{r.label}</td>
                <td className="sm-num">
                  {r.unknown ? <span className="sm-fv sm-fv--unknown">Unknown</span> : estimated ? <span className="sm-fv sm-fv--estimated">{r.valueText}<span className="sm-fv-est"> est.</span></span> : r.valueText}
                </td>
                <td>{r.asOf ?? (r.unknown ? '—' : 'not stated')}</td>
                <td>{r.footnotes.length ? r.footnotes.map((k) => <sup key={k} className="sm-note">{deckNote(c, k)}</sup>) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {c.footnotes.length > 0 && (
        <ol className="sm-notes">
          {c.footnotes.map((f) => (
            <li key={f.n} value={deckNote(c, f.n)}>
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
  );
}

export function CompanySpread({ company: c, index, section = '02' }: { company: FullReportCompany; index: number; section?: string }) {
  const num = String(index + 1).padStart(2, '0');
  const facts = [c.hq, c.ownership, c.founded ? `Founded ${c.founded}` : null].filter(Boolean);
  return (
    <Section
      id={`sm-co-${c.id}`}
      className="sm-company sm-profile sm-spreadsec"
      head={
        <div className="sm-company-head">
          <h2 className="sm-runhead"><span className="sm-runhead__sec">{section}</span><span className="sm-runhead__n">{num}</span>{c.name}</h2>
        </div>
      }
    >
      <Row>
        <div className="sm-spread" data-testid="company-spread">
          <div className="sm-spread__card"><PrintCardFace data={c.card} width="hero" /></div>
          <div className="sm-spread__side">
            <div className="sm-spread__id">
              <Logo name={c.name} website={c.website} logoUrl={c.logoUrl} className="sm-logo" />
              <p className="sm-spread__role">{c.role}</p>
            </div>
            <h3 className="sm-spread__name">{c.name}</h3>
            {facts.length > 0 && <p className="sm-spread__facts">{facts.join(' · ')}</p>}
            {c.oneLiner && <p className="sm-spread__line sm-lede">{c.oneLiner}</p>}
            <dl className="sm-spread__figs">
              {c.faceFigures.map((f: FaceFigure, i) => (
                <div key={`${f.label}-${i}`} className="sm-spread__fig">
                  <dt>{f.label}</dt>
                  <dd>
                    <FigureValue entry={f} className={f.display && f.display.length > 8 ? 'sm-fv--long' : undefined} />
                    {f.asOf ? <span className="sm-spread__asof">{f.asOf}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Row>
      <Row><FiguresTable c={c} /></Row>
      <ProfileBlocks c={c} />
    </Section>
  );
}
