/**
 * The printable report entry point: picks the body for each report kind (see
 * print/*Body.tsx).
 * Rendered off-screen into document.body and shown only while printing, so
 * "Save as PDF" always produces this layout regardless of the page the user
 * was on. Styling lives in print.css.
 */
import type { CardWithCompany, CompanyReport, ThreadMessage } from '@mi/contracts';
import type { ReportModel } from './exportModel';
import type { FullReportModel } from './fullReportModel';
import type { TopicReportModel } from './topicReportModel';
import type { DailyReportModel } from './dailyReportModel';
import type { PersonReportModel } from './personReportModel';
import type { ProductReportModel } from './productReportModel';
import { ReportBody } from './print/ReportBody';
import { MarketReportBody } from './print/MarketReportBody';
import { TopicReportBody } from './print/TopicReportBody';
import { DailyReportBody } from './print/DailyReportBody';
import { PersonReportBody } from './print/PersonReportBody';
import { ProductReportBody } from './print/ProductReportBody';
import { CompanyReportBody } from './print/CompanyReportBody';
import { TranscriptBody } from './print/TranscriptBody';
import './print/tokens.css';
import './print.css';

export type PrintJob =
  | { kind: 'report'; model: ReportModel }
  | { kind: 'marketReport'; model: FullReportModel }
  | { kind: 'topicReport'; model: TopicReportModel }
  | { kind: 'dailyReport'; model: DailyReportModel }
  | { kind: 'personReport'; model: PersonReportModel }
  | { kind: 'productReport'; model: ProductReportModel }
  | { kind: 'companyReport'; report: CompanyReport; card: CardWithCompany | null }
  | { kind: 'transcript'; title: string; scopeLabel: string | null; dateText: string; messages: readonly ThreadMessage[] };

export function PrintDocument({ job }: { job: PrintJob }) {
  return (
    <div className={job.kind === 'personReport' || job.kind === 'productReport' ? 'sm-print-doc sm-rowheads' : 'sm-print-doc'} aria-hidden>
      {job.kind === 'marketReport' ? <MarketReportBody model={job.model} /> : job.kind === 'report' ? <ReportBody model={job.model} /> : job.kind === 'topicReport' ? <TopicReportBody model={job.model} /> : job.kind === 'dailyReport' ? <DailyReportBody model={job.model} /> : job.kind === 'personReport' ? <PersonReportBody model={job.model} /> : job.kind === 'productReport' ? <ProductReportBody model={job.model} /> : job.kind === 'companyReport' ? <CompanyReportBody report={job.report} card={job.card} /> : <TranscriptBody job={job} />}
    </div>
  );
}
