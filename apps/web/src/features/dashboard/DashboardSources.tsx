import { publisherOf, usableCitations, type DashboardTab } from '@mi/contracts';
import { useDashboardTab } from '@/hooks/data';
import { Favicon } from '@/components/media/Favicon';

/** One quiet source inspector shared by every researched company section. */
export function DashboardSources({ companyId, tab }: { companyId: string; tab: DashboardTab }) {
  const query = useDashboardTab(companyId, tab);
  if (!query.data || tab === 'metrics' || tab === 'live_landing') return null;
  const citations = usableCitations(query.data.citations);
  // Grounding redirects carry the publisher in the title; group by publisher so
  // one site cited four times reads as one chip, not four Google links.
  const byPublisher = new Map<string, { name: string; url: string; count: number }>();
  for (const c of citations) {
    // "Google Search report for X · anthropic.com" → "anthropic.com".
    const raw = publisherOf(c.url, c.title);
    const name = raw.split(' · ').pop()!.trim() || raw;
    const prev = byPublisher.get(name);
    if (prev) prev.count += 1;
    else byPublisher.set(name, { name, url: c.url, count: 1 });
  }
  const publishers = [...byPublisher.values()].sort((x, y) => y.count - x.count);
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
      {!diagnostics && <p className="mt-1">Some publisher pages can’t be read directly from this device, so a few sources may stay unlisted.</p>}
      {diagnostics && readDetails}
    </div>
  );
  return (
    <div className="mt-4">
      <section aria-label="Research sources" className="rounded-lg border border-border bg-surface px-4 py-3 text-xs text-muted">
        <h3 className="font-medium text-content">Research sources · {citations.length}</h3>
        <p className="mt-3 leading-relaxed">
          Search attribution for this section, not independent verification of every claim.
          {' '}Open the sources to check their context and reporting dates.
        </p>
        {query.data.lastRefreshedAt && <p className="mt-2">
          Research collected: {query.data.lastRefreshedAt.slice(0, 10)} — not the source publication date.
        </p>}
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {publishers.map(({ name, url, count }) => <li key={name}>
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="inline-flex max-w-[240px] items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11.5px] text-content transition-colors hover:border-primary/40 hover:text-primary-ink">
              {/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(name) && <Favicon url={`https://${name}`} className="h-3.5 w-3.5 shrink-0 rounded-sm" />}
              <span className="truncate">{name}</span>
              {count > 1 && <span className="tabular-nums text-faint">×{count}</span>}
            </a>
          </li>)}
        </ul>
      </section>
      {diagnostics && readDetails}
    </div>
  );
}
