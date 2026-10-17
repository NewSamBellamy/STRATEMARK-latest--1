import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { COVER_PALETTES, coverSpec, hashSeed, monogram, roseSet } from './coverArt';
import { DeckCover } from './DeckCover';

const NAMES = [
  'Frontier AI Ecosystem', 'Christian Apparel Companies — California', 'Specialty coffee roasters', 'Grid-scale batteries',
  'Vertical SaaS for dentists', 'Humanoid robotics', 'Open-source databases', 'Fusion energy', 'Pet insurance', 'Space launch',
];

describe('deck cover art', () => {
  it('is the same every time for the same deck, whatever its capitalisation', () => {
    expect(coverSpec('mkt_abc')).toEqual(coverSpec('mkt_abc'));
    expect(coverSpec('Frontier AI')).toEqual(coverSpec('  frontier ai '));
    expect(hashSeed('a')).toBe(hashSeed('a'));
  });

  it('makes decks look different from one another', () => {
    const looks = new Set(NAMES.map((n) => JSON.stringify([coverSpec(n).outer, coverSpec(n).inner, coverSpec(n).pen, coverSpec(n).copies, coverSpec(n).rotation])));
    expect(looks.size).toBe(NAMES.length);
    const palettes = new Set(NAMES.map((n) => coverSpec(n).palette.name));
    expect(palettes.size).toBeGreaterThan(1);
  });

  it('only uses the card-art palettes', () => {
    for (const n of NAMES) expect(COVER_PALETTES).toContain(coverSpec(n).palette);
    for (const p of COVER_PALETTES) for (const c of [...p.metal, ...p.field, p.accent]) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('draws clean, bounded line work: no broken numbers and a light page weight', () => {
    for (const n of NAMES) {
      const paths = roseSet(coverSpec(n), 150, 168, 104);
      expect(paths.length).toBeGreaterThanOrEqual(6);
      expect(paths.length).toBeLessThanOrEqual(9);
      const all = paths.join('');
      expect(all).not.toMatch(/NaN|Infinity|undefined/);
      expect(all.length).toBeLessThan(30_000);
      // Every point stays on the cover.
      for (const m of Array.from(all.matchAll(/[ML](-?\d+(?:\.\d)?) (-?\d+(?:\.\d)?)/g))) {
        const x = Number(m[1]);
        const y = Number(m[2]);
        expect(x).toBeGreaterThan(20);
        expect(x).toBeLessThan(280);
        expect(y).toBeGreaterThan(50);
        expect(y).toBeLessThan(290);
      }
    }
  });

  it('puts the deck\'s initials in the medallion', () => {
    expect(monogram('Frontier AI Ecosystem')).toBe('FA');
    expect(monogram('The Grid of the Future')).toBe('GF');
    expect(monogram('Humanoid')).toBe('H');
    expect(monogram('  —  ')).toBe('S');
    expect(monogram('émigré café')).toBe('ÉC');
  });

  it('renders as decoration: hidden from assistive tech, with the initials and the ordinal', () => {
    const { container } = render(<DeckCover name="Frontier AI Ecosystem" seed="mkt_1" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.textContent).toContain('FA');
    expect(svg.textContent).toMatch(/NO\. \d\d/);
    expect(svg.textContent).toContain('STRATEMARK / DECK');
  });

  it('gives each cover its own gradient ids so covers side by side never borrow each other\'s colours', () => {
    const { container } = render(<><DeckCover name="A" seed="1" /><DeckCover name="B" seed="2" /></>);
    const ids = [...container.querySelectorAll('[id]')].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
