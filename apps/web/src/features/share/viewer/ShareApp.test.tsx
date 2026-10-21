import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ShareSnapshot } from '@mi/contracts';
import { MockRepository } from '@mi/mocks';
import { ShareApp } from './ShareApp';
import { isShareSnapshot, readEmbeddedShare } from './embedded';

async function snapshotOf(kind: 'card' | 'deck'): Promise<ShareSnapshot> {
  const repo = new MockRepository({ latencyMs: 0 });
  const [market] = await repo.listMarkets();
  const deck = await repo.getDeckByMarket(market!.id);
  if (kind === 'deck') return repo.exportShareSnapshot({ deckId: deck!.id });
  const cards = await repo.listCards(deck!.id);
  const company = cards.find((c) => c.company && c.card.cardType === 'company')!;
  return repo.exportShareSnapshot({ deckId: deck!.id, cardId: company.card.id });
}

beforeEach(() => { window.location.hash = ''; });
afterEach(() => { window.location.hash = ''; });

describe('the share viewer', () => {
  it('opens a shared card on the card, with the way into its research and a quiet sign-up line', async () => {
    const snapshot = await snapshotOf('card');
    render(<ShareApp snapshot={snapshot} signupUrl="https://sign.example/up" />);
    const name = snapshot.companies[0]!.name;
    expect(await screen.findByRole('heading', { level: 1, name })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View the full research/ })).toHaveAttribute('href', `#/company/${snapshot.companies[0]!.id}/dashboard/overview`);
    expect(screen.getByText('Want to research more companies?')).toBeInTheDocument();
    for (const link of screen.getAllByRole('link', { name: 'Sign up' })) expect(link).toHaveAttribute('href', 'https://sign.example/up');
  });

  it('offers nothing that researches, asks, saves or shares', async () => {
    render(<ShareApp snapshot={await snapshotOf('card')} />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: /ask|research|share|save|report/i })).not.toBeInTheDocument();
  });

  it('opens a shared deck straight on the deck, without the deck\'s ask, share or change controls', async () => {
    const snapshot = await snapshotOf('deck');
    render(<ShareApp snapshot={snapshot} />);
    expect(await screen.findByRole('heading', { level: 1, name: snapshot.markets[0]!.name })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('card-grid')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^Ask|Compare|Share & export|More actions/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share card' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'All decks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back' })).not.toBeInTheDocument();
  });
});

describe('the data inside a share page', () => {
  const doc = (text: string | null) => ({ getElementById: () => (text === null ? null : ({ textContent: text } as HTMLElement)) });

  it('reads the snapshot and a sign-up address', async () => {
    const snapshot = await snapshotOf('card');
    const read = readEmbeddedShare(doc(JSON.stringify({ snapshot, signupUrl: 'https://sign.example/up' })));
    expect(read.snapshot?.kind).toBe('card');
    expect(read.signupUrl).toBe('https://sign.example/up');
  });

  it('says there is nothing when the page was opened from the bare template or hand-edited', async () => {
    expect(readEmbeddedShare(doc(null)).snapshot).toBeNull();
    expect(readEmbeddedShare(doc('__STRATEMARK_SHARE_DATA__')).snapshot).toBeNull();
    expect(readEmbeddedShare(doc(JSON.stringify({ snapshot: { v: 2 } }))).snapshot).toBeNull();
    expect(readEmbeddedShare(doc(JSON.stringify({ snapshot: await snapshotOf('card'), signupUrl: 'javascript:alert(1)' }))).signupUrl).toBeUndefined();
  });

  it('rejects a snapshot with no cards in it', async () => {
    const snapshot = await snapshotOf('card');
    expect(isShareSnapshot({ ...snapshot, cards: [] })).toBe(false);
    expect(isShareSnapshot(snapshot)).toBe(true);
  });
});

describe('what the share page says about its sources', () => {
  it('says it is a copy shared by someone else whose sources are linked, not re-checked, and does not promise otherwise', async () => {
    render(<ShareApp snapshot={await snapshotOf('card')} />);
    await screen.findByRole('heading', { level: 1 });
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent('A read-only copy shared by someone else. Its sources are linked, not re-checked here; nothing runs new research.');
    expect(footer).not.toHaveTextContent(/every figure keeps its source/i);
  });
});
