import { Link } from 'react-router-dom';
import { FileText, ArrowRight, ClipboardCheck, Layers, Building2 } from 'lucide-react';
import { useReports } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { EmptyState } from '@/components/states/EmptyState';
import { formatRelative } from '@/lib/format';

const KIND_LABEL: Record<string, string> = {
  deck: 'market',
  company: 'company',
  site_audit: 'site audit',
};

export default function ReportsListPage() {
  const reports = useReports();
  return (
    <div className="mx-auto max-w-5xl">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
        Research archive
      </p>
      <h1 className="mt-1 font-display text-[32px] font-semibold tracking-[-0.03em] text-content">
        Reports
      </h1>
      <p className="mt-1 text-sm text-muted">
        Cited reports assembled from your saved research. Drafts without evidence stay clearly
        marked.
      </p>

      <div className="mt-6">
        <QueryBoundary
          query={reports}
          isEmpty={(list) => list.length === 0}
          empty={
            <EmptyState
              title="No reports yet"
              description="Open any deck or company dashboard and choose “Report” to compose an executive-ready report from its researched evidence."
              icon={<FileText className="h-6 w-6" />}
            />
          }
        >
          {(list) => (
            <ul className="space-y-3">
              {list.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/reports/${r.id}`}
                    className="panel group flex items-center gap-4 p-4 transition-all hover:-translate-y-px hover:border-primary/50 hover:shadow-card"
                  >
                    <span
                      className={
                        r.kind === 'site_audit'
                          ? 'grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-rose-200/70 bg-rose-50/70 text-rose-600 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400'
                          : r.kind === 'deck'
                            ? 'grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-teal-200/70 bg-teal-50/70 text-teal-600 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-400'
                            : 'grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-indigo-200/70 bg-indigo-50/70 text-indigo-600 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-400'
                      }
                    >
                      {r.kind === 'site_audit' ? (
                        <ClipboardCheck className="h-5 w-5" />
                      ) : r.kind === 'deck' ? (
                        <Layers className="h-5 w-5" />
                      ) : (
                        <Building2 className="h-5 w-5" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate font-display text-base font-semibold text-content">
                          {r.title}
                        </h2>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        <span className="capitalize">{KIND_LABEL[r.kind] ?? r.kind}</span> ·{' '}
                        {formatRelative(r.createdAt)} ·{' '}
                        <span
                          className={
                            r.citations.length > 0
                              ? 'font-medium text-primary-ink'
                              : 'font-medium text-amber-700'
                          }
                        >
                          {r.citations.length > 0
                            ? `${r.citations.length} ${r.citations.length === 1 ? 'source' : 'sources'}`
                            : 'Draft · needs sources'}
                        </span>
                      </p>
                    </div>
                    <ArrowRight className="h-5 w-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </QueryBoundary>
      </div>

    </div>
  );
}
