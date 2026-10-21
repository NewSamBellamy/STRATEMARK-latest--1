import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AskOrb, ORB_SIZE, orbPixels, readOrbPos, snapOrb } from './AskOrb';
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

describe('where the orb rests', () => {
  it('sits on the right, low on the screen, until you move it', () => {
    expect(readOrbPos()).toEqual({ side: 'right', y: 0.72 });
    const { left, top } = orbPixels(readOrbPos(), 1000, 800);
    expect(left).toBe(1000 - ORB_SIZE - 12);
    expect(top).toBeGreaterThan(400);
  });

  it('snaps to the nearest edge and keeps its height', () => {
    expect(snapOrb(100, 300, 1000, 800)).toMatchObject({ side: 'left' });
    expect(snapOrb(700, 300, 1000, 800)).toMatchObject({ side: 'right' });
    const pos = snapOrb(700, 12, 1000, 800);
    expect(pos.y).toBe(0);
    expect(snapOrb(700, 5000, 1000, 800).y).toBe(1);
  });

  it('ignores a damaged saved place', () => {
    window.localStorage.setItem(KEY, '{"side":"top","y":"x"}');
    expect(readOrbPos()).toEqual({ side: 'right', y: 0.72 });
    window.localStorage.setItem(KEY, 'not json');
    expect(readOrbPos()).toEqual({ side: 'right', y: 0.72 });
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

  it('is dragged, not pressed, when it moves: it lands on the nearest edge and remembers', () => {
    const onAsk = vi.fn();
    render(<AskOrb onAsk={onAsk} />);
    const orb = screen.getByRole('button', { name: 'Ask Stratemark' });
    fireEvent.pointerDown(orb, { clientX: 900, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(orb, { clientX: 200, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(orb, { clientX: 200, clientY: 300, pointerId: 1 });
    expect(onAsk).not.toHaveBeenCalled();
    const saved = JSON.parse(window.localStorage.getItem(KEY)!) as { side: string; y: number };
    expect(saved.side).toBe('left');
    expect(orb.style.left).toBe('12px');
  });

  it('comes back where it was left on the next visit', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ side: 'left', y: 0.1 }));
    render(<AskOrb onAsk={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Ask Stratemark' }).style.left).toBe('12px');
  });

  it('can be moved and pressed from the keyboard', async () => {
    const onAsk = vi.fn();
    render(<AskOrb onAsk={onAsk} />);
    const orb = screen.getByRole('button', { name: 'Ask Stratemark' });
    fireEvent.keyDown(orb, { key: 'ArrowLeft' });
    expect(JSON.parse(window.localStorage.getItem(KEY)!).side).toBe('left');
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
