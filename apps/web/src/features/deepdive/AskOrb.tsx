/**
 * The Ask orb: the Stratemark mark as a small floating button you can drag
 * anywhere and press to ask a question from whatever you are looking at. It
 * stays exactly where you let it go (the middle of the screen stays the middle),
 * remembers that place, stays on screen when the window changes, and can be moved
 * or pressed from the keyboard (arrow keys move it, Enter or Space asks).
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import logoMark from '@/assets/logo-mark.svg';
import { cn } from '@/lib/cn';

export const ORB_SIZE = 52;
const EDGE = 12;
const POS_KEY = 'stratemark.askOrb.pos';
const DRAG_THRESHOLD = 5;

export interface OrbPos {
  /** How far across and down the room it has to move, each 0..1: survives a window of another size. */
  x: number;
  y: number;
}

const DEFAULT_POS: OrbPos = { x: 1, y: 0.72 };
const unit = (n: number) => Math.min(1, Math.max(0, n));

export function readOrbPos(): OrbPos {
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<OrbPos> & { side?: unknown };
      if (typeof p.y === 'number' && Number.isFinite(p.y)) {
        if (typeof p.x === 'number' && Number.isFinite(p.x)) return { x: unit(p.x), y: unit(p.y) };
        // An orb saved by the version that snapped to an edge: it keeps its side.
        if (p.side === 'left' || p.side === 'right') return { x: p.side === 'left' ? 0 : 1, y: unit(p.y) };
      }
    }
  } catch { /* no storage: the default place */ }
  return DEFAULT_POS;
}

function saveOrbPos(pos: OrbPos): void {
  try { window.localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* remembered next time only when storage works */ }
}

/** Pixel position of the orb's top-left for a resting place in a window of this size. */
export function orbPixels(pos: OrbPos, width: number, height: number): { left: number; top: number } {
  const top = EDGE + pos.y * Math.max(0, height - ORB_SIZE - EDGE * 2);
  const left = EDGE + pos.x * Math.max(0, width - ORB_SIZE - EDGE * 2);
  return { left, top };
}

/** The resting place for where the orb was let go: exactly there, kept inside the window. */
export function placeOrb(left: number, top: number, width: number, height: number): OrbPos {
  const across = Math.max(1, width - ORB_SIZE - EDGE * 2);
  const down = Math.max(1, height - ORB_SIZE - EDGE * 2);
  return { x: unit((left - EDGE) / across), y: unit((top - EDGE) / down) };
}

export function AskOrb({ onAsk, hint }: { onAsk: () => void; hint?: string }) {
  const [pos, setPos] = useState<OrbPos>(readOrbPos);
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
  const start = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const rest = orbPixels(pos, size.w, size.h);
  const at = drag ?? rest;

  const clamp = useCallback((left: number, top: number) => ({
    left: Math.min(Math.max(EDGE, left), size.w - ORB_SIZE - EDGE),
    top: Math.min(Math.max(EDGE, top), size.h - ORB_SIZE - EDGE),
  }), [size.w, size.h]);

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    start.current = { x: e.clientX, y: e.clientY, left: rest.left, top: rest.top, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    s.moved = true;
    setDrag(clamp(s.left + dx, s.top + dy));
  };
  const up = () => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    if (s.moved && drag) {
      const next = placeOrb(drag.left, drag.top, size.w, size.h);
      setPos(next);
      saveOrbPos(next);
      setDrag(null);
    } else {
      setDrag(null);
      onAsk();
    }
  };
  const key = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = 0.06;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = { ...pos, y: unit(pos.y + (e.key === 'ArrowDown' ? step : -step)) };
      setPos(next);
      saveOrbPos(next);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next: OrbPos = { ...pos, x: unit(pos.x + (e.key === 'ArrowRight' ? step : -step)) };
      setPos(next);
      saveOrbPos(next);
    }
  };

  return (
    <button
      type="button"
      aria-label="Ask Stratemark"
      title={hint ?? 'Ask Stratemark. Drag to move.'}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => { start.current = null; setDrag(null); }}
      onKeyDown={key}
      onClick={(e) => { if (e.detail === 0) onAsk(); /* Enter or Space: pointer presses are handled above */ }}
      className={cn(
        'fixed z-30 grid touch-none select-none place-items-center rounded-full border border-border bg-surface shadow-card',
        'cursor-grab active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        drag ? 'scale-105' : 'transition-[left,top,transform] duration-200 ease-out hover:scale-105',
      )}
      style={{ left: at.left, top: at.top, width: ORB_SIZE, height: ORB_SIZE }}
    >
      <img src={logoMark} alt="" draggable={false} className="h-7 w-7 select-none" />
    </button>
  );
}
