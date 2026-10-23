import { useMemo, type ReactNode } from 'react';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import type { CompanyReport, CompanyReportBlock, CompanyReportFigure, CompanyReportSection } from '@mi/contracts';
import { CardStage } from '@/features/card/CardStage';
import { buildCardView } from '@/features/card/card-view';
import { StratemarkMark } from '@/features/export/print/StratemarkMark';
import { SafeLink } from '@/components/SafeLink';
import { useCompanyCard } from '@/hooks/today';
import { useApiKey } from '@/lib/settings/apiKey';
import { cn } from '@/lib/cn';
import { ReportActions } from './ReportActions';
import { ANALYST_LABEL, STORED_DATA_LABEL, TRUST_LABEL, citationNumbers, freshnessLine, sourceById } from './reportModel';
import { useCompanyReport, useWriteCompanyReport } from './useCompanyReport';

const anchor = (id: string) => `report-${id}`;

/** Superscript source numbers that jump to the source list; numbers the report never cites are not shown. */
function Marks({ ids, numbers }: { ids: readonly string[]; numbers: Map<string, number> }) {
  const ns = [...new Set(ids.map((id) => numbers.get(id)).filter((n): n is number => n != null))].sort((a, b) => a - b);
  if (!ns.length) return null;
  return (
    <sup className="ml-0.5 whitespace-nowrap text-[10.5px] font-medium">
      {ns.map((n) => (
        <a key={n} href={`#report-src-${n}`} className="px-0.5 text-primary-ink hover:underline" aria-label={`Source ${n}`}>[{n}]</a>
      ))}
    </sup>
  );
}

function Figure({ figure, numbers }: { figure: CompanyReportFigure; numbers: Map<string, number> }) {
  const known = figure.display != null;
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-[11.5px] text-muted">{figure.label}</dt>
      <dd className={cn('mt-1 text-[20px] font-semibold tabular-nums', known ? 'text-content' : 'text-faint')}>
        {known ? figure.display : 'Not found yet'}
        <Marks ids={figure.citations} numbers={numbers} />
      </dd>
      <dd className="mt-0.5 text-[11px] text-faint">
        {known ? `${TRUST_LABEL[figure.trust]}${figure.asOf ? ` · as of ${figure.asOf}` : ''}` : 'No sourced figure yet'}
      </dd>
    </div>
  );
}

function Block({ block, numbers }: { block: CompanyReportBlock; numbers: Map<string, number> }) {
  switch (block.type) {
    case 'paragraph':
      return <p className="max-w-[72ch] text-[15px] leading-7 text-content">{block.text}<Marks ids={block.citations} numbers={numbers} /></p>;
    case 'analyst_view':
      return (
        <aside className="max-w-[72ch] rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-primary-ink">{ANALYST_LABEL}</p>
          <p className="mt-1 text-[14.5px] leading-7 text-content">{block.text}<Marks ids={block.citations} numbers={numbers} /></p>
        </aside>
      );
    case 'quote':
      return (
        <blockquote className="max-w-[72ch] border-l-2 border-border pl-4 text-[14.5px] italic leading-7 text-content">
          “{block.text}”<Marks ids={block.citations} numbers={numbers} />
          {block.attribution && <footer className="mt-1 text-[12px] not-italic text-muted">{block.attribution}</footer>}
        </blockquote>
      );
    case 'bullets':
      return (
        <ul className="max-w-[72ch] list-disc space-y-2 pl-5 text-[14.5px] leading-7 text-content marker:text-faint">
          {(block.items ?? []).map((item, i) => <li key={i}>{item.text}<Marks ids={item.citations} numbers={numbers} /></li>)}
        </ul>
      );
    case 'figures':
      return (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-soft md:grid-cols-3">
          {(block.figures ?? []).map((f) => <Figure key={f.metricType} figure={f} numbers={numbers} />)}
        </dl>
      );
  }
}

