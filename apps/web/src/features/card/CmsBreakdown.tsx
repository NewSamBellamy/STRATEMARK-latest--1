import {
  buildCmsInput,
  computeCms,
  CMS_SIGNAL_LABELS,
  type Card,
  type CompanyMetric,
  type MaturityTier,
} from '@mi/contracts';
import { TierBadge } from './TierBadge';
import { OvrBadge } from './OvrBadge';
import { OVR_EXPLAINER, type OvrBreakdown } from './rating';

/**
 * Shows the auditable CMS derivation (spec §6.3): per-signal tier + effective
 * weight, the rules-based base tier, and the LLM ±1 review nudge with its reason.
 * Recomputes the base from the stored metrics so what you see is what scored.
 */
export function CmsBreakdown({
  card,
  metrics,
  deckUserValues,
  rating = null,
}: {
  card: Card;
  metrics: CompanyMetric[];
  deckUserValues: number[];
  /** OVR against the deck. Null/omitted: withheld, nothing rated without evidence. */
  rating?: OvrBreakdown | null;
}) {
  const base = computeCms(buildCmsInput(metrics), { deckUserValues });
  const finalTier = card.tier;
  const nudge =
    finalTier != null && base.baseTier != null ? finalTier - base.baseTier : 0;
  const sourcedCount = metrics.filter((m) => m.value != null && m.citations.length > 0).length;

  return (
    <div className="panel-2 p-4">
      <div className="mb-3 flex items-center justify-between gap-3" data-testid="ovr-breakdown">
        <h4 className="font-display text-sm font-semibold text-content">Overall rating</h4>
        {rating ? <OvrBadge rating={rating} size="md" /> : <span className="text-xs font-semibold text-muted">Not rated</span>}
      </div>
      {rating ? (
        <ul className="mb-2 space-y-1 text-xs">
          {rating.components.map((c) => (
            <li key={c.key} className="flex items-baseline justify-between gap-3 border-t border-border/60 pt-1.5">
              <span className="text-content">{c.label}<span className="block text-[11px] text-muted">{c.detail}</span></span>
              <span className="shrink-0 font-semibold tabular-nums text-content">{c.key === 'evidence' ? `+${c.score}` : c.score}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-xs leading-relaxed text-muted">No rating: there is no maturity tier and no sourced figure that can be ranked within this deck.</p>
      )}
      {rating && <p className="mb-2 text-[11px] leading-snug text-muted">{rating.basis}</p>}
      <p className="mb-4 rounded-md bg-surface p-2 text-[11px] leading-snug text-muted">
        <strong className="text-content">How OVR is calculated.</strong> {OVR_EXPLAINER} The tier below is one of its inputs.
      </p>
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
