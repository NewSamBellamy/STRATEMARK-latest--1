import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { SafeLink } from '@/components/SafeLink';
import { lookupCompanyFilings } from '@/lib/ownership/secMajorShareholders';

const SHOWN = 8;

/**
 * The company's own recent SEC filings, newest first. Rendered only when the
 * lookup found some: a private company (or no reader) shows nothing. Same
 * label and panel-list treatment as the coverage list below it.
 */
export function SecFilings({ companyName }: { companyName: string | null | undefined }) {
  const filings = useQuery({
    queryKey: ['sec-company-filings', companyName],
    queryFn: () => lookupCompanyFilings(companyName),
    enabled: Boolean(companyName),
    staleTime: Infinity,
  }).data;
  if (!filings || filings.length === 0) return null;
  return (
    <section aria-label="Filed with the SEC">
      <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted">Filed with the SEC</h4>
      <ul className="panel divide-y divide-border overflow-hidden">
        {filings.slice(0, SHOWN).map((filing) => (
          <li key={filing.url}>
            <SafeLink
              href={filing.url}
              className="flex items-start gap-4 px-4 py-3 transition-colors hover:bg-surface-2/60"
              title="Open the filed document on sec.gov"
            >
              <span className="w-[78px] shrink-0 pt-0.5 text-xs tabular-nums text-muted">{filing.filingDate}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-content">{filing.title}</span>
                  <span className="text-xs text-muted">{filing.form}{filing.reportDate && filing.reportDate !== filing.filingDate ? ` · period ${filing.reportDate}` : ''}</span>
                </span>
                {filing.events.length > 0 && <span className="mt-0.5 block text-sm text-muted">{filing.events.join(' · ')}</span>}
              </span>
              <ExternalLink className="mt-1 h-3 w-3 shrink-0 text-faint" aria-hidden />
            </SafeLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
