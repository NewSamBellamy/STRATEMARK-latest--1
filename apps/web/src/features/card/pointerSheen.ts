import type { PointerEvent } from 'react';

/** Largest lean, in degrees, a card takes toward the pointer when its skin names no number (`data-tilt`). */
export const MAX_GRID_TILT = 5;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The light on a grid card follows a mouse pointer, and the card leans a few
 * degrees toward it. Touch and pen get the still card, and so does reduced
 * motion. Only CSS custom properties change, so layout is never touched.
 */
export function followPointer(event: PointerEvent<HTMLElement>): void {
  if (event.pointerType !== 'mouse' || reducedMotion()) return;
  const el = event.currentTarget;
  const box = el.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return;
  const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
  const max = Number(el.dataset.tilt) || MAX_GRID_TILT;
  el.style.setProperty('--shine-x', `${(x * 100).toFixed(1)}%`);
  el.style.setProperty('--shine-y', `${(y * 100).toFixed(1)}%`);
  el.style.setProperty('--tilt-x', `${((0.5 - y) * 2 * max).toFixed(2)}deg`);
  el.style.setProperty('--tilt-y', `${((x - 0.5) * 2 * max).toFixed(2)}deg`);
}

export function settlePointer(event: PointerEvent<HTMLElement>): void {
  const style = event.currentTarget.style;
  for (const name of ['--shine-x', '--shine-y', '--tilt-x', '--tilt-y']) style.removeProperty(name);
}
