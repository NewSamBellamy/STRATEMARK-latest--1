import { useId, useMemo } from 'react';
import logoMark from '@/assets/logo-mark.svg';
import { COVER_PALETTES, coverSpec, roseSet } from '@/features/markets/coverArt';

/**
 * The back every Stratemark card shares, as on a real trading card: a deep
 * green field, an engraved rosette in the deck covers' guilloche style, the
 * mark, and the wordmark. Drawn as one SVG so it stays sharp at any size.
 */
const GREEN = COVER_PALETTES.find((p) => p.name === 'green') ?? COVER_PALETTES[0];

export function CardBack({ className }: { className?: string }) {
  const rose = useMemo(() => {
    const spec = { ...coverSpec('stratemark'), palette: GREEN };
    return { spec, outer: roseSet(spec, 125, 160, 92), inner: roseSet({ ...spec, rotation: spec.rotation + 15 }, 125, 160, 58) };
  }, []);
  const uid = useId().replace(/:/g, '');
  const field = `sm-back-field-${uid}`;
  const metal = `sm-back-metal-${uid}`;
  const [hi, mid, lo] = GREEN.metal;
  const [f1, f2, f3] = GREEN.field;
  return (
    <div className={`collectible collectible--back ${className ?? ''}`} data-testid="collectible-card-back">
      <svg className="collectible__back-art" viewBox="0 0 250 350" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <radialGradient id={field} cx="50%" cy="42%" r="75%">
            <stop offset="0" stopColor={f1} />
            <stop offset="0.6" stopColor={f2} />
            <stop offset="1" stopColor={f3} />
          </radialGradient>
          <linearGradient id={metal} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={hi} />
            <stop offset="0.5" stopColor={mid} />
            <stop offset="1" stopColor={lo} />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="250" height="350" rx="14" fill={`url(#${field})`} />
        <rect x="9" y="9" width="232" height="332" rx="9" fill="none" stroke={`url(#${metal})`} strokeWidth="1.4" />
        <rect x="14" y="14" width="222" height="322" rx="6" fill="none" stroke={`url(#${metal})`} strokeOpacity="0.45" strokeWidth="0.6" />
        <g fill="none" stroke={`url(#${metal})`} strokeLinejoin="round">
          {rose.spec.rings.map((r) => (
            <circle key={r} cx="125" cy="160" r={92 * r + 8} strokeOpacity="0.28" strokeWidth="0.5" />
          ))}
          {rose.outer.map((d, i) => <path key={`o${i}`} d={d} strokeOpacity="0.55" strokeWidth="0.45" />)}
          {rose.inner.map((d, i) => <path key={`i${i}`} d={d} strokeOpacity="0.35" strokeWidth="0.35" />)}
          <circle cx="125" cy="160" r="34" fill={f3} fillOpacity="0.92" strokeWidth="1.1" />
        </g>
        <image href={logoMark} x="103" y="138" width="44" height="44" preserveAspectRatio="xMidYMid meet" />
        <text x="125" y="292" textAnchor="middle" fill={`url(#${metal})`} fontSize="15" fontWeight="700" letterSpacing="5" fontFamily="inherit">
          STRATEMARK
        </text>
        <line x1="92" y1="304" x2="158" y2="304" stroke={`url(#${metal})`} strokeOpacity="0.6" strokeWidth="0.6" />
      </svg>
      <div className="collectible__foil" aria-hidden="true" />
    </div>
  );
}
