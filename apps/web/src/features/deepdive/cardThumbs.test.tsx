import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { DeepDiveProviderWithPanel, useDeepDive } from './DeepDive';
import { makeRepo, renderWithProviders } from '@/test/test-utils';

async function demoCards() {
  const repo = makeRepo();
  const [market] = await repo.listMarkets();
  const deck = (await repo.getDeckByMarket(market!.id))!;
  const cards = (await repo.listCards(deck.id)).filter((c) => c.company && c.card.cardType === 'company');
  return { repo, deck, cards };
}

function Compare({ deckId, cardIds, seed }: { deckId: string; cardIds: string[]; seed?: string }) {
  const { chat } = useDeepDive();
  return <button onClick={() => chat({ kind: 'cards', deckId, cardIds }, { placeholder: 'Ask a follow-up…', ...(seed ? { seed } : {}) })}>start</button>;
}

describe('cards in the chat', () => {
  it('shows the cards you lined up as small thumbnails, and greets you about them by name', async () => {
    const { repo, deck, cards } = await demoCards();
    const picked = cards.slice(0, 3);
    const { user } = renderWithProviders(
      <DeepDiveProviderWithPanel><Compare deckId={deck.id} cardIds={picked.map((c) => c.card.id)} /></DeepDiveProviderWithPanel>,
      { repository: repo },
    );
    await user.click(screen.getByRole('button', { name: 'start' }));
    const strip = await screen.findByLabelText('Cards in this conversation');
    for (const c of picked) expect(within(strip).getByRole('button', { name: `Open the ${c.company!.name} card` })).toBeInTheDocument();
    expect(within(strip).getByText('3 cards in this chat')).toBeInTheDocument();
    const greeting = await screen.findByText(/You've lined up/);
    for (const c of picked) expect(greeting.textContent).toContain(c.company!.name);
  });

  it('opens the card when its thumbnail is pressed', async () => {
    const { repo, deck, cards } = await demoCards();
    const one = cards[0]!;
    const { user } = renderWithProviders(
      <DeepDiveProviderWithPanel><Compare deckId={deck.id} cardIds={[one.card.id]} /></DeepDiveProviderWithPanel>,
      { repository: repo },
    );
    await user.click(screen.getByRole('button', { name: 'start' }));
    await user.click(await screen.findByRole('button', { name: `Open the ${one.company!.name} card` }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: new RegExp(`Inspect ${one.company!.name}`, 'i') })).toBeInTheDocument());
  });

  it('starts the comparison itself when the question is sent along, so it is already a conversation', async () => {
    const { repo, deck, cards } = await demoCards();
    const { user } = renderWithProviders(
      <DeepDiveProviderWithPanel><Compare deckId={deck.id} cardIds={cards.slice(0, 2).map((c) => c.card.id)} seed="Compare these 2 head-to-head." /></DeepDiveProviderWithPanel>,
      { repository: repo },
    );
    await user.click(screen.getByRole('button', { name: 'start' }));
    expect((await screen.findAllByText('Compare these 2 head-to-head.')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/demo data/)).toBeInTheDocument();
    expect(screen.queryByText(/You've lined up/)).not.toBeInTheDocument();
  });
});