function SourceList({ report, numbers }: { report: CompanyReport; numbers: Map<string, number> }) {
  const byId = sourceById(report);
  const ordered = [...numbers.entries()].sort((a, b) => a[1] - b[1]);
  return (
    <ol className="space-y-3">
      {ordered.map(([id, n]) => {
        const s = byId.get(id);
        if (!s) return null;
        return (
          <li key={id} id={`report-src-${n}`} className="scroll-mt-20 text-[13px] leading-6">
            <span className="mr-2 font-medium tabular-nums text-faint">{n}.</span>
            <span className="font-medium text-content">
              {s.url ? <SafeLink href={s.url} className="text-primary-ink hover:underline">{s.title}</SafeLink> : s.title}
            </span>
            {s.asOf && <span className="text-faint"> · {s.asOf}</span>}
            <span className="block pl-5 text-[11.5px] text-muted">
              {s.kind === 'note' ? 'Your own note · not independently verified' : s.kind === 'stored' ? 'Stored research' : s.kind === 'figure' ? 'Stored figure' : null}
            </span>
            {s.excerpt && <span className="block pl-5 text-[12px] italic text-muted">“{s.excerpt}”</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Section({ section, report, numbers }: { section: CompanyReportSection; report: CompanyReport; numbers: Map<string, number> }) {
  return (
    <section id={anchor(section.id)} className="scroll-mt-20" aria-labelledby={`${anchor(section.id)}-h`}>
      <h2 id={`${anchor(section.id)}-h`} className="font-display text-[19px] font-semibold tracking-tight text-content">{section.title}</h2>
      <div className="mt-3 space-y-4">
        {section.id === 'sources'
          ? <SourceList report={report} numbers={numbers} />
          : section.blocks.map((b, i) => <Block key={i} block={b} numbers={numbers} />)}
      </div>
    </section>
  );
}

function Shell({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="space-y-6">
      <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-content">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to overview
      </button>
      {children}
    </div>
  );
}

/**
 * The living company report: the card, the company's headline and abstract, then the written sections with numbered
 * sources. It is read from what is stored (free) and is only rewritten when a person asks.
 */
export function CompanyReportView({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const q = useCompanyReport(companyId);
  const write = useWriteCompanyReport(companyId);
  const hasKey = useApiKey((s) => s.hasKey);
  const card = useCompanyCard(companyId).data ?? null;
  const result = q.data;
  const report = result?.report ?? null;
  const numbers = useMemo(() => (report ? citationNumbers(report) : new Map<string, number>()), [report]);

  if (!q.supported) {
    return <Shell onClose={onClose}><p className="panel p-5 text-[13.5px] text-muted">The company report needs the live research engine.</p></Shell>;
  }
  if (q.isPending) {
    return <Shell onClose={onClose}><p className="flex items-center gap-2 text-[13px] text-muted" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading the research on file…</p></Shell>;
  }
  if (!report) {
    return <Shell onClose={onClose}><p className="panel p-5 text-[13.5px] text-muted">There is no research on file for this company yet.</p></Shell>;
  }

  const needsWriting = report.status === 'stored_data' || result!.stale;
  const busy = write.isPending;
  return (
    <Shell onClose={onClose}>
      <header className="grid gap-6 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {card && <div aria-label={`${report.companyName} card`} className="mx-auto w-full max-w-[300px] lg:mx-0"><CardStage data={card} view={buildCardView(card)} /></div>}
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.16em] text-muted">
            <StratemarkMark size={16} /> Stratemark · Company report
          </p>
          <h1 className="mt-2 font-display text-[28px] font-semibold leading-tight tracking-tight text-content">{report.headline}</h1>
          <p className="mt-2 text-[12px] text-faint" data-testid="report-freshness">{freshnessLine(report)}</p>
          {report.abstract && <p className="mt-4 max-w-[68ch] text-[15.5px] leading-7 text-content">{report.abstract}<Marks ids={report.abstractCitations ?? []} numbers={numbers} /></p>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px]">
            {report.status === 'stored_data' && <span className="chip border-border bg-surface-2 text-muted">{STORED_DATA_LABEL}</span>}
            {result!.stale && report.status === 'ai' && <span className="chip border-amber-300 bg-amber-50 text-amber-900">Research has changed since this was written</span>}
            {report.basedOn.tabNames.length > 0 && <span className="text-faint">From {report.basedOn.tabNames.join(', ')}</span>}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {needsWriting && (
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={busy || !hasKey}
                title={hasKey ? 'Write the report with AI from everything on file. One model call.' : 'Add an API key to write the report with AI.'}
                onClick={() => write.mutate()}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} aria-hidden />
                {busy ? 'Writing the report…' : result!.stale && report.status === 'ai' ? 'Update report' : 'Write with AI'}
              </button>
            )}
            <ReportActions report={report} />
          </div>
          {(result!.notice || write.isError) && <p className="mt-2 text-[12px] text-muted" role="status">{write.isError ? write.error.message : result!.notice}</p>}
        </div>
      </header>
      <div className="grid gap-8 lg:grid-cols-[180px_minmax(0,1fr)]">
        <nav aria-label="Report sections" className="hidden lg:block">
          <ul className="sticky top-4 space-y-1.5 border-l border-border pl-3 text-[12.5px]">
            {report.sections.map((s) => (
              <li key={s.id}><a href={`#${anchor(s.id)}`} className="text-muted hover:text-primary-ink">{s.title}</a></li>
            ))}
          </ul>
        </nav>
        <div className="space-y-10">
          {report.sections.map((s) => <Section key={s.id} section={s} report={report} numbers={numbers} />)}
        </div>
      </div>
    </Shell>
  );
}
