/**
 * A deck's cover: card-shaped, engraved like the card backs. The rosette and
 * the colour come from the deck's name (see deckCover.ts), so every deck on
 * the shelf is recognisably its own. The name and counts are real text on top.
 */
import { useId, useMemo } from 'react';
import { coverSpec, monogram, roseSet } from './coverArt';

const W = 300;
const H = 420;

export function DeckCover({ name, seed, className }: { name: string; seed: string; className?: string }) {
  const uid = useId().replace(/:/g, '');
  const spec = useMemo(() => coverSpec(seed), [seed]);
  const paths = useMemo(() => roseSet(spec, W / 2, 168, 104), [spec]);
  const { metal, field } = spec.palette;
  const letters = useMemo(() => monogram(name), [name]);
  const id = (part: string) => `${part}-${uid}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="presentation" aria-hidden preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={id('frame')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={metal[0]} />
          <stop offset=".45" stopColor={metal[1]} />
          <stop offset="1" stopColor={metal[2]} />
        </linearGradient>
        <radialGradient id={id('field')} cx=".5" cy=".38" r=".85">
          <stop offset="0" stopColor={field[0]} />
          <stop offset=".55" stopColor={field[1]} />
          <stop offset="1" stopColor={field[2]} />
        </radialGradient>
        <linearGradient id={id('line')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={metal[0]} stopOpacity=".95" />
          <stop offset=".6" stopColor={metal[1]} stopOpacity=".8" />
          <stop offset="1" stopColor={metal[2]} stopOpacity=".7" />
        </linearGradient>
        <pattern id={id('hatch')} width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M-1 6L6-1M5 7L7 5" stroke={metal[0]} strokeWidth=".6" opacity=".09" />
        </pattern>
        <linearGradient id={id('floor')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".62" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} rx="22" fill={`url(#${id('frame')})`} />
      <rect x="8" y="8" width={W - 16} height={H - 16} rx="16" fill={`url(#${id('field')})`} />
      <rect x="8" y="8" width={W - 16} height={H - 16} rx="16" fill={`url(#${id('hatch')})`} />

      {/* Crop marks, as on the card backs. */}
      <g stroke={metal[1]} strokeWidth="1.1" fill="none" opacity=".7">
        <path d="M30 52V30H52" />
        <path d={`M${W - 52} 30H${W - 30}V52`} />
        <path d={`M30 ${H - 52}V${H - 30}H52`} />
        <path d={`M${W - 30} ${H - 52}V${H - 30}H${W - 52}`} />
      </g>

      <text x={W / 2} y="46" textAnchor="middle" fontSize="8.5" letterSpacing="3.2" fill={metal[0]} opacity=".85" fontFamily="inherit">
        STRATEMARK / DECK
      </text>

      {/* The rosette: one curve, turned a little each time. */}
      <g fill="none" stroke={`url(#${id('line')})`} strokeWidth=".55" opacity=".62">
        {paths.map((d, i) => <path key={i} d={d} />)}
      </g>
      <g fill="none" stroke={metal[1]} strokeWidth=".6" opacity=".4">
        {spec.rings.map((r) => <circle key={r} cx={W / 2} cy="168" r={104 * r} />)}
      </g>

      {/* The medallion: the deck's initials. */}
      <circle cx={W / 2} cy="168" r="40" fill={field[2]} stroke={`url(#${id('line')})`} strokeWidth="1.4" />
      <circle cx={W / 2} cy="168" r="34" fill="none" stroke={metal[1]} strokeWidth=".6" opacity=".6" />
      <text x={W / 2} y="180" textAnchor="middle" fontSize={letters.length > 1 ? 30 : 36} fontWeight="700" fill={metal[0]} fontFamily="inherit" letterSpacing={letters.length > 1 ? '1' : '0'}>
        {letters}
      </text>

      <rect x="8" y={H * 0.56} width={W - 16} height={H * 0.44 - 8} rx="16" fill={`url(#${id('floor')})`} />
      <text x={W / 2} y={H - 20} textAnchor="middle" fontSize="8" letterSpacing="2.4" fill={metal[1]} opacity=".8" fontFamily="inherit">
        {`NO. ${String(spec.ordinal).padStart(2, '0')}`}
      </text>
    </svg>
  );
}
