/** The living company report as a printed document: dark cover with the card face, then each written section and the numbered sources. */
import type { CardWithCompany, CompanyReport, CompanyReportBlock } from '@mi/contracts';
import { Logo } from '@/features/card/Logo';
import {
  ANALYST_LABEL, STORED_DATA_LABEL, TRUST_LABEL, citationNumbers, freshnessLine, sourceById,
} from '@/features/dashboard/report/reportModel';
import { Cover } from './Cover';
import { PrintCardFace } from './PrintCardFace';
import { ReportSection, Row } from './reportParts';

function marks(ids: readonly string[], numbers: Map<string, number>): string {
  const ns = [...new Set(ids.map((id) => numbers.get(id)).filter((n): n is number => n != null))].sort((a, b) => a - b);
  return ns.length ? ` ${ns.map((n) => `[${n}]`).join('')}` : '';
}

function Block({ block, numbers }: { block: CompanyReportBlock; numbers: Map<string, number> }) {
  if (block.type === 'paragraph') return <p className="sm-r-lede">{block.text}{marks(block.citations, numbers)}</p>;
  if (block.type === 'analyst_view') {
    return <p className="sm-r-lede"><strong>{ANALYST_LABEL}. </strong>{block.text}{marks(block.citations, numbers)}</p>;
  }
  if (block.type === 'quote') {
    return <blockquote className="sm-r-lede">“{block.text}”{block.attribution ? ` — ${block.attribution}` : ''}{marks(block.citations, numbers)}</blockquote>;
  }
  if (block.type === 'bullets') {
    return <ul>{(block.items ?? []).map((item, i) => <li key={i}>{item.text}{marks(item.citations, numbers)}</li>)}</ul>;
  }
  return (
    <table className="sm-r-table">
      <tbody>
        {(block.figures ?? []).map((f) => (
          <tr key={f.metricType}>
            <th scope="row">{f.label}</th>
            <td>{f.display ?? 'Unknown'}{marks(f.citations, numbers)}</td>
            <td className="sm-r-muted">{f.display ? `${TRUST_LABEL[f.trust]}${f.asOf ? `, as of ${f.asOf}` : ''}` : 'Not found yet'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CompanyReportBody({ report, card, website, logoUrl }: {
  report: CompanyReport;
  card: CardWithCompany | null;
  website?: string | null;
  logoUrl?: string | null;
}) {
  const numbers = citationNumbers(report);
  const byId = sourceById(report);
  const name = report.companyName;
  return (
    <>
      <Cover
        eyebrow="Company report"
        title={name}
        subtitle={report.headline}
        logo={<Logo name={name} website={website ?? null} logoUrl={logoUrl ?? null} className="sm-cv-logo-img" />}
        hero={card ? <PrintCardFace data={card} width="hero" /> : undefined}
        meta={[freshnessLine(report), report.status === 'stored_data' ? STORED_DATA_LABEL : 'Written with AI from the research on file, then checked: every claim cites a source'].filter(Boolean)}
      />
      {report.abstract && (
        <ReportSection about={name} title="In brief">
          <Row><p className="sm-r-lede">{report.abstract}{marks(report.abstractCitations ?? [], numbers)}</p></Row>
        </ReportSection>
      )}
      {report.sections.filter((s) => s.id !== 'sources').map((section) => (
        <ReportSection key={section.id} about={name} title={section.title}>
          {section.blocks.map((block, i) => <Row key={i}><Block block={block} numbers={numbers} /></Row>)}
        </ReportSection>
      ))}
      <ReportSection about={name} title="Sources">
        <Row>
          <ol className="sm-r-muted">
            {[...numbers.entries()].sort((a, b) => a[1] - b[1]).map(([id, n]) => {
              const s = byId.get(id);
              if (!s) return null;
              const where = s.kind === 'note' ? 'your own note, not independently verified' : s.url ?? 'stored research';
              return <li key={id} value={n}>{s.title}{s.asOf ? ` (${s.asOf})` : ''}: {where}</li>;
            })}
          </ol>
        </Row>
      </ReportSection>
    </>
  );
}
