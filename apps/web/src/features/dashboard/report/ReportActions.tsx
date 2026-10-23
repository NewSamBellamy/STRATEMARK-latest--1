import type { CompanyReport } from '@mi/contracts';
import { ExportMenu } from '@/features/export/ExportMenu';
import { downloadText, fileSlug, localDate } from '@/features/export/exportModel';
import { useCompanyCard } from '@/hooks/today';
import { buildReportShare } from '@/lib/share/codec';
import { companyReportToMarkdown, reportTitle } from './reportModel';

/** Share link, PDF and Markdown for the company report. The PDF and the share carry the card preview and the Stratemark mark. */
export function ReportActions({ report }: { report: CompanyReport }) {
  const card = useCompanyCard(report.companyId).data ?? null;
  const title = reportTitle(report);
  const markdown = () => `# ${title}\n\n${companyReportToMarkdown(report)}\n`;
  const citations = report.sources.filter((s) => s.url).map((s) => ({ title: s.title, url: s.url! }));
  return (
    <ExportMenu
      share={{
        title,
        subtitle: 'Stratemark company report',
        build: async () => buildReportShare(
          { title, kind: 'company', markdown: markdown(), citations, createdAt: report.generatedAt },
          null,
          card ? [card] : [],
        ),
      }}
      downloads={[
        {
          key: 'company-report-pdf',
          label: 'Company report (PDF)',
          hint: 'The report with the card and Stratemark branding',
          icon: 'pdf',
          onSelect: ({ print }) => print({ kind: 'companyReport', report, card }, title),
        },
        {
          key: 'company-report-md',
          label: 'Company report (Markdown)',
          icon: 'markdown',
          onSelect: () => downloadText(`${fileSlug(report.companyName)}-company-report-${localDate()}.md`, markdown(), 'text/markdown'),
        },
      ]}
    />
  );
}
