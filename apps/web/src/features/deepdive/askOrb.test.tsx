import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AskOrb, ORB_SIZE, orbPixels, placeOrb, readOrbPos } from './AskOrb';
import { resolveOrbScope } from './orbScope';
import { DeepDiveProviderWithPanel, useDeepDive } from './DeepDive';
import { makeRepo, renderWithProviders } from '@/test/test-utils';

const KEY = 'stratemark.askOrb.pos';

// jsdom has no PointerEvent, so pointer coordinates would be dropped: a mouse event carries them.
if (typeof window.PointerEvent === 'undefined') {
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class PointerEventShim extends MouseEvent {} as unknown as typeof MouseEvent;
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
});
afterEach(() => { window.localStorage.clear(); window.location.hash = ''; });

describe('the orb while the page scrolls', () => {
  it('steps back during a scroll and returns after, without moving', () => {
    vi.useFakeTimers();
    try {
      render(<AskOrb onAsk={() => {}} />);
      const orb = screen.getByRole('button', { name: 'Ask Stratemark' });
      const before = orb.style.left;
      expect(orb.dataset.scrolling).toBe('false');
      fireEvent.scroll(document.body);
      expect(orb.dataset.scrolling).toBe('true');
      expect(orb.style.left).toBe(before);
      act(() => { vi.advanceTimersByTime(800); });
      expect(orb.dataset.scrolling).toBe('false');
    } finally { vi.useRealTimers(); }
  });
});

describe('where the orb rests', () => {
  it('sits on the right, low on the screen, until you move it', () => {
    expect(readOrbPos()).toEqual({ x: 1, y: 0.72 });
    const { left, top } = orbPixels(readOrbPos(), 1000, 800);
    expect(left).toBe(1000 - ORB_SIZE - 12);
    expect(top).toBeGreaterThan(400);
  });

  it('stays exactly where it is let go, in the middle of the screen as much as at an edge', () => {
    const middle = placeOrb((1000 - ORB_SIZE) / 2, (800 - ORB_SIZE) / 2, 1000, 800);
    expect(middle.x).toBeCloseTo(0.5, 1);
    expect(middle.y).toBeCloseTo(0.5, 1);
    // ...and it comes back to the same pixels it was dropped on.
    const dropped = { left: 431, top: 289 };
    const back = orbPixels(placeOrb(dropped.left, dropped.top, 1000, 800), 1000, 800);
    expect(back.left).toBeCloseTo(dropped.left, 5);
    expect(back.top).toBeCloseTo(dropped.top, 5);
  });

  it('keeps a dropped place inside the window', () => {
    expect(placeOrb(-300, -300, 1000, 800)).toEqual({ x: 0, y: 0 });
    expect(placeOrb(9000, 5000, 1000, 800)).toEqual({ x: 1, y: 1 });
  });

  it('keeps the side of an orb saved by the version that snapped to an edge', () => {
    window.localStorage.setItem(KEY, '{"side":"left","y":0.3}');
    expect(readOrbPos()).toEqual({ x: 0, y: 0.3 });
    window.localStorage.setItem(KEY, '{"side":"right","y":0.3}');
    expect(readOrbPos()).toEqual({ x: 1, y: 0.3 });
  });

  it('ignores a damaged saved place', () => {
    window.localStorage.setItem(KEY, '{"side":"top","y":"x"}');
    expect(readOrbPos()).toEqual({ x: 1, y: 0.72 });
    window.localStorage.setItem(KEY, 'not json');
    expect(readOrbPos()).toEqual({ x: 1, y: 0.72 });
  });
});

