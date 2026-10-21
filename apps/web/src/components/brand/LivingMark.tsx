/**
 * The Stratemark mark, quietly alive. Its two shapes are two fish, yin and yang. Now and then, after a long pause, they become fish
 * and swim round each other the way a pair of koi do (a spine that bends round the circle with a wave running from head to tail, a
 * forked fin that follows, an eye), then settle back into the logo exactly as it was. See `fishSwim.ts` for the motion.
 *
 * It moves only while a swim is playing: 4 to 6 seconds, then 28 to 52 seconds of rest. The shapes are redrawn each frame by setting
 * path data directly (no React re-render per frame). It does nothing for anyone who has asked for less motion, in a hidden tab, or
 * when asked to keep still.
 */
import { useEffect, useId, useRef } from 'react';
import { SWIMS, swimFrame, type SwimVariant } from './fishSwim';
import { MARK_PATH_A, MARK_PATH_B } from './markPaths';
import './livingMark.css';

export type LivingMove = keyof typeof SWIMS;
const MOVES: readonly LivingMove[] = ['orbit', 'chase', 'drift'];

/** How long the mark waits before its first swim, and between swims (milliseconds, a random time in the range). */
export const FIRST_WAIT: readonly [number, number] = [6_000, 11_000];
export const REST_WAIT: readonly [number, number] = [28_000, 52_000];

const between = ([low, high]: readonly [number, number]) => low + Math.random() * (high - low);

function prefersLessMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const CENTRE = '37.3 43.5';

export function LivingMark({ className, label, still = false }: { className?: string; label?: string; still?: boolean }) {
  const id = useId().replace(/:/g, '');
  const svg = useRef<SVGSVGElement>(null);
  const pathA = useRef<SVGPathElement>(null);
  const pathB = useRef<SVGPathElement>(null);
  const eyeA = useRef<SVGCircleElement>(null);
  const eyeB = useRef<SVGCircleElement>(null);
  const gradA = useRef<SVGLinearGradientElement>(null);
  const gradB = useRef<SVGLinearGradientElement>(null);
  const next = useRef(Math.floor(Math.random() * MOVES.length));

  useEffect(() => {
    if (still || prefersLessMotion()) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raf = 0;
    let stopped = false;

    const rest = (wait: readonly [number, number]) => {
      timer = setTimeout(() => {
        if (stopped) return;
        // A hidden tab does not need to swim; ask again later.
        if (document.visibilityState !== 'visible') { rest(REST_WAIT); return; }
        const name = MOVES[next.current % MOVES.length]!;
        next.current += 1;
        swim(name, SWIMS[name]);
      }, between(wait));
    };

    const settle = () => {
      pathA.current?.setAttribute('d', MARK_PATH_A);
      pathB.current?.setAttribute('d', MARK_PATH_B);
      eyeA.current?.setAttribute('r', '0');
      eyeB.current?.setAttribute('r', '0');
      gradA.current?.removeAttribute('gradientTransform');
      gradB.current?.removeAttribute('gradientTransform');
      svg.current?.setAttribute('data-move', 'none');
    };

    const swim = (name: LivingMove, variant: SwimVariant) => {
      svg.current?.setAttribute('data-move', name);
      const started = performance.now();
      const step = () => {
        if (stopped) return;
        const t = (performance.now() - started) / 1000;
        if (t >= variant.seconds) {
          settle();
          rest(REST_WAIT);
          return;
        }
        const frame = swimFrame(variant, t);
        pathA.current?.setAttribute('d', frame.a);
        pathB.current?.setAttribute('d', frame.b);
        for (const [eye, at] of [[eyeA.current, frame.eyes[0]], [eyeB.current, frame.eyes[1]]] as const) {
          eye?.setAttribute('cx', String(at.x));
          eye?.setAttribute('cy', String(at.y));
          eye?.setAttribute('r', String(at.r));
        }
        // The light stays on each fish as it turns, so its colour travels with it.
        const turned = `rotate(${((-frame.turn * 180) / Math.PI).toFixed(2)} ${CENTRE})`;
        gradA.current?.setAttribute('gradientTransform', turned);
        gradB.current?.setAttribute('gradientTransform', turned);
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };

    rest(FIRST_WAIT);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
      settle();
    };
  }, [still]);

  const gradientA = `lm-a-${id}`;
  const gradientB = `lm-b-${id}`;

  return (
    <svg
      ref={svg}
      className={`living-mark ${className ?? ''}`}
      viewBox="20 25 35 38"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      data-move="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path ref={pathA} d={MARK_PATH_A} fill={`url(#${gradientA})`} stroke="#18BFB2" strokeWidth="0.5" />
      <path ref={pathB} d={MARK_PATH_B} fill={`url(#${gradientB})`} stroke="#18BFB2" strokeWidth="0.5" />
      <circle ref={eyeA} r="0" fill="#e6fffb" />
      <circle ref={eyeB} r="0" fill="#e6fffb" />
      <defs>
        <linearGradient ref={gradA} id={gradientA} x1="36.9447" y1="32.4629" x2="36.4227" y2="47.7264" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0F766E" />
          <stop offset="1" stopColor="#1CDCCD" />
        </linearGradient>
        <linearGradient ref={gradB} id={gradientB} x1="37.6491" y1="54.5371" x2="38.171" y2="39.2736" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0F766E" />
          <stop offset="1" stopColor="#1CDCCD" />
        </linearGradient>
      </defs>
    </svg>
  );
}
