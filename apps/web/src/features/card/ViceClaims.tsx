import { ExternalLink } from 'lucide-react';
import { publisherOf, type ViceClaim } from '@mi/contracts';
import { ViceDisclaimer } from './CardDisclaimer';
import { FactCheck } from '@/features/factcheck/FactCheck';
import { SafeLink } from '@/components/SafeLink';

/** Vice claims: every claim MUST show a source citation (spec §4, §9). */
export function ViceClaims({
  claims,
  companyName,
}: {
  claims: ViceClaim[];
  companyName?: string | null;
}) {
  return (
    <div className="panel-2 border-rose-200 p-4">
      <h4 className="mb-2 flex items-center gap-2 font-display text-sm font-semibold text-rose-700">
        Risk & controversy signals
      </h4>
      <div className="mb-3">
        <ViceDisclaimer />
      </div>
      <ul className="space-y-2.5">
        {claims.map((claim) => (
          <li key={claim.id} className="rounded-lg border border-border bg-surface p-3 text-sm">
            <p className="text-content">{claim.claimText}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <SafeLink
                href={claim.sourceUrl}
                className="inline-flex items-center gap-1 text-xs text-primary-ink hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                {publisherOf(claim.sourceUrl, claim.sourceTitle)}
              </SafeLink>
              <FactCheck claim={claim.claimText} companyName={companyName ?? null} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
