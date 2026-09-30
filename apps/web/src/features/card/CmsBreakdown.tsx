import {
  buildCmsInput,
  computeCms,
  CMS_SIGNAL_LABELS,
  metricDisplayLabel,
  type Card,
  type CompanyMetric,
  type MaturityTier,
  type UserFootprintCohort,
} from '@mi/contracts';
import { TierBadge } from './TierBadge';

/**
 * Shows the auditable CMS derivation (spec §6.3): per-signal band + effective
 * weight, the rules-based base band, and the LLM ±1 review nudge with its reason.
 * Recomputes the base from the stored metrics so what you see is what scored.
 */
export function CmsBreakdown({
  card,
  metrics,
  userFootprintCohort,
}: {
  card: Card;
  metrics: CompanyMetric[];
  userFootprintCohort: UserFootprintCohort;
}) {
  const base = computeCms(buildCmsInput(metrics), { userFootprintCohort });
  const finalTier = card.tier;
  const nudge = finalTier != null && base.baseTier != null ? finalTier - base.baseTier : 0;
  const nudgeWithinPolicy = nudge >= -1 && nudge <= 1;
  const sourcedCount = metrics.filter((m) => m.value != null && m.citations.length > 0).length;
  const userMetric = metrics.find((metric) => metric.metricType === 'users');
  const readiness =
    base.availableSignalCount >= 3 && sourcedCount >= 2
      ? 'Broad evidence'
      : base.availableSignalCount >= 2 && sourcedCount >= 1
        ? 'Partial evidence'
        : 'Limited evidence';

  return (
    <div className="panel-2 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="font-display text-sm font-semibold text-content">Company size band</h4>
          <p className="mt-0.5 text-[11px] text-muted">
            Composite of available size signals; not a measure of growth, product quality, or
            leadership.
          </p>
        </div>
        <span className="rounded-full border border-border bg-surface px-2 py-1 text-[10px] font-semibold text-content">
          {readiness}
        </span>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg bg-surface p-2.5 text-[11px]">
        <div>
          <span className="block text-muted">Available size signals</span>
          <strong className="text-content">{base.availableSignalCount} of 5 available</strong>
        </div>
        <div>
          <span className="block text-muted">Source receipts</span>
          <strong className="text-content">{sourcedCount} attached</strong>
        </div>
      </div>
      {base.availableSignalCount < 2 && (
        <p className="mb-3 rounded-md bg-surface p-2 text-xs leading-relaxed text-muted">
          {base.availableSignalCount === 0
            ? 'Scale band unavailable: no usable company figures were found.'
            : 'Indicative only: one available size signal is too thin for a stable composite band.'}
        </p>
      )}
      {finalTier != null && sourcedCount === 0 && (
        <p className="mb-3 rounded-md bg-surface p-2 text-xs leading-relaxed text-muted">
          A size band was recorded from estimates, but no figure has a clickable source receipt. It
          is withheld from the card face.
        </p>
      )}

      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted">
            <th className="pb-1 font-medium">Signal</th>
            <th className="pb-1 text-center font-medium">Signal band</th>
            <th className="pb-1 text-right font-medium">Weight</th>
          </tr>
        </thead>
        <tbody className="text-content">
          {base.perSignal.map((s) => (
            <tr key={s.key} className="border-t border-border/60">
              <td className="py-1.5">
                {s.key === 'users' && userMetric
                  ? metricDisplayLabel(userMetric)
                  : CMS_SIGNAL_LABELS[s.key]}
              </td>
              <td className="py-1.5 text-center">
                {s.excludedReason === 'dependent_proxy' ? (
                  <span className="text-muted" title="This proxy reuses another counted input">
                    Excluded proxy
                  </span>
                ) : s.excludedReason === 'uncomparable_user_basis' ? (
                  <span
                    className="text-muted"
                    title="Not scored: this count does not match the deck's comparable footprint type."
                  >
                    Not comparable
                  </span>
                ) : s.available ? (
                  `T${s.signalTier}`
                ) : (
                  <span className="text-muted">Unknown</span>
                )}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {s.available ? `${Math.round(s.effectiveWeight * 100)}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted">Rules-based base band</span>
          <span className="font-semibold text-content">
            {base.baseTier != null ? `T${base.baseTier}` : 'Unscored'}
          </span>
        </div>
        {base.baseTier != null && finalTier != null && (
          <div className="flex items-center justify-between">
            <span className="text-muted">
              {nudgeWithinPolicy ? 'Grounded agent review' : 'Stored band vs. current calculation'}
            </span>
            <span className="font-semibold text-content">
              {nudgeWithinPolicy
                ? nudge === 0
                  ? 'none'
                  : nudge > 0
                    ? `+${nudge}`
                    : `${nudge}`
                : 'differs'}
            </span>
          </div>
        )}
        {card.tierReason && nudgeWithinPolicy && (
          <p className="rounded-md bg-surface p-2 leading-relaxed text-muted">
            “{card.tierReason}”
          </p>
        )}
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-muted">
            {base.baseTier == null ? 'Current band' : 'Recorded band'}
          </span>
          {finalTier != null && base.baseTier != null ? (
            <TierBadge tier={finalTier as MaturityTier} reason={card.tierReason} size="md" />
          ) : (
            <span className="font-semibold text-content">Pending evidence</span>
          )}
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-snug text-muted">
        This is a descriptive composite of available size signals. Coverage and input types can
        differ between companies, and estimated values can contribute. Unknown signals are excluded
        rather than scored as zero. A grounded review may adjust the band by one step; it cannot
        create a band from scratch.
      </p>
    </div>
  );
}
