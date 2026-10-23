import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { StratemarkMark } from '@/features/export/print/StratemarkMark';
import { cn } from '@/lib/cn';
import { TabSection } from '../tabs/TabKit';
import { abstractOf, freshnessLine, STORED_DATA_LABEL } from './reportModel';
import { useCompanyReport } from './useCompanyReport';

/**
 * The Overview's lead: the company report in brief (headline, abstract, how fresh) with the way into the full document.
 * Read from what is stored, so it is free and always there; the companion site capture sits beside it when there is one.
 */
export function CompanyReportHero({ companyId, side, onOpen }: { companyId: string; side?: ReactNode; onOpen: () => void }) {
  const q = useCompanyReport(companyId);
  const report = q.data?.report ?? null;
  return (
    <TabSection title="Company report">
      <div className={cn('grid gap-4', side && 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]')}>
        <div className="panel flex min-w-0 flex-col p-5 sm:p-6" data-testid="company-report-hero">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.16em] text-muted">
            <StratemarkMark size={14} /> Stratemark
          </p>
          {q.isPending ? (
            <div className="mt-3 space-y-2" aria-hidden>
              <div className="h-5 w-2/3 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
              <div className="h-3 w-full animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
            </div>
          ) : report ? (
            <>
              <h3 className="mt-2 font-display text-[19px] font-semibold leading-snug tracking-tight text-content">{report.headline}</h3>
              {report.abstract && <p className="mt-2 max-w-[68ch] text-[14.5px] leading-7 text-content">{abstractOf(report)}</p>}
              <p className="mt-2 text-[11.5px] text-faint">
                {freshnessLine(report)}
                {report.status === 'stored_data' && ` · ${STORED_DATA_LABEL}`}
                {q.data?.stale && report.status === 'ai' && ' · research has changed since'}
              </p>
            </>
          ) : (
            <p className="mt-3 text-[14px] text-muted">No research is on file yet. Research this company and its report will build itself here.</p>
          )}
          <div className="mt-auto pt-4">
            <button type="button" onClick={onOpen} className="btn-ghost text-xs">
              Read company report <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
        {side}
      </div>
    </TabSection>
  );
}
