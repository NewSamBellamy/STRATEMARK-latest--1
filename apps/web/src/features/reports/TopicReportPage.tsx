/**
 * The finished company report: the on-screen report plus the one Share &
 * export menu. PDF, Markdown and JSON all come from the same model, so a
 * figure on screen is the figure in every file.
 */
import { useMemo, useState } from 'react';
import type { Report } from '@mi/contracts';
import { useCompany } from '@/hooks/data';
import { ExportMenu } from '@/features/export/ExportMenu';
import { downloadText, fileSlug, localDate } from '@/features/export/exportModel';
import { resolveReportImages } from '@/features/export/reportImages';
import { buildTopicReportModel, topicReportToJson, topicReportToMarkdown, type ReportCompanyInfo } from '@/features/export/topicReportModel';
import { buildReportShare } from '@/lib/share/codec';
import { TopicReportView } from './TopicReportView';

export function TopicReportPage({ report }: { report: Report }) {
  const company = useCompany(report.subjectId);
  const [preparing, setPreparing] = useState(false);

  const info: ReportCompanyInfo = useMemo(() => ({
    name: company.data?.name ?? report.title.replace(/ — Company Report.*$/, ''),
    logoUrl: company.data?.logoUrl ?? null,
    website: company.data?.websiteUrl ?? null,
    hq: company.data?.hqLocation ?? null,
  }), [company.data, report.title]);

  const stamp = localDate(new Date(report.createdAt));
  const base = fileSlug(info.name);

  return (
    <article className="brf-print-root panel p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight text-content sm:text-3xl">{info.name}</h1>
        <div className="brf-no-print">
          <ExportMenu
            share={{
              title: report.title,
              subtitle: 'Stratemark company report',
              build: async () => buildReportShare(
                { title: report.title, kind: 'company', markdown: report.markdown, citations: report.citations, createdAt: report.createdAt },
                null,
                [],
              ),
            }}
            downloads={[
              {
                key: 'pdf',
                label: preparing ? 'Preparing the PDF…' : 'PDF',
                hint: 'Cover, real images and screenshots, sources as footnotes',
                icon: 'pdf',
                disabled: preparing,
                onSelect: async ({ print }) => {
                  setPreparing(true);
                  try {
                    const images = await resolveReportImages(report);
                    print({ kind: 'topicReport', model: buildTopicReportModel(report, info, images) }, `${info.name} - Stratemark company report`);
                  } finally {
                    setPreparing(false);
                  }
                },
              },
              {
                key: 'md',
                label: 'Markdown',
                hint: 'Sources as numbered footnotes',
                icon: 'markdown',
                onSelect: () => downloadText(`${base}-report-${stamp}.md`, topicReportToMarkdown(report, info), 'text/markdown'),
              },
              {
                key: 'json',
                label: 'JSON',
                hint: 'The same sections, for other tools',
                icon: 'data',
                onSelect: () => downloadText(`${base}-report-${stamp}.json`, topicReportToJson(report, info), 'application/json'),
              },
            ]}
          />
        </div>
      </header>
      <TopicReportView report={report} company={info} />
    </article>
  );
}
