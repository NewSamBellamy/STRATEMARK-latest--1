import { usableCitations, type DashboardTab } from '@mi/contracts';
import { useDashboardTab } from '@/hooks/data';

/** One quiet source inspector shared by every researched company section. */
export function DashboardSources({ companyId, tab }: { companyId: string; tab: DashboardTab }) {
  const query = useDashboardTab(companyId, tab);
  if (!query.data || tab === 'metrics' || tab === 'live_landing') return null;
  const citations = usableCitations(query.data.citations);
  if (!citations.length) return (
    <p className="mt-4 text-xs text-muted">
      No research sources were retained for this section. Treat it as unconfirmed research notes.
    </p>
  );
  return (
    <details className="mt-4 rounded-lg border border-border bg-surface px-4 py-3 text-xs text-muted">
      <summary className="cursor-pointer font-medium text-content">Research sources · {citations.length}</summary>
      <p className="mt-3 leading-relaxed">
        Search attribution for this section, not independent verification of every claim.
        {' '}Open the sources to check their context and reporting dates.
      </p>
      {query.data.lastRefreshedAt && <p className="mt-2">
        Research collected: {query.data.lastRefreshedAt.slice(0, 10)} — not the source publication date.
      </p>}
      <ul className="mt-3 space-y-2">
        {citations.map(citation => <li key={citation.url}>
          <a href={citation.url} target="_blank" rel="noopener noreferrer" className="break-words text-primary-ink hover:underline">
            {citation.title}
          </a>
        </li>)}
      </ul>
    </details>
  );
}
