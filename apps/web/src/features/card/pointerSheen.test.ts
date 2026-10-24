import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PointerEvent } from 'react';
import { MAX_GRID_TILT, followPointer, settlePointer } from './pointerSheen';

function sleeve() {
  const el = document.createElement('button');
  el.getBoundingClientRect = () => ({ left: 100, top: 200, width: 200, height: 280, right: 300, bottom: 480, x: 100, y: 200, toJSON: () => ({}) });
  return el;
}
const move = (el: HTMLElement, pointerType: string, clientX: number, clientY: number) =>
  ({ currentTarget: el, pointerType, clientX, clientY }) as unknown as PointerEvent<HTMLElement>;
function motion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce'), media: query }));
}

afterEach(() => vi.unstubAllGlobals());

describe('the light on a grid card', () => {
  it('follows a mouse and leans the card toward it, at most a few degrees', () => {
    motion(false);
    const el = sleeve();
    followPointer(move(el, 'mouse', 300, 200)); // top-right corner
    expect(el.style.getPropertyValue('--shine-x')).toBe('100.0%');
    expect(el.style.getPropertyValue('--shine-y')).toBe('0.0%');
    expect(el.style.getPropertyValue('--tilt-x')).toBe(`${MAX_GRID_TILT.toFixed(2)}deg`);
    expect(el.style.getPropertyValue('--tilt-y')).toBe(`${MAX_GRID_TILT.toFixed(2)}deg`);
    settlePointer(move(el, 'mouse', 0, 0));
    expect(el.style.getPropertyValue('--shine-x')).toBe('');
    expect(el.style.getPropertyValue('--tilt-y')).toBe('');
  });

  it('leans as far as its skin allows', () => {
    motion(false);
    const el = sleeve();
    el.dataset.tilt = '9';
    followPointer(move(el, 'mouse', 300, 200));
    expect(el.style.getPropertyValue('--tilt-x')).toBe('9.00deg');
    expect(el.style.getPropertyValue('--tilt-y')).toBe('9.00deg');
  });

  it('stays still for touch and under reduced motion', () => {
    motion(false);
    const touched = sleeve();
    followPointer(move(touched, 'touch', 200, 300));
    expect(touched.style.getPropertyValue('--shine-x')).toBe('');
    motion(true);
    const reduced = sleeve();
    followPointer(move(reduced, 'mouse', 200, 300));
    expect(reduced.style.getPropertyValue('--tilt-x')).toBe('');
  });
});
