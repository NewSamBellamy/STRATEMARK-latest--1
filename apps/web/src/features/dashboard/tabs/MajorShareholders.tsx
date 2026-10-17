import { useQuery } from '@tanstack/react-query';
import { UnknownInline } from '@/features/card/UnknownValue';
import { lookupMajorShareholders } from '@/lib/ownership/secMajorShareholders';
import { FieldLabel, SectionHeader, SourceLink } from './TabKit';

/**
 * 5%+ holders from their own SEC Schedule 13D/13G filings. Rendered only when
 * the lookup found rows: a private company (or no reader) shows nothing, not
 * an empty frame. Same panel + table treatment as the funding rounds above.
 */
export function MajorShareholders({ companyName }: { companyName: string | null | undefined }) {
  const holders = useQuery({
    queryKey: ['sec-major-shareholders', companyName],
    queryFn: () => lookupMajorShareholders(companyName),
    enabled: Boolean(companyName),
    staleTime: Infinity,
  }).data;
  if (!holders || holders.length === 0) return null;
  return (
    <section aria-label="Major shareholders">
      <SectionHeader
        title="Major shareholders"
        description="Holders reporting 5% or more in their own SEC Schedule 13D/13G filings, latest filing each. Percentages are as filed; nothing is estimated."
      />
      <div className="panel overflow-hidden">
        <div className="border-b border-border bg-surface-2/60 px-4 py-2">
          <FieldLabel>SEC filings · {holders.length}</FieldLabel>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-medium">Holder</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">% of class</th>
                <th scope="col" className="px-2 py-2 font-medium">Filed</th>
                <th scope="col" className="px-4 py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {holders.map((h) => (
                <tr key={h.filingUrl}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-content">{h.holder}</p>
                    {h.jointFilers.length > 0 && (
                      <p className="line-clamp-2 text-xs text-muted">With {h.jointFilers.join(', ')}</p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-content">
                    {h.percentOfClass != null ? `${h.percentOfClass}%` : <UnknownInline />}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-xs font-semibold tabular-nums text-primary-ink">
                    {h.filingDate}
                    <span className="ml-1.5 font-normal text-muted">{h.form.replace('SCHEDULE ', '')}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <SourceLink url={h.filingUrl} label="SEC filing" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
