import { useRef, useState, type PointerEvent } from 'react';
import { Rotate3D } from 'lucide-react';
import type { CardWithCompany } from '@mi/contracts';
import { CollectibleCard } from './CollectibleCard';
import type { CardView } from './card-view';

export function CardStage({ data, view }: { data: CardWithCompany; view: CardView }) {
  const card = useRef<HTMLDivElement>(null);
  const [back, setBack] = useState(false);
  const reset = () => {
    for (const prop of ['--tilt-x', '--tilt-y', '--shine-x', '--shine-y']) card.current?.style.removeProperty(prop);
  };
  const tilt = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    card.current?.style.setProperty('--tilt-x', `${(0.5 - y) * 12}deg`);
    card.current?.style.setProperty('--tilt-y', `${(x - 0.5) * 14}deg`);
    card.current?.style.setProperty('--shine-x', `${x * 100}%`);
    card.current?.style.setProperty('--shine-y', `${y * 100}%`);
  };
  return <div className="card-stage">
    <div className="card-stage__light" aria-hidden="true" />
    <p className="card-stage__caption">A closer look</p>
    <div className="card-stage__perspective" onPointerMove={tilt} onPointerLeave={reset} onPointerCancel={reset}>
      <div ref={card} className={`card-stage__tilt ${back ? 'is-flipped' : ''}`}>
        <CollectibleCard data={data} view={view} back={back} />
      </div>
    </div>
    <div className="card-stage__tools"><button type="button" onClick={() => { reset(); setBack(!back); }}
      aria-label="Flip card" aria-pressed={back}><Rotate3D size={16} aria-hidden="true" />{back ? 'Show front' : 'Flip card'}</button>
      <span>Move your pointer to catch the light</span></div>
  </div>;
}
