import { Link } from 'react-router-dom';
import { ArrowUpRight, FileText } from 'lucide-react';
import { EmptyState } from '@/components/states/EmptyState';
import { useMarkets, useReports } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { formatRelative } from '@/lib/format';

/** Older reports keep their label here; site audits are no longer started from this page. */
const KIND_LABEL: Record<string, string> = {
  deck: 'Market report',
  company: 'Company report',
  site_audit: 'Site audit',
};

export default function ReportsListPage() {
  const reports = useReports();
  const markets = useMarkets();
  // The report composer lives on the deck page (Share & export → Create report),
  // so "Create a report" takes you to your most recent deck.
  const latest = [...(markets.data ?? [])]
    .filter((m) => !m.archivedAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-content">Reports</h1>
          <p className="mt-1 text-sm text-muted">
            Each report is written from the research in your decks, with its sources, and kept here.
          </p>
        </div>
        {markets.isSuccess && (
          <Link
            to={latest ? `/markets/${latest.id}/deck` : '/history'}
            className="btn-primary shrink-0"
            title={
              latest
                ? `Opens ${latest.name}, your most recent deck. Choose Share & export, then Create report.`
                : 'You need a deck first. Open All Decks to pick one, or start a new deck.'
            }
          >
            Create a report
          </Link>
        )}
      </div>

      <div className="mt-6">
        <QueryBoundary
          query={reports}
          isEmpty={(list) => list.length === 0}
          empty={
            <EmptyState
              compact
              title="No reports yet"
              description="Open a deck or a company and choose Create a report. It is written from the research you already have, plus fresh research for what you ask it to focus on."
              icon={<FileText className="h-6 w-6" aria-hidden />}
            />
          }
        >
          {(list) => (
            <ul aria-label="Your reports" className="panel divide-y divide-border overflow-hidden">
              {list.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/reports/${r.id}`}
                    className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                        {KIND_LABEL[r.kind] ?? r.kind}
                      </p>
                      <h2 className="mt-0.5 truncate font-display text-base font-semibold text-content">{r.title}</h2>
                      <p className="mt-1 text-xs text-muted">
                        {formatRelative(r.createdAt)} ·{' '}
                        {r.citations.length > 0
                          ? `${r.citations.length} ${r.citations.length === 1 ? 'source' : 'sources'}`
                          : r.kind === 'deck' ? 'research plan' : 'no sources'}
                      </p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-faint transition-colors group-hover:text-primary-ink" aria-hidden />
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
