import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { FIRST_WAIT, LivingMark, ORB_CADENCE, REST_WAIT } from './LivingMark';
import { SWIMS } from './fishSwim';
import { MARK_PATH_A, MARK_PATH_B } from './markPaths';

const move = (container: HTMLElement) => container.querySelector('svg')!.getAttribute('data-move');
const paths = (container: HTMLElement) => [...container.querySelectorAll('path')].map((p) => p.getAttribute('d'));
const eyes = (container: HTMLElement) => [...container.querySelectorAll('circle')].map((c) => Number(c.getAttribute('r')));

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
  let now = 0;
  let queued: FrameRequestCallback[] = [];
  const cancelled = vi.fn();

  /** Moves the clock on and draws one frame, the way the browser would. */
  const frame = (ms: number) => act(() => {
    now += ms;
    const run = queued;
    queued = [];
    for (const callback of run) callback(now);
  });

  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    queued = [];
    cancelled.mockReset();
    setReducedMotion(false);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    // The shortest pause, and the first swim is the first of the three: the timings below are exact.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queued.push(callback); return queued.length; });
    vi.stubGlobal('cancelAnimationFrame', cancelled);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('is the logo: its two shapes exactly as drawn, with no eyes, named only when it is the only thing saying "Stratemark"', () => {
    const { container, rerender } = render(<LivingMark />);
    expect(paths(container)).toEqual([MARK_PATH_A, MARK_PATH_B]);
    expect(eyes(container)).toEqual([0, 0]);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    rerender(<LivingMark label="Stratemark" />);
    expect(container.querySelector('svg')!.getAttribute('role')).toBe('img');
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe('Stratemark');
  });

  it('keeps still at first, then swims after a pause, and is the logo again, exactly, when the swim ends', () => {
    const { container } = render(<LivingMark />);
    expect(move(container)).toBe('none');
    act(() => { vi.advanceTimersByTime(FIRST_WAIT[0] - 1); });
    expect(move(container)).toBe('none');
    expect(queued).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(1); });
    expect(move(container)).toBe('orbit');
    expect(queued).toHaveLength(1);

    // Halfway through, the shapes are fish: not the logo's outlines, with eyes open.
    frame(SWIMS.orbit.seconds * 500);
    expect(paths(container)).not.toEqual([MARK_PATH_A, MARK_PATH_B]);
    expect(paths(container).every((d) => d !== null && !d.includes('NaN'))).toBe(true);
    expect(eyes(container).every((r) => r > 0)).toBe(true);
    expect(container.querySelector('linearGradient')!.getAttribute('gradientTransform')).toMatch(/^rotate\(/);

    // The swim ends: the logo as drawn, the eyes shut, the gradients back to what they were.
    frame(SWIMS.orbit.seconds * 500 + 1);
    expect(move(container)).toBe('none');
    expect(paths(container)).toEqual([MARK_PATH_A, MARK_PATH_B]);
    expect(eyes(container)).toEqual([0, 0]);
    expect(container.querySelector('linearGradient')!.hasAttribute('gradientTransform')).toBe(false);
  });

  it('rests a long while between swims, and plays the three swims in turn', () => {
    const { container } = render(<LivingMark />);
    const seen: string[] = [];
    act(() => { vi.advanceTimersByTime(FIRST_WAIT[0]); });
    for (let i = 0; i < 3; i += 1) {
      seen.push(move(container)!);
      frame(SWIMS.orbit.seconds * 1000 + SWIMS.chase.seconds * 1000); // longer than any swim
      expect(move(container)).toBe('none');
      act(() => { vi.advanceTimersByTime(REST_WAIT[0] - 1); });
      expect(move(container)).toBe('none');
      act(() => { vi.advanceTimersByTime(1); });
    }
    expect(seen).toEqual(['orbit', 'chase', 'drift']);
  });

  it('with a cadence, starts a swim every 30 seconds, start to start', () => {
    expect(ORB_CADENCE).toBe(30_000);
    const { container } = render(<LivingMark cadence={ORB_CADENCE} />);
    act(() => { vi.advanceTimersByTime(FIRST_WAIT[0]); });
    expect(move(container)).toBe('orbit');
    frame(SWIMS.orbit.seconds * 1000 + 1);
    expect(move(container)).toBe('none');
    const restMs = ORB_CADENCE - SWIMS.orbit.seconds * 1000;
    act(() => { vi.advanceTimersByTime(restMs - 2); });
    expect(move(container)).toBe('none');
    act(() => { vi.advanceTimersByTime(2); });
    expect(move(container)).toBe('chase');
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
    expect(queued).toHaveLength(0);
  });

  it('stops everything when it goes away mid-swim, leaving no timer behind', () => {
    const { container, unmount } = render(<LivingMark />);
    act(() => { vi.advanceTimersByTime(FIRST_WAIT[0]); });
    frame(1000);
    expect(move(container)).toBe('orbit');
    unmount();
    expect(cancelled).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
