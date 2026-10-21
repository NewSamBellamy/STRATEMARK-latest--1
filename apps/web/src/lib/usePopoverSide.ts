import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Which edge a dropdown hangs from. Header menus hang from their button's right
 * edge, but a wrapped header can put that button at the far left, where a
 * right-hung panel runs under the sidebar and is cut off. Measured when the
 * panel opens: right unless there is not room for `width` px to the left.
 */
export function usePopoverSide(anchor: RefObject<HTMLElement | null>, open: boolean, width: number): 'left' | 'right' {
  const [side, setSide] = useState<'left' | 'right'>('right');
  useLayoutEffect(() => {
    const el = anchor.current;
    if (!open || !el) return;
    const right = el.getBoundingClientRect().right;
    // The scrolling page area clips its children; outside the app shell, the window does.
    const left = el.closest('main')?.getBoundingClientRect().left ?? 0;
    setSide(right - width < left + 8 ? 'left' : 'right');
  }, [anchor, open, width]);
  return side;
}
