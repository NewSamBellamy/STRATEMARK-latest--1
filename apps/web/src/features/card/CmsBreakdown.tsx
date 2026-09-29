import {
  buildCmsInput,
  computeCms,
  CMS_SIGNAL_LABELS,
  type Card,
  type CompanyMetric,
  type MaturityTier,
} from '@mi/contracts';
import { TierBadge } from './TierBadge';

/**
 * Shows the auditable CMS derivation (spec §6.3): per-signal tier + effective
 * weight, the rules-based base tier, and the LLM ±1 review nudge with its reason.
 * Recomputes the base from the stored metrics so what you see is what scored.
 */
export function CmsBreakdown({
  card,
  metrics,
  deckUserValues,
}: {
  card: Card;
  metrics: CompanyMetric[];
  deckUserValues: number[];
}) {
  const base = computeCms(buildCmsInput(metrics), { deckUserValues });
  const finalTier = card.tier;
  const nudge =
    finalTier != null && base.baseTier != null ? finalTier - base.baseTier : 0;
  const sourcedCount = metrics.filter((m) => m.value != null && m.citations.length > 0).length;

  return (
    <div className="panel-2 p-4">
      <h4 className="mb-3 font-display text-sm font-semibold text-content">
        Company Maturity Score
      </h4>
      {base.availableSignalCount < 2 && <p className="mb-3 rounded-md bg-surface p-2 text-xs leading-relaxed text-muted">
        {base.availableSignalCount === 0
          ? 'Not ranked: no usable company figures were found. A tier would imply evidence we do not have.'
          : 'Indicative only: one available signal is too thin for a confident market position.'}
      </p>}
      {finalTier != null && sourcedCount === 0 && <p className="mb-3 rounded-md bg-surface p-2 text-xs leading-relaxed text-muted">
        A tier was recorded from estimates, but no figure has a clickable source receipt. It is withheld from the card face.
      </p>}

      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted">
            <th className="pb-1 font-medium">Signal</th>
            <th className="pb-1 text-center font-medium">Tier</th>
            <th className="pb-1 text-right font-medium">Weight</th>
          </tr>
        </thead>
        <tbody className="text-content">
          {base.perSignal.map((s) => (
            <tr key={s.key} className="border-t border-border/60">
              <td className="py-1.5">{CMS_SIGNAL_LABELS[s.key]}</td>
              <td className="py-1.5 text-center">
                {s.available ? `T${s.signalTier}` : <span className="text-muted">Unknown</span>}
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
          <span className="text-muted">Rules-based base tier</span>
          <span className="font-semibold text-content">
            {base.baseTier != null ? `T${base.baseTier}` : 'Unscored'}
          </span>
        </div>
        {base.baseTier != null && <div className="flex items-center justify-between">
          <span className="text-muted">LLM review nudge</span>
          <span className="font-semibold text-content">
            {nudge === 0 ? 'none' : nudge > 0 ? `+${nudge}` : `${nudge}`}
          </span>
        </div>}
        {card.tierReason && (
          <p className="rounded-md bg-surface p-2 leading-relaxed text-muted">
            “{card.tierReason}”
          </p>
        )}
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-muted">{base.baseTier == null ? 'Current position' : 'Recorded tier'}</span>
          {finalTier != null && base.baseTier != null ? (
            <TierBadge tier={finalTier as MaturityTier} reason={card.tierReason} size="md" />
          ) : (
            <span className="font-semibold text-content">Pending evidence</span>
          )}
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-snug text-muted">
        Weights renormalize across available signals; an Unknown signal is never scored as zero
        (spec §6.4). The LLM may only nudge ±1 — it never assigns a tier from scratch.
      </p>
    </div>
  );
}
