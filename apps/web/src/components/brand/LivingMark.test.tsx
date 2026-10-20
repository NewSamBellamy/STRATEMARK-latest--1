import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { FIRST_WAIT, LivingMark, REST_WAIT } from './LivingMark';

const move = (container: HTMLElement) => container.querySelector('svg')!.getAttribute('data-move');

function setReducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: on && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  }));
}

describe('the living mark', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setReducedMotion(false);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    // The shortest pause, and the first move is the first of the three: the timings below are exact.
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('is the two shapes of the mark, named only when it is the only thing saying "Stratemark"', () => {
    const { container, rerender } = render(<LivingMark />);
    expect(container.querySelectorAll('path')).toHaveLength(2);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    rerender(<LivingMark label="Stratemark" />);
    expect(container.querySelector('svg')!.getAttribute('role')).toBe('img');
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe('Stratemark');
  });

  it('keeps still at first, then makes one move after a pause, settles when it ends, and rests a long while before the next', () => {
    const { container } = render(<LivingMark />);
    expect(move(container)).toBe('none');
    act(() => { vi.advanceTimersByTime(FIRST_WAIT[0] - 1); });
    expect(move(container)).toBe('none');
    act(() => { vi.advanceTimersByTime(1); });
    expect(move(container)).toBe('turn');
    act(() => { fireEvent.animationEnd(container.querySelector('.living-mark__fish--b')!); });
    expect(move(container)).toBe('none');
    // It does not go again soon.
    act(() => { vi.advanceTimersByTime(REST_WAIT[0] - 1); });
    expect(move(container)).toBe('none');
    act(() => { vi.advanceTimersByTime(1); });
    expect(move(container)).toBe('swim');
  });

  it('plays the three moves in turn, not the same one again and again', () => {
    const { container } = render(<LivingMark />);
    const seen: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      act(() => { vi.advanceTimersByTime(i === 0 ? FIRST_WAIT[0] : REST_WAIT[0]); });
      seen.push(move(container)!);
      act(() => { fireEvent.animationEnd(container.querySelector('.living-mark__fish--b')!); });
    }
    expect(new Set(seen).size).toBe(3);
  });

  it('clears a move that never reports its end, so it cannot be stuck', () => {
    const { container } = render(<LivingMark />);
    act(() => { vi.advanceTimersByTime(FIRST_WAIT[0]); });
    expect(move(container)).toBe('turn');
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(move(container)).toBe('none');
  });

  it('does nothing in a hidden tab, when asked to keep still, or for someone who wants less motion', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const hidden = render(<LivingMark />);
    act(() => { vi.advanceTimersByTime(FIRST_WAIT[1] + 1); });
    expect(move(hidden.container)).toBe('none');
    hidden.unmount();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const still = render(<LivingMark still />);
    act(() => { vi.advanceTimersByTime(REST_WAIT[1] * 3); });
    expect(move(still.container)).toBe('none');
    still.unmount();
    setReducedMotion(true);
    const reduced = render(<LivingMark />);
    act(() => { vi.advanceTimersByTime(REST_WAIT[1] * 3); });
    expect(move(reduced.container)).toBe('none');
  });

  it('stops its timers when it goes away', () => {
    const { unmount } = render(<LivingMark />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the moves, as written', () => {
  const css = readFileSync(resolve(__dirname, 'livingMark.css'), 'utf8');
  const block = (name: string) => {
    const at = css.indexOf(`@keyframes ${name}`);
    const open = css.indexOf('{', at);
    let depth = 0;
    let end = open;
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}' && --depth === 0) break;
    }
    return css.slice(open, end + 1);
  };
  const last = (name: string) => /100%\s*\{([^}]*)\}/.exec(block(name))![1]!;

  it('each ends in the resting picture: a half turn, a whole turn or no turn, at full size', () => {
    // The two shapes are each the other turned half a circle, so a multiple of 180 degrees looks exactly like the start.
    const turn = last('living-mark-turn');
    const swim = last('living-mark-swim');
    expect(turn).toMatch(/rotate\(180deg\)\s*scale\(1\)/);
    expect(swim).toMatch(/rotate\(360deg\)\s*scale\(1\)/);
    expect(last('living-mark-wag-a')).toMatch(/rotate\(0deg\)/);
    expect(last('living-mark-wag-b')).toMatch(/rotate\(0deg\)/);
  });

  it('move nothing but transform, about the middle of the two shapes, and stop for reduced motion', () => {
    const frames = ['living-mark-turn', 'living-mark-swim', 'living-mark-wag-a', 'living-mark-wag-b'].map(block).join(' ');
    expect(new Set([...frames.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]))).toEqual(new Set(['transform']));
    expect(css).toContain('transform-origin: 37.3px 43.5px');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/);
  });
});
