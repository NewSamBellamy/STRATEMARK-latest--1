/**
 * The Company Report as the screen, the PDF and the share link all read it: numbered citations, the freshness line,
 * the abstract for the Overview, and the markdown a share link carries. Pure functions over the stored report; nothing
 * here writes a sentence or a figure of its own beyond labels ("Analyst view", "Not found yet").
 */
import type { CompanyReport, CompanyReportBlock, CompanyReportFigure, CompanyReportSource } from '@mi/contracts';
import { formatDateLong, formatRelative } from '@/lib/format';

export const ANALYST_LABEL = 'Analyst view';
export const STORED_DATA_LABEL = 'Assembled from stored research, no AI commentary';
export const TRUST_LABEL: Record<CompanyReportFigure['trust'], string> = {
  verified: 'Verified',
  user_verified: 'Confirmed by you',
  estimated: 'Estimated',
  unknown: 'Not found yet',
};

const blockCitations = (b: CompanyReportBlock): string[] => [
  ...b.citations,
  ...(b.items ?? []).flatMap((i) => i.citations),
  ...(b.figures ?? []).flatMap((f) => f.citations),
];

/** Citation numbers by first use in reading order (abstract, then the sections; the source list itself does not count). */
export function citationNumbers(report: CompanyReport): Map<string, number> {
  const known = new Set(report.sources.map((s) => s.id));
  const order = new Map<string, number>();
  const see = (id: string) => { if (known.has(id) && !order.has(id)) order.set(id, order.size + 1); };
  (report.abstractCitations ?? []).forEach(see);
  for (const section of report.sections) {
    if (section.id === 'sources') continue;
    for (const block of section.blocks) blockCitations(block).forEach(see);
  }
  // Anything the report read but never cited still has a number, after the cited ones, so the source list is complete.
  for (const s of report.sources) see(s.id);
  return order;
}

export function sourceById(report: CompanyReport): Map<string, CompanyReportSource> {
  return new Map(report.sources.map((s) => [s.id, s]));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Updated 3 days ago · based on 12 sources, 2 of your notes". */
export function freshnessLine(report: CompanyReport, now: number = Date.now()): string {
  const parts = [`Updated ${formatRelative(report.generatedAt, now)}`];
  const basis = [plural(report.basedOn.sources, 'source')];
  if (report.basedOn.notes > 0) basis.push(`${report.basedOn.notes} of your ${report.basedOn.notes === 1 ? 'note' : 'notes'}`);
  parts.push(`based on ${basis.join(', ')}`);
  return parts.join(' · ');
}

/** The Overview's two or three line abstract: the report's own, trimmed at a sentence. */
export function abstractOf(report: CompanyReport, maxChars = 320): string {
  const text = report.abstract.trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > maxChars * 0.5 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

export function isAnalystCommentary(block: CompanyReportBlock): boolean {
  return block.type === 'analyst_view';
}

const note = (ids: readonly string[], numbers: Map<string, number>) => {
  const ns = [...new Set(ids.map((id) => numbers.get(id)).filter((n): n is number => n != null))].sort((a, b) => a - b);
  return ns.length ? ` ${ns.map((n) => `[${n}]`).join('')}` : '';
};

/** The report as markdown with numbered footnotes: what a share link carries and what "Markdown" would download. */
export function companyReportToMarkdown(report: CompanyReport): string {
  const numbers = citationNumbers(report);
  const lines: string[] = [];
  lines.push(`_${freshnessLine(report)}_`, '');
  if (report.status === 'stored_data') lines.push(`_${STORED_DATA_LABEL}._`, '');
  if (report.abstract) lines.push(`${report.abstract}${note(report.abstractCitations ?? [], numbers)}`, '');
  for (const section of report.sections) {
    if (section.id === 'sources') continue;
    lines.push(`## ${section.title}`, '');
    for (const block of section.blocks) {
      if (block.type === 'paragraph') lines.push(`${block.text}${note(block.citations, numbers)}`, '');
      else if (block.type === 'analyst_view') lines.push(`> **${ANALYST_LABEL}.** ${block.text}${note(block.citations, numbers)}`, '');
      else if (block.type === 'quote') lines.push(`> “${block.text}”${block.attribution ? ` — ${block.attribution}` : ''}${note(block.citations, numbers)}`, '');
      else if (block.type === 'bullets') { for (const item of block.items ?? []) lines.push(`- ${item.text}${note(item.citations, numbers)}`); lines.push(''); }
      else if (block.type === 'figures') {
        for (const f of block.figures ?? []) {
          lines.push(`- ${f.label}: ${f.display ?? 'Not found yet'}${f.display ? ` (${TRUST_LABEL[f.trust].toLowerCase()}${f.asOf ? `, as of ${f.asOf}` : ''})` : ''}${note(f.citations, numbers)}`);
        }
        lines.push('');
      }
    }
  }
  lines.push('## Sources', '');
  const byId = sourceById(report);
  for (const [id, n] of [...numbers.entries()].sort((a, b) => a[1] - b[1])) {
    const s = byId.get(id);
    if (!s) continue;
    const where = s.kind === 'note' ? 'your own note, not independently verified' : s.url ?? 'stored research';
    lines.push(`${n}. ${s.title}${s.asOf ? ` (${s.asOf})` : ''} — ${where}`);
  }
  return lines.join('\n').trim();
}

/** What the share dialog and the PDF call the document. */
export function reportTitle(report: Pick<CompanyReport, 'companyName'>): string {
  return `${report.companyName} — Company Report`;
}

export function updatedDateLong(report: CompanyReport): string {
  return formatDateLong(report.generatedAt);
}
