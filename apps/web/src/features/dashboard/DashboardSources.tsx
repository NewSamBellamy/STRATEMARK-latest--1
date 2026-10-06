import { usableCitations, type DashboardTab } from '@mi/contracts';
import { useDashboardTab } from '@/hooks/data';

/** One quiet source inspector shared by every researched company section. */
export function DashboardSources({ companyId, tab }: { companyId: string; tab: DashboardTab }) {
  const query = useDashboardTab(companyId, tab);
  if (!query.data || tab === 'metrics' || tab === 'live_landing') return null;
  const citations = usableCitations(query.data.citations);
  const diagnostics = query.data.sourceDiagnostics;
  const reads = Array.isArray(diagnostics?.reads) ? diagnostics.reads.filter(read =>
    read && typeof read.host === 'string' && /^[a-z0-9.-]+$/i.test(read.host) &&
    ['retrieved', 'blocked', 'unavailable'].includes(read.outcome) &&
    (read.httpStatus === undefined || (Number.isInteger(read.httpStatus) && read.httpStatus >= 100 && read.httpStatus <= 599))) : [];
  const eligibleSourceCount = typeof diagnostics?.eligibleSourceCount === 'number' && Number.isInteger(diagnostics.eligibleSourceCount) && diagnostics.eligibleSourceCount >= 0
    ? diagnostics.eligibleSourceCount : 0;
  const acceptedExcerptCount = typeof diagnostics?.acceptedExcerptCount === 'number' && Number.isInteger(diagnostics.acceptedExcerptCount) && diagnostics.acceptedExcerptCount >= 0
    ? diagnostics.acceptedExcerptCount : 0;
  const status = acceptedExcerptCount > 0
    ? `${acceptedExcerptCount} literal source excerpt${acceptedExcerptCount === 1 ? '' : 's'} passed the overview checks. Figures are assessed separately.`
    : eligibleSourceCount > 0
      ? 'Readable originals were found, but no excerpt passed the overview checks.'
      : reads.some(read => read.outcome === 'retrieved')
        ? 'Original pages were retrieved, but none met this overview’s source policy.'
        : reads.length > 0
          ? `No original page text was retained (${reads.filter(read => read.outcome === 'blocked').length} blocked, ${reads.filter(read => read.outcome === 'unavailable').length} unavailable).`
          : 'No original page reads were retained for this section.';
  const readDetails = reads.length > 0 && <details className="mt-3 rounded-lg border border-border bg-surface px-4 py-3 text-xs text-muted">
    <summary className="cursor-pointer font-medium text-content">Original source checks · {reads.length}</summary>
    <p className="mt-2 leading-relaxed">A successful page read is not independent verification of its claims.</p>
    <p className="mt-2 leading-relaxed">A blocked or unavailable read can reflect this app’s reader limits, network-safety rules, or source-retention policy; it does not by itself mean the publisher refused access.</p>
    <ul className="mt-3 space-y-1">
      {reads.map((read, index) => <li key={`${read.host}-${read.outcome}-${read.httpStatus ?? ''}-${index}`}>
        <span className="font-medium text-content">{read.host}</span>{' · '}
        {read.outcome}{read.httpStatus ? ` · HTTP ${read.httpStatus}` : read.outcome !== 'retrieved' ? ' · no HTTP response recorded' : ''}
      </li>)}
    </ul>
  </details>;
  if (!citations.length) return (
    <div className="mt-4 text-xs text-muted">
      <p>{diagnostics ? status : 'No research sources were retained for this section. Treat it as unconfirmed research notes.'}</p>
      {diagnostics && readDetails}
    </div>
  );
  return (
    <div className="mt-4">
      <details className="rounded-lg border border-border bg-surface px-4 py-3 text-xs text-muted">
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
      {diagnostics && readDetails}
    </div>
  );
}
