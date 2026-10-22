import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { buildDataset } from '@mi/mocks';
import { renderWithProviders } from '@/test/test-utils';
import { CardStage, settleSpin, showsBack } from './CardStage';
import { buildCardView } from './card-view';

const dataset = buildDataset();
const card = dataset.cards.find((c) => c.cardType === 'company' && c.companyId)!;
const data = {
  card,
  company: dataset.companies.find((c) => c.id === card.companyId)!,
  metrics: dataset.metrics.filter((m) => m.companyId === card.companyId),
  viceClaims: [],
};
const view = buildCardView(data);
const spin = () => screen.getByTestId('collectible-card-back').closest('.card-stage__spin') as HTMLElement;

describe('turning the card over', () => {
  it('settles a drag on the nearer face, and a short flick still turns it over', () => {
    expect(settleSpin(0, 40)).toBe(180); // a flick to the right
    expect(settleSpin(0, -40)).toBe(-180);
    expect(settleSpin(0, 10)).toBe(0); // a nudge springs back
    expect(settleSpin(0, 300)).toBe(360); // a long drag spins it all the way round
    expect(settleSpin(180, 400)).toBe(540);
    expect(showsBack(540)).toBe(true);
    expect(showsBack(-360)).toBe(false);
  });

  it('has a keyboard Flip button that shows the back, then the front again', async () => {
    const { user } = renderWithProviders(<CardStage data={data} view={view} />);
    const flip = screen.getByRole('button', { name: 'Flip card' });
    expect(flip).toHaveAttribute('aria-pressed', 'false');
    expect(spin()).toHaveAttribute('data-face', 'front');

    flip.focus();
    await user.keyboard('{Enter}');
    expect(spin()).toHaveAttribute('data-face', 'back');
    expect(screen.getByRole('button', { name: 'Show front' })).toHaveAttribute('aria-pressed', 'true');
    // The hidden face is hidden from assistive tech too.
    expect(screen.getByTestId('collectible-card-front').closest('.card-stage__face')).toHaveAttribute('aria-hidden', 'true');

    await user.click(screen.getByRole('button', { name: 'Show front' }));
    expect(spin()).toHaveAttribute('data-face', 'front');
  });

  it('spins with a sideways drag and settles on the back', () => {
    // jsdom has no PointerEvent; a MouseEvent with the pointer fields is enough here.
    class FakePointerEvent extends MouseEvent {
      pointerId: number; isPrimary: boolean; pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1; this.isPrimary = init.isPrimary ?? true; this.pointerType = init.pointerType ?? 'mouse';
      }
    }
    vi.stubGlobal('PointerEvent', FakePointerEvent);
    renderWithProviders(<CardStage data={data} view={view} />);
    const surface = spin().closest('.card-stage__perspective')!;
    fireEvent.pointerDown(surface, { pointerId: 1, isPrimary: true, button: 0, clientX: 100 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 260 });
    expect(spin().style.getPropertyValue('--spin')).toBe('144deg');
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 260 });
    expect(spin().style.getPropertyValue('--spin')).toBe('');
    expect(spin()).toHaveAttribute('data-face', 'back');
    vi.unstubAllGlobals();
  });

  it('under reduced motion, a drag does not spin it, and the Flip button still turns it over', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
    const { user } = renderWithProviders(<CardStage data={data} view={view} />);
    const surface = spin().closest('.card-stage__perspective')!;
    fireEvent.pointerDown(surface, { pointerId: 1, isPrimary: true, button: 0, clientX: 100 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 260 });
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 260 });
    expect(spin().style.getPropertyValue('--spin')).toBe('');
    expect(spin()).toHaveAttribute('data-face', 'front');
    await user.click(screen.getByRole('button', { name: 'Flip card' }));
    expect(spin()).toHaveAttribute('data-face', 'back');
    vi.unstubAllGlobals();
  });
});
