/**
 * The company report. A report built from a company's card (`FullReportCompany`: the company dashboard's "Company
 * report") is a one-company version of the market spread: the dark cover with the real card face, the four face
 * figures as large numerals, the figures table, then the stored profile (overview, products, leadership, history,
 * news, risks, culture), every block with its notes. A report built from figures alone (`ReportCompany`: the short
 * deck fallback, or a company whose card could not be read) prints the figures table for each company.
 *
 * Figures: print code formats no number. The four numerals are the card face's own strings (`buildCardView`), the
 * table is `metricRowsFor`'s. Confidence prints one way everywhere: verified in solid type, estimated in italics with
 * "est.", unknown as the muted word "Unknown".
 */
import { publisherOf } from '@mi/contracts';
import { Logo } from '@/features/card/Logo';
import { buildCardView, faceFigureStatus } from '@/features/card/card-view';
import { isDirectSource, sourceHref } from '@/lib/sourceHref';
import type { MetricRow, ReportCompany, ReportModel } from '../exportModel';
import type { FullReportCompany, ReportSource } from '../fullReportModel';
import { Cover } from './Cover';
import { PrintCardFace } from './PrintCardFace';
import { NoteList, Ref, ReportSection, Row, UNSOURCED_PROFILE_NOTE, type NoteItem } from './reportParts';

type Company = ReportCompany | FullReportCompany;

const isRich = (c: Company): c is FullReportCompany => 'card' in c && !!(c as FullReportCompany).card;

const pad = (i: number) => String(i + 1).padStart(2, '0');
const normUrl = (url: string) => url.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/#.*$/, '').replace(/\/+$/, '');

// -- Figures -----------------------------------------------------------------

type Tone = 'verified' | 'estimated' | 'unknown';

function toneOf(r: MetricRow): Tone {
  return r.unknown ? 'unknown' : r.confidence === 'estimated' ? 'estimated' : 'verified';
}

const STATUS_WORD: Record<string, string> = { verified: 'Verified', user_verified: 'Verified (human checked)', estimated: 'Estimated' };

/** One printed figure: verified solid, estimated italic with "est.", unknown the muted word. */
function FigureValue({ row }: { row: MetricRow }) {
  const tone = toneOf(row);
  if (tone === 'unknown') return <>Unknown</>;
  return (
    <>
      {row.valueText}
      {tone === 'estimated' && <span className="sm-r-est">est.</span>}
    </>
  );
}