describe('the orb', () => {
  it('asks when pressed and is named for what it does', () => {
    const onAsk = vi.fn();
    render(<AskOrb onAsk={onAsk} />);
    const orb = screen.getByRole('button', { name: 'Ask Stratemark' });
    fireEvent.pointerDown(orb, { clientX: 900, clientY: 600, pointerId: 1 });
    fireEvent.pointerUp(orb, { clientX: 900, clientY: 600, pointerId: 1 });
    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it('is dragged, not pressed, when it moves: it stays where it is let go and remembers', () => {
    const onAsk = vi.fn();
    render(<AskOrb onAsk={onAsk} />);
    const orb = screen.getByRole('button', { name: 'Ask Stratemark' });
    fireEvent.pointerDown(orb, { clientX: 900, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(orb, { clientX: 200, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(orb, { clientX: 200, clientY: 300, pointerId: 1 });
    expect(onAsk).not.toHaveBeenCalled();
    const saved = JSON.parse(window.localStorage.getItem(KEY)!) as { x: number; y: number };
    // Dropped in the middle of the window, not pushed to a side.
    expect(saved.x).toBeGreaterThan(0.2);
    expect(saved.x).toBeLessThan(0.8);
    expect(parseInt(orb.style.left, 10)).toBeGreaterThan(100);
    expect(parseInt(orb.style.left, 10)).toBeLessThan(800);
  });

  it('comes back where it was left on the next visit', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ x: 0.5, y: 0.1 }));
    render(<AskOrb onAsk={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Ask Stratemark' }).style.left).toBe(`${orbPixels({ x: 0.5, y: 0.1 }, 1000, 800).left}px`);
  });

  it('can be moved and pressed from the keyboard', async () => {
    const onAsk = vi.fn();
    render(<AskOrb onAsk={onAsk} />);
    const orb = screen.getByRole('button', { name: 'Ask Stratemark' });
    fireEvent.keyDown(orb, { key: 'ArrowLeft' });
    expect(JSON.parse(window.localStorage.getItem(KEY)!).x).toBeLessThan(1);
    fireEvent.keyDown(orb, { key: 'ArrowUp' });
    expect(JSON.parse(window.localStorage.getItem(KEY)!).y).toBeLessThan(0.72);
    fireEvent.click(orb, { detail: 0 });
    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it('stays within the window when the window gets smaller', () => {
    render(<AskOrb onAsk={() => undefined} />);
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true });
    fireEvent(window, new Event('resize'));
    const orb = screen.getByRole('button', { name: 'Ask Stratemark' });
    expect(parseInt(orb.style.left, 10)).toBeLessThanOrEqual(400 - ORB_SIZE);
    expect(parseInt(orb.style.top, 10)).toBeLessThanOrEqual(500 - ORB_SIZE);
  });
});

describe('the orb is quietly alive', () => {
  const css = readFileSync(resolve(__dirname, 'askOrb.css'), 'utf8');

  it('breathes with the classes the stylesheet targets, and says when it is being dragged', () => {
    render(<AskOrb onAsk={() => undefined} />);
    const orb = screen.getByRole('button', { name: 'Ask Stratemark' });
    expect(orb.className).toContain('ask-orb');
    expect(orb.querySelector('.ask-orb__mark')).not.toBeNull();
    expect(orb.getAttribute('data-dragging')).toBe('false');
    fireEvent.pointerDown(orb, { clientX: 900, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(orb, { clientX: 700, clientY: 400, pointerId: 1 });
    expect(orb.getAttribute('data-dragging')).toBe('true');
    fireEvent.pointerUp(orb, { clientX: 700, clientY: 400, pointerId: 1 });
    expect(orb.getAttribute('data-dragging')).toBe('false');
  });

  it('moves only transform and opacity, is slow, and stops for dragging, pointing and reduced motion', () => {
    const keyframes = (source: string) => {
      const out: string[] = [];
      let at = source.indexOf('@keyframes');
      while (at !== -1) {
        const open = source.indexOf('{', at);
        let depth = 0;
        let end = open;
        for (; end < source.length; end++) {
          if (source[end] === '{') depth++;
          else if (source[end] === '}' && --depth === 0) break;
        }
        out.push(source.slice(open, end + 1));
        at = source.indexOf('@keyframes', end);
      }
      return out.join(' ');
    };
    const frames = keyframes(css);
    const properties = new Set([...frames.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]));
    expect([...properties].sort()).toEqual(['opacity', 'transform']);
    expect(Number(/--ask-orb-breath:\s*([\d.]+)s/.exec(css)?.[1])).toBeGreaterThanOrEqual(5);
    expect(css).toMatch(/\.ask-orb\[data-dragging='true'\]::after/);
    expect(css).toMatch(/\.ask-orb:hover::after/);
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}/.exec(css)?.[1] ?? '';
    expect(reduced).toMatch(/\.ask-orb::after/);
    expect(reduced).toMatch(/animation:\s*none/);
  });
});

describe('what the orb asks about', () => {
  async function repo() {
    const r = makeRepo();
    const [market] = await r.listMarkets();
    const deck = await r.getDeckByMarket(market!.id);
    return { r, market: market!, deck: deck! };
  }

  it('is the deck you are looking at', async () => {
    const { r, market, deck } = await repo();
    expect(await resolveOrbScope(`#/markets/${market.id}/deck`, r)).toEqual({ kind: 'deck', deckId: deck.id });
  });

  it('is the company whose dashboard is open, with its deck when it came from one', async () => {
    const { r, market, deck } = await repo();
    expect(await resolveOrbScope('#/company/cmp_x/dashboard/overview', r)).toEqual({ kind: 'company', deckId: null, companyId: 'cmp_x' });
    expect(await resolveOrbScope(`#/company/cmp_x/dashboard/metrics?deck=${market.id}`, r)).toEqual({ kind: 'company', deckId: deck.id, companyId: 'cmp_x' });
  });

  it('is your most recent deck anywhere else, and nothing when there is no deck', async () => {
    const { r, deck } = await repo();
    expect(await resolveOrbScope('#/history', r)).toEqual({ kind: 'deck', deckId: deck.id });
    const empty = { listMarkets: async () => [], getDeckByMarket: async () => null };
    expect(await resolveOrbScope('#/', empty)).toBeNull();
  });
});

describe('the orb in the app', () => {
  function Probe() {
    const { isOpen } = useDeepDive();
    return <p>{isOpen ? 'panel open' : 'panel closed'}</p>;
  }

  it('stays away from a shared page', async () => {
    renderWithProviders(<DeepDiveProviderWithPanel><Probe /></DeepDiveProviderWithPanel>, { repository: makeRepo(), route: '/share/abc' });
    expect(screen.queryByRole('button', { name: 'Ask Stratemark' })).not.toBeInTheDocument();
  });

  it('opens the chat on what you are looking at, and goes away while the chat is open', async () => {
    const r = makeRepo();
    const [market] = await r.listMarkets();
    const { user } = renderWithProviders(<DeepDiveProviderWithPanel><Probe /></DeepDiveProviderWithPanel>, { repository: r, route: `/markets/${market!.id}/deck` });
    expect(screen.getByText('panel closed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ask Stratemark' }));
    await waitFor(() => expect(screen.getByText('panel open')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Ask Stratemark' })).not.toBeInTheDocument();
    // The analyst greets you; nothing is researched until you ask.
    expect(await screen.findByText(/I've been through everything in/)).toBeInTheDocument();
  });

  it('brings you back to the conversation you left', async () => {
    const r = makeRepo();
    const [market] = await r.listMarkets();
    const { user } = renderWithProviders(<DeepDiveProviderWithPanel><Probe /></DeepDiveProviderWithPanel>, { repository: r, route: `/markets/${market!.id}/deck` });
    await user.click(screen.getByRole('button', { name: 'Ask Stratemark' }));
    await user.click(await screen.findByRole('button', { name: /Who is winning this market/ }));
    await screen.findByText(/demo data/);
    await user.click(screen.getByRole('button', { name: 'Close AI panel' }));
    await user.click(await screen.findByRole('button', { name: 'Ask Stratemark' }));
    expect(await screen.findByText(/demo data/)).toBeInTheDocument();
    expect(screen.getAllByText(/Who is winning this market/).length).toBeGreaterThan(0);
  });
});
