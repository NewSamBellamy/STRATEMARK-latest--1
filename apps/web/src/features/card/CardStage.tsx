import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { RotateCcw } from 'lucide-react';
import type { CardWithCompany } from '@mi/contracts';
import { CardBack } from './CardBack';
import { CollectibleCard } from './CollectibleCard';
import type { CardView } from './card-view';

/** Degrees of spin per pixel dragged. */
const SPIN_PER_PX = 0.9;
/** A short, quick drag still turns the card over, like a flick. */
const FLICK_PX = 36;

/** The half turn a drag settles on: the nearest face, or the next one over for a flick. */
export function settleSpin(start: number, dragged: number): number {
  const angle = start + dragged * SPIN_PER_PX;
  let settled = Math.round(angle / 180) * 180;
  if (settled === start && Math.abs(dragged) >= FLICK_PX) settled = start + Math.sign(dragged) * 180;
  return settled;
}

export function showsBack(angle: number): boolean {
  return Math.abs(Math.round(angle / 180)) % 2 === 1;
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

export function CardStage({ data, view }: { data: CardWithCompany; view: CardView }) {
  const card = useRef<HTMLDivElement>(null);
  const spinner = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; start: number; moved: number } | null>(null);
  const [angle, setAngle] = useState(0);
  const [dragging, setDragging] = useState(false);
  const back = showsBack(angle);

  // Each card opens face up.
  useEffect(() => setAngle(0), [data.card.id]);

  const reset = () => {
    for (const prop of ['--tilt-x', '--tilt-y', '--shine-x', '--shine-y'])
      card.current?.style.removeProperty(prop);
  };
  const tilt = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) {
      const moved = event.clientX - drag.current.x;
      drag.current.moved = moved;
      spinner.current?.style.setProperty('--spin', `${drag.current.start + moved * SPIN_PER_PX}deg`);
      return;
    }
    if (event.pointerType === 'touch' || reducedMotion()) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    card.current?.style.setProperty('--tilt-x', `${(0.5 - y) * 6}deg`);
    card.current?.style.setProperty('--tilt-y', `${(x - 0.5) * 7}deg`);
    card.current?.style.setProperty('--shine-x', `${x * 100}%`);
    card.current?.style.setProperty('--shine-y', `${y * 100}%`);
  };
  // Drag sideways to spin the card; it settles on whichever face is nearer.
  // Under reduced motion there is no free spin: the Flip button turns it at once.
  const grab = (event: PointerEvent<HTMLDivElement>) => {
    if (event.isPrimary === false || event.button !== 0 || reducedMotion()) return;
    drag.current = { id: event.pointerId, x: event.clientX, start: angle, moved: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    reset();
    setDragging(true);
  };
  const release = (event: PointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    if (!held || held.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    spinner.current?.style.removeProperty('--spin');
    setAngle(settleSpin(held.start, held.moved));
  };

  return (
    <div className="card-stage">
      <div
        className={`card-stage__perspective ${dragging ? 'card-stage__perspective--dragging' : ''}`}
        onPointerDown={grab}
        onPointerMove={tilt}
        onPointerUp={release}
        onPointerCancel={(event) => { release(event); reset(); }}
        onPointerLeave={() => { if (!drag.current) reset(); }}
      >
        <div ref={card} className="card-stage__tilt">
          <div
            ref={spinner}
            className="card-stage__spin"
            style={{ '--turn': `${angle}deg` } as CSSProperties}
            data-face={back ? 'back' : 'front'}
          >
            <div className="card-stage__face" aria-hidden={back || undefined}>
              <CollectibleCard data={data} view={view} />
            </div>
            <div className="card-stage__face card-stage__face--back" aria-hidden={!back || undefined}>
              <CardBack />
            </div>
          </div>
        </div>
      </div>
      <button
        type="button"
        className="card-stage__flip"
        aria-pressed={back}
        onClick={() => setAngle((a) => a + 180)}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        {back ? 'Show front' : 'Flip card'}
      </button>
    </div>
  );
}