export function FiguresTable({ rows }: { rows: ReportCompany['rows'] }) {
  return (
    <table className="sm-r-table" data-testid="figures-table">
      <thead>
        <tr>
          <th>Figure</th>
          <th>Value</th>
          <th>Status</th>
          <th>As of</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const tone = toneOf(r);
          return (
            <tr key={r.type} className={`sm-r-row--${tone === 'estimated' ? 'est' : tone}`}>
              <td>{r.label}</td>
              <td className="sm-r-num">
                <FigureValue row={r} />
              </td>
              <td>{tone === 'unknown' ? 'No sourced figure' : STATUS_WORD[r.confidence] ?? 'Verified'}</td>
              <td>{r.asOf ?? (tone === 'unknown' ? '—' : 'not stated')}</td>
              <td>{r.footnotes.length ? r.footnotes.map((n) => <Ref key={n} n={n} />) : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** What the card face says about each figure that has a method note, once. */
function RowNotes({ rows }: { rows: ReportCompany['rows'] }) {
  const lines = rows.filter((r) => r.note && !r.unknown).map((r) => `${r.label}: ${r.note}`);
  return lines.length ? <p className="sm-r-label">{lines.join(' · ')}</p> : null;
}

/** The four figures the card face shows, as large numerals. Unknown slots say "Unknown", never a number. */
function FaceFigures({ c }: { c: FullReportCompany }) {
  const view = buildCardView(c.card);
  return (
    <div className="sm-r-figs" data-testid="face-figures">
      {view.faceMetrics.map((m) => {
        const has = m.metric?.value != null || m.metric?.reportedBand != null;
        const est = has && (m.metric?.confidence === 'estimated' || m.confidence === 'Source reported');
        const notes = c.rows.find((r) => r.type === m.metric?.metricType)?.footnotes ?? [];
        const tone = !has ? 'unknown' : est ? 'est' : 'verified';
        return (
          <div key={m.key} className={`sm-r-fig sm-r-fig--${tone}`} data-testid="face-figure">
            <p className="sm-r-fig-label">{m.label}</p>
            <p className="sm-r-fig-value">
              <span data-testid="face-figure-value">{has ? m.display : 'Unknown'}</span>
              {est && <span className="sm-r-est">est.</span>}
              {has && notes.map((n) => <Ref key={n} n={n} />)}
            </p>
            <p className="sm-r-fig-status">{has ? faceFigureStatus(m) : 'No source-backed figure found'}</p>
          </div>
        );
      })}
    </div>
  );
}

export const HOW_TO_READ =
  'Verified figures are in solid type and cite their source. Estimated figures are in italics and marked "est.": a source reported the figure but it has not been checked against the original document. Unknown means no source-backed figure was found; it is never guessed or filled in. Bracketed numbers point to the notes. Items from the stored company profile (overview, products, leadership, history) carry no source of their own and are labelled as such.';

// -- Notes across the profile ---------------------------------------------------------------------------------------

/** Number the profile's sources after the figure notes, one number per address, so a note means the same thing wherever it is cited. */
function noteBook(c: FullReportCompany) {
  const notes: NoteItem[] = c.footnotes.map((f) => ({ ...f }));
  const byUrl = new Map(notes.map((n) => [normUrl(n.url), n.n]));
  const note = (s: ReportSource): number => {
    const key = normUrl(s.url);
    let n = byUrl.get(key);
    if (!n) {
      n = notes.length + 1;
      byUrl.set(key, n);
      notes.push({ n, title: s.title, url: s.url, direct: s.direct });
    }
    return n;
  };
  const listOf = (ns: readonly number[]) => notes.filter((x) => ns.includes(x.n));
  return { note, listOf };
}

function UnsourcedNote() {
  return <p className="sm-r-label">{UNSOURCED_PROFILE_NOTE}</p>;
}

function Profile({ c }: { c: FullReportCompany }) {
  const book = noteBook(c);
  const risks = c.risks.map((r) => ({ ...r, n: book.note(r.source) }));
  const culture = c.culture ? { ...c.culture, ns: c.culture.sources.map(book.note) } : null;
  const news = c.news.map((n) => ({
    ...n,
    n: book.note({ title: n.publisher ?? publisherOf(n.url, n.title), url: sourceHref(n.url, n.title), direct: isDirectSource(n.url) }),
  }));
  const has = c.overview.length + c.products.length + c.leaders.length + c.timeline.length + news.length + risks.length > 0 || !!culture;
  if (!has) return null;
  return (
    <ReportSection about={c.name} title="Profile">
      {c.overview.length > 0 && (
        <Row>
          <div className="sm-r-block">
            <h3 className="sm-r-h3">Overview</h3>
            {c.overview.map((p) => <p key={p}>{p}</p>)}
            <UnsourcedNote />
          </div>
        </Row>
      )}
      {c.products.length > 0 && (
        <Row>
          <div className="sm-r-block">
            <h3 className="sm-r-h3">Products</h3>
            <ul>{c.products.map((p) => <li key={p.name}><strong>{p.name}</strong>{p.description ? <> &mdash; {p.description}</> : null}</li>)}</ul>
            {c.products.some((p) => !p.sourced) && <UnsourcedNote />}
          </div>
        </Row>
      )}
      {c.leaders.length > 0 && (
        <Row>
          <div className="sm-r-block">
            <h3 className="sm-r-h3">Leadership</h3>
            <ul className="sm-r-cols">{c.leaders.map((l) => <li key={`${l.name}-${l.role}`}><strong>{l.name}</strong>, {l.role}</li>)}</ul>
            {c.leaders.some((l) => !l.sourced) && <UnsourcedNote />}
          </div>
        </Row>
      )}
      {c.timeline.length > 0 && (
        <Row>
          <div className="sm-r-block">
            <h3 className="sm-r-h3">History</h3>
            <ul className="sm-r-timeline">{c.timeline.map((e) => <li key={`${e.date}-${e.title}`}><span className="sm-r-when">{e.date}</span> <span>{e.title}</span></li>)}</ul>
            {c.timeline.some((e) => !e.sourced) && <UnsourcedNote />}
          </div>
        </Row>
      )}
      {news.length > 0 && (
        <Row>
          <div className="sm-r-block">
            <h3 className="sm-r-h3">Recent news</h3>
            <ul>
              {news.map((n) => {
                const by = [n.publisher, n.date].filter(Boolean).join(', ');
                return <li key={n.url}>{n.title}{by ? <span className="sm-r-muted"> ({by})</span> : null}<Ref n={n.n} /></li>;
              })}
            </ul>
            <NoteList notes={book.listOf(news.map((n) => n.n))} />
          </div>
        </Row>
      )}
      {risks.length > 0 && (
        <Row>
          <div className="sm-r-block">
            <h3 className="sm-r-h3">Risks reported</h3>
            <ul>{risks.map((r) => <li key={r.text}>{r.text}<Ref n={r.n} /></li>)}</ul>
            <NoteList notes={book.listOf(risks.map((r) => r.n))} />
          </div>
        </Row>
      )}
      {culture && (
        <Row>
          <div className="sm-r-block">
            <h3 className="sm-r-h3">Culture</h3>
            <p>{culture.note}{culture.ns.map((n) => <Ref key={n} n={n} />)}</p>
            <NoteList notes={book.listOf(culture.ns)} />
          </div>
        </Row>
      )}
    </ReportSection>
  );
}

// -- Bodies ----------------------------------------------------------------------------------------------------------

function CompanySpread({ c, model }: { c: FullReportCompany; model: ReportModel }) {
  const sourced = c.rows.length - c.unknownCount;
  return (
    <>
      <Cover
        eyebrow="Company report"
        title={c.name}
        subtitle={c.oneLiner}
        hero={<PrintCardFace data={c.card} width="hero" />}
        meta={[
          model.dateText,
          [c.hq, c.founded ? `founded ${c.founded}` : null].filter(Boolean).join(' · '),
          c.ownership ?? '',
          c.role,
          `${sourced} sourced figures · ${c.unknownCount} marked Unknown`,
        ].filter(Boolean)}
      />
      <ReportSection id={`sm-co-${c.id}`} about={c.name} title="Key figures">
        <Row><FaceFigures c={c} /></Row>
        <Row>
          <div className="sm-r-block">
            <h3 className="sm-r-h3">Figures in detail</h3>
            <FiguresTable rows={c.rows} />
            <RowNotes rows={c.rows} />
            <NoteList notes={c.footnotes} />
          </div>
        </Row>
        <Row><p className="sm-r-how" data-testid="how-to-read"><strong>How to read this.</strong> {HOW_TO_READ}</p></Row>
      </ReportSection>
      <Profile c={c} />
    </>
  );
}

/** Figures only: the short form, one section per company. */
function FiguresOnly({ model }: { model: ReportModel }) {
  const multi = model.companies.length > 1;
  const sourced = model.figureCount;
  return (
    <>
      <Cover
        eyebrow={model.kind === 'deck' ? 'Market report' : 'Company report'}
        title={model.title}
        meta={[
          model.dateText,
          `${model.companies.length} ${model.companies.length === 1 ? 'company' : 'companies'}`,
          `${sourced} sourced figures · ${model.unknownCount} marked Unknown`,
        ]}
      />
      {multi && (
        <section className="sm-r-toc">
          <h2 className="sm-r-h2" style={{ marginBottom: '6mm' }}>Contents</h2>
          <ol>
            {model.companies.map((c, i) => (
              <li key={c.id}>
                <a href={`#sm-co-${c.id}`}>
                  <span className="sm-r-toc-n">{pad(i)}</span>
                  <span className="sm-r-toc-name">{c.name}</span>
                  <span className="sm-r-toc-meta">{c.hq ?? ''}</span>
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}
      {model.companies.map((c, i) => (
        <ReportSection
          key={c.id}
          id={`sm-co-${c.id}`}
          about={multi ? model.title : c.name}
          n={multi ? pad(i) : undefined}
          title={multi ? c.name : 'Key figures'}
          className={multi ? 'sm-r-section--page' : undefined}
        >
          <Row>
            <div className="sm-r-block">
              <div style={{ display: 'flex', alignItems: 'center', gap: '4mm', marginBottom: '3mm' }}>
                <Logo name={c.name} website={c.website} logoUrl={c.logoUrl} className="sm-r-logo" />
                {c.hq && <p className="sm-r-sub" style={{ margin: 0 }}>{c.hq}</p>}
              </div>
              {c.oneLiner && <p className="sm-r-lede">{c.oneLiner}</p>}
              <FiguresTable rows={c.rows} />
              <RowNotes rows={c.rows} />
              <NoteList notes={c.footnotes} />
            </div>
          </Row>
          {i === 0 && <Row><p className="sm-r-how"><strong>How to read this.</strong> {HOW_TO_READ}</p></Row>}
        </ReportSection>
      ))}
    </>
  );
}

export function ReportBody({ model }: { model: ReportModel }) {
  const only = model.companies.length === 1 ? model.companies[0] : undefined;
  if (only && isRich(only)) return <CompanySpread c={only} model={model} />;
  return <FiguresOnly model={model} />;
}
