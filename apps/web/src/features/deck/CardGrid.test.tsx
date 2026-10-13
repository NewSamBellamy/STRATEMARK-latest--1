import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import type { CardWithCompany } from '@mi/contracts';
import { buildDataset } from '@mi/mocks';
import { renderWithProviders } from '@/test/test-utils';
import { CardGrid } from './CardGrid';

const renders = new Map<string, number>();

vi.mock('@/features/card/GameCard', () => ({
  GameCard: ({ data, onOpen, onShare }: { data: CardWithCompany; onOpen?: () => void; onShare?: () => void }) => {
    renders.set(data.card.id, (renders.get(data.card.id) ?? 0) + 1);
    return (
      <div>
        <button type="button" onClick={onOpen}>open {data.card.id}</button>
        <button type="button" onClick={onShare}>share {data.card.id}</button>
      </div>
    );
  },
}));

vi.mock('@/features/card/CardReader', () => ({
  CardReader: ({ data }: { data: CardWithCompany | null }) => <output data-testid="reader">{data?.card.id ?? ''}</output>,
}));

vi.mock('@/features/share/ShareDialog', () => ({
  ShareDialog: ({ open, title }: { open: boolean; title: string }) => (open ? <output data-testid="share">{title}</output> : null),
}));

const dataset = buildDataset();
const initial: CardWithCompany[] = dataset.cards.slice(0, 3).map((card) => ({
  card, company: null, metrics: [], viceClaims: [],
}));
const userValues: number[] = [];

let setCards: (next: CardWithCompany[]) => void = () => {};
function Harness({ selectable = false, onToggle }: { selectable?: boolean; onToggle?: (id: string) => void }) {
  const [cards, set] = useState(initial);
  setCards = set;
  return <CardGrid cards={cards} deckUserValues={userValues} selectable={selectable} onToggle={onToggle} />;
}

describe('CardGrid', () => {
  it('re-renders only the card whose data changed', () => {
    renders.clear();
    renderWithProviders(<Harness />);
    const [a, b, c] = initial.map((x) => x.card.id);
    expect(renders.get(a!)).toBe(1);

    const edited = { ...initial[1]!, card: { ...initial[1]!.card, title: 'Renamed' } };
    act(() => setCards([initial[0]!, edited, initial[2]!]));

    expect(renders.get(a!)).toBe(1);
    expect(renders.get(b!)).toBe(2);
    expect(renders.get(c!)).toBe(1);
  });

  it('opening a card updates the reader without re-rendering the grid', async () => {
    renders.clear();
    const { user } = renderWithProviders(<Harness />);
    const id = initial[2]!.card.id;
    await user.click(screen.getByRole('button', { name: `open ${id}` }));
    expect(screen.getByTestId('reader')).toHaveTextContent(id);
    for (const x of initial) expect(renders.get(x.card.id)).toBe(1);
  });

  it('routes clicks to the latest mode and share target', async () => {
    const onToggle = vi.fn();
    const { user } = renderWithProviders(<Harness selectable onToggle={onToggle} />);
    const id = initial[0]!.card.id;
    await user.click(screen.getByRole('button', { name: `open ${id}` }));
    expect(onToggle).toHaveBeenCalledWith(id);
    expect(screen.getByTestId('reader')).toHaveTextContent('');
    await user.click(screen.getByRole('button', { name: `share ${id}` }));
    expect(screen.getByTestId('share')).toBeInTheDocument();
  });
});
