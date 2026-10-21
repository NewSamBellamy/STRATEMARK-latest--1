import { describe, expect, it } from 'vitest';
import { buildDataset } from '@mi/mocks';
import type { ShareSnapshot } from '@mi/contracts';
import { ogFace, ogFaces } from './ogFace';
import { ogLayout } from './bundle';

const data = buildDataset();

function snapshot(over: Partial<ShareSnapshot>): ShareSnapshot {
  return {
    v: 1,
    kind: 'deck',
    focusCardId: null,
    sharedAt: '2026-10-01T09:00:00.000Z',
    markets: [data.market],
    decks: [data.deck],
    companies: data.companies,
    metrics: data.metrics,
    cards: data.cards,
    viceClaims: data.viceClaims,
    dashboards: {},
    ...over,
  } as ShareSnapshot;
}

const companyCard = data.cards.find((c) => c.cardType === 'company' && c.companyId === 'cmp_gracewear-global')!;
const viceCard = data.cards.find((c) => c.cardType === 'vice')!;
const barrierCard = data.cards.find((c) => c.cardType === 'barrier')!;

describe('the face a preview picture draws', () => {
  it('is the card itself: a company card carries its name, place, line, four figures and footer as the face prints them', () => {
    const [face] = ogFaces(snapshot({ kind: 'card', focusCardId: companyCard.id }));
    expect(face).toBeDefined();
    expect(face!.kind).toBe('company');
    expect(face!.name.length).toBeGreaterThan(0);
    expect(face!.eyebrow.length).toBeGreaterThan(0);
    expect(face!.slots.length).toBeGreaterThan(0);
    expect(face!.slots.length).toBeLessThanOrEqual(4);
    // Every slot says what the face says; a place with no sourced figure says so and is marked unknown, never a number.
    for (const slot of face!.slots) {
      expect(slot.label.length).toBeGreaterThan(0);
      if (!slot.known) expect(slot.value).toMatch(/not found|unknown/i);
    }
    expect(face!.position).toMatch(/figures sourced|Research pending/);
    expect(face!.provenance).toMatch(/source|Research needed/);
    expect(face!.artSrc).toBeNull();
  });

  it('never gives a signal card a company\'s figures, and gives it the art and finding label of its type', () => {
    const [vice] = ogFaces(snapshot({ kind: 'card', focusCardId: viceCard.id }));
    expect(vice!.kind).toBe('signal');
    expect(vice!.slots).toEqual([]);
    expect(vice!.logoUrl).toBeNull();
    expect(vice!.artSrc).toBeTruthy();
    expect(vice!.position).toBe('Market signal');
    if (vice!.finding) expect(vice!.findingLabel).toBe('Risk signal');
    const [barrier] = ogFaces(snapshot({ kind: 'card', focusCardId: barrierCard.id }));
    expect(barrier!.kind).toBe('signal');
    expect(barrier!.slots).toEqual([]);
  });

  it('is the first few company cards for a deck, front card first, and nothing for a deck with no company', () => {
    const faces = ogFaces(snapshot({ kind: 'deck' }));
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.length).toBeLessThanOrEqual(3);
    expect(faces.every((f) => f.kind === 'company')).toBe(true);
    expect(ogFaces(snapshot({ kind: 'deck', cards: data.cards.filter((c) => c.cardType !== 'company') }))).toEqual([]);
  });

  it('rides along with the layout the picture is drawn from', () => {
    const layout = ogLayout(snapshot({ kind: 'card', focusCardId: companyCard.id }));
    expect(layout.faces).toHaveLength(1);
    expect(layout.faces[0]!.name).toBe(ogFace({ card: companyCard, company: data.companies.find((c) => c.id === companyCard.companyId)!, metrics: data.metrics.filter((m) => m.companyId === companyCard.companyId), viceClaims: [] }).name);
  });
});
