import type { CSSProperties } from 'react';
import { ovrTooltip, type OvrBreakdown } from './rating';
import './collectible.css';

/** Classic trading-card rarity tiers for the rating plaque (FUT/Madden style). */
export function ovrRarity(n: number): 'icon' | 'gold' | 'silver' | 'bronze' {
  if (n >= 90) return 'icon';
  if (n >= 75) return 'gold';
  if (n >= 60) return 'silver';
  return 'bronze';
}

/**
 * The OVR plaque. On the card it sits absolutely in the art corner; pass
 * `inline` to drop it into normal flow (dashboard header, deck library).
 */
export function OvrPlaque({ rating, inline = false, style }: { rating: OvrBreakdown; inline?: boolean; style?: CSSProperties }) {
  return (
    <span
      className={`collectible__ovr collectible__ovr--${ovrRarity(rating.overall)}${rating.indicative ? ' collectible__ovr--indicative' : ''}`}
      title={ovrTooltip(rating)}
      data-testid="card-ovr"
      style={inline ? { position: 'static', ...style } : style}
    >
      <span className="collectible__ovr-num">{rating.overall}</span>
      <span className="collectible__ovr-label">OVR</span>
    </span>
  );
}
