import { cn } from '@/lib/cn';
import { TIER_COLORS, tint } from '@/lib/theme';
import { Tooltip } from '@/components/ui/Tooltip';
import { ovrColorTier, ovrTooltip, type OvrBreakdown } from './rating';

/**
 * OVR badge — same pill as TierBadge, headline number instead of the tier.
 * The hue comes from the existing tier palette via the rating band.
 */
export function OvrBadge({ rating, size = 'sm' }: { rating: OvrBreakdown; size?: 'sm' | 'md' }) {
  const color = TIER_COLORS[ovrColorTier(rating.overall)];
  return (
    <Tooltip content={ovrTooltip(rating)}>
      <span
        data-testid="ovr-badge"
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold text-content',
          size === 'md' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs',
        )}
        style={{ background: tint(color, 0.1), borderColor: tint(color, 0.3) }}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="tabular-nums">{rating.overall}</span>
        <span className="opacity-70">OVR</span>
      </span>
    </Tooltip>
  );
}
