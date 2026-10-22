import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MockRepository, type SeedSnapshot } from '@mi/mocks';
import type { CardWithCompany } from '@mi/contracts';
import sample from '@/sample/frontier-snapshot.json';
import { renderWithProviders } from '@/test/test-utils';
import { buildCardView } from '@/features/card/card-view';
import { faceFooter } from '@/features/card/faceFooter';
import { CollectibleCard } from '@/features/card/CollectibleCard';
import { PrintCardFace } from './PrintCardFace';

// The Logo probes the network; the face's text is what is under test.
vi.mock('@/features/card/Logo', () => ({ Logo: () => <span data-testid="logo" /> }));

let cards: CardWithCompany[] = [];
beforeAll(async () => {
  const repo = new MockRepository({ seedSnapshot: sample as unknown as SeedSnapshot, latencyMs: 0 });
  cards = await repo.listCards(sample.decks[0]!.id);
});

const text = (el: Element) => el.textContent?.replace(/\s+/g, ' ').trim();

describe('PrintCardFace', () => {
  it('prints the same face text as the app card for a company card', () => {
    const data = cards.find((c) => c.card.cardType === 'company' && c.company)!;
    const view = buildCardView(data);
    const printed = renderWithProviders(<PrintCardFace data={data} width="hero" />).container;
    const face = printed.querySelector('[data-testid="collectible-card-front"]')!;
    const name = face.querySelector('.collectible__name')!;
    expect(text(name)).toBe(view.frontTitle);
    const shown = Array.from(face.querySelectorAll('.collectible__metrics > div')).map((d) => text(d));
    expect(shown).toEqual(view.faceMetrics.map((m) => `${m.display}${m.label}`.replace(/\s+/g, ' ').trim()));
    expect(shown.length).toBeGreaterThan(0);
    // The footer is the new face's own: founding year (only when sourced) and last update, no sourced-count line.
    const footer = faceFooter(data);
    const footerText = text(face.querySelector('.collectible__footer')!);
    for (const part of [footer.lead, footer.updated]) if (part) expect(footerText).toContain(part);
    expect(footerText).not.toMatch(/figures sourced|sources tracked/);
    // Identical to the app's own card, character for character.
    const app = renderWithProviders(<CollectibleCard data={data} />).container;
    expect(text(face)).toBe(text(app.querySelector('[data-testid="collectible-card-front"]')!));
  });

  it('prints a signal card as its finding, with no company metric rows', () => {
    const data = cards.find((c) => c.card.cardType === 'vice')!;
    const view = buildCardView(data);
    expect(view.signal).toBe(true);
    const { container } = renderWithProviders(<PrintCardFace data={data} width="lineup" />);
    expect(container.querySelector('.collectible__metrics')).toBeNull();
    expect(container.querySelector('.collectible__metric-value')).toBeNull();
    expect(text(container.querySelector('.collectible__name')!)).toBe(view.frontTitle);
    if (view.frontFinding) expect(text(container.querySelector('.collectible__signal-copy p')!)).toBe(view.frontFinding);
  });

  it('prints an unknown figure the way the face does, never a number', () => {
    const base = cards.find((c) => c.card.cardType === 'company' && c.company)!;
    const data: CardWithCompany = { ...base, metrics: [] };
    const view = buildCardView(data);
    const { container } = renderWithProviders(<PrintCardFace data={data} width="hero" />);
    const values = Array.from(container.querySelectorAll('.collectible__metric-value')).map((v) => text(v));
    expect(values).toEqual(view.faceMetrics.map((m) => m.display));
    for (const v of values) expect(v).not.toMatch(/\d/);
    expect(container.querySelectorAll('.collectible__metric--unknown').length).toBe(view.faceMetrics.length);
  });

  it('lays the lineup size out in a fixed box and the hero at natural scale', () => {
    const data = cards.find((c) => c.card.cardType === 'company' && c.company)!;
    const lineup = renderWithProviders(<PrintCardFace data={data} width="lineup" />);
    const box = lineup.container.querySelector('.sm-cardface')!;
    expect(box).toHaveClass('sm-cardface--lineup');
    expect(box.querySelector('.sm-cardface__inner')).not.toBeNull();
    expect(box.querySelector('.sm-cardface__inner [data-testid="collectible-card-front"]')).not.toBeNull();
    const hero = renderWithProviders(<PrintCardFace data={data} width="hero" />);
    expect(hero.container.querySelector('.sm-cardface')).toHaveClass('sm-cardface--hero');
    expect(screen.getAllByTestId('print-card-face')).toHaveLength(2);
  });

  it('takes only a card and a size: no prop can carry a figure', () => {
    const data = cards[0]!;
    // @ts-expect-error a figure prop is not part of the component's props
    renderWithProviders(<PrintCardFace data={data} width="hero" metrics={[{ display: '$999B' }]} />);
    expect(screen.queryByText('$999B')).toBeNull();
    // @ts-expect-error neither is a view or a display override
    renderWithProviders(<PrintCardFace data={data} width="hero" view={{ title: 'X' }} />);
    expect(screen.queryByText('X')).toBeNull();
  });
});
