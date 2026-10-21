import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { buildDataset } from '@mi/mocks';
import type { CardWithCompany, CompanyMetric, ResearchJob } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import type { LivingDeckState } from '@/lib/living/useLivingDeck';
import { DeckStatusBar, deskProgress, plainCoverageNote } from './DeckStatusBar';

const dataset = buildDataset();
const baseCard = dataset.cards.find((c) => c.cardType === 'company' && c.companyId)!;
const baseCompany = dataset.companies.find((c) => c.id === baseCard.companyId)!;
const seed = dataset.metrics.find((m) => m.companyId === baseCompany.id)!;
const cite = [{ title: 'Reuters', url: 'https://www.reuters.com/x', credibility: 'reputable_secondary' as const }];

function figure(metricType: CompanyMetric['metricType'], value: number): CompanyMetric {
  return { ...seed, id: `m_${metricType}`, metricType, value, confidence: 'user_verified', citations: cite, source: cite[0]!.url };
}
function deckCard(n: number, metrics: CompanyMetric[], cardType: CardWithCompany['card']['cardType'] = 'company'): CardWithCompany {
  const id = `cmp_status_${n}`;
  return {
    card: { ...baseCard, id: `card_${n}_${cardType}`, companyId: id, cardType, deckId: 'deck_1' },
    company: { ...baseCompany, id, name: `Status Co ${n}`, oneLiner: `Status Co ${n} sells software.` },
    metrics: metrics.map((m) => ({ ...m, id: `${m.id}_${id}`, companyId: id })),
    viceClaims: [],
  };
}
const full = (n: number) => deckCard(n, [figure('employees', 40), figure('arr', 2e6), figure('users', 900), figure('valuation', 2e7)]);
const half = (n: number) => deckCard(n, [figure('employees', 40), figure('users', 900)]);

function living(overrides: Partial<LivingDeckState> = {}): LivingDeckState {
  return {
    events: [],
    status: 'resting',
    deskCount: 2,
    actionCount: 0,
    canVerify: true,
    pause: vi.fn(),
    resume: vi.fn(),
    fillCardFaces: vi.fn(async () => ({ targeted: 0, filledCompanies: 0, filledTypes: 0, failed: 0 })),
    ...overrides,
  };
}

function job(overrides: Partial<ResearchJob>): ResearchJob {
  const now = new Date().toISOString();
  return {
    id: 'job_1', status: 'completed', stage: 'metrics', brief: {} as ResearchJob['brief'],
    deck: { id: 'deck_1' } as ResearchJob['deck'],
    catalogNames: [], completedEntityNames: [], partialCards: [], warnings: [], error: null,
    createdAt: now, updatedAt: now,
    ...overrides,
  };
}

describe('deskProgress', () => {
  it('counts each company once across its entity cards, like the deck header', () => {
    const rows = deskProgress([full(1), deckCard(1, [], 'infrastructure'), half(2), deckCard(3, [], 'culture')]);
    expect(rows.map((r) => r.name)).toEqual(['Status Co 1', 'Status Co 2']);
    expect(rows[0]).toMatchObject({ filled: 4, total: 4 });
    expect(rows[1]).toMatchObject({ filled: 2, total: 4 });
  });
});

describe('DeckStatusBar', () => {
  it('says "Deck ready" only when every card face is sourced', () => {
    renderWithProviders(<DeckStatusBar deckId="deck_1" marketName="Test" cards={[full(1), full(2)]} living={living()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Deck ready · 2 companies · every card face sourced');
    expect(screen.queryByRole('button', { name: /find missing figures/i })).not.toBeInTheDocument();
  });

  it('never claims ready while a card still shows Unknown, and offers to find the gaps', async () => {
    const state = living();
    const { user } = renderWithProviders(
      <DeckStatusBar deckId="deck_1" marketName="Test" cards={[full(1), half(2)]} living={state} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2 cards complete · 2 figures not found yet');
    expect(screen.queryByText(/deck ready/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /find missing figures/i }));
    expect(state.fillCardFaces).toHaveBeenCalledTimes(1);
  });

  it('opens the existing list of missing figures from the "not found yet" text', async () => {
    const { user } = renderWithProviders(
      <DeckStatusBar deckId="deck_1" marketName="Test" cards={[full(1), half(2)]} living={living()} />,
    );
    expect(screen.queryByRole('region', { name: 'Figures still missing' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '2 figures not found yet' }));
    expect(screen.getByRole('region', { name: 'Figures still missing' })).toBeInTheDocument();
  });

  it('shows live filling while background research runs', () => {
    renderWithProviders(<DeckStatusBar deckId="deck_1" marketName="Test" cards={[full(1), half(2)]} living={living({ status: 'running' })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Filling cards · 1 of 2 complete · 2 figures to find');
  });

  it('counts a creation run against the companies it planned, with no percentage', async () => {
    const repository = Object.assign(makeRepo(), {
      listResearchJobs: async () => [job({ status: 'running', catalogNames: ['A', 'B', 'C'], completedEntityNames: ['A'] })],
    });
    renderWithProviders(
      <DeckStatusBar deckId="deck_1" marketName="Frontier AI" cards={[full(1)]} living={living()} />,
      { repository },
    );
    expect(await screen.findByText('Researching Frontier AI')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 of 3 companies');
    expect(screen.getByRole('status').textContent).not.toMatch(/%/);
    expect(screen.queryByRole('button', { name: /find missing figures/i })).not.toBeInTheDocument();
  });

  it('expands to companies and activity, collapsing repeated lines into a count', async () => {
    const events = [1, 2, 3].map((id) => ({ id, at: Date.now(), kind: 'hunting' as const, companyName: null, message: 'Searching filings' }));
    const { user } = renderWithProviders(
      <DeckStatusBar deckId="deck_1" marketName="Test" cards={[full(1), half(2)]} living={living({ events })} />,
    );
    await user.click(screen.getByRole('button', { name: /details/i }));
    const companies = screen.getByRole('region', { name: 'Companies' });
    expect(companies).toHaveTextContent('Status Co 2');
    expect(companies).toHaveTextContent('2 of 4 figures');
    const activity = screen.getByRole('region', { name: 'Activity' });
    expect(activity.querySelectorAll('li')).toHaveLength(1);
    expect(activity).toHaveTextContent('Searching filings ×3');
  });

  it('re-counts a creation-time coverage shortfall against the cards the deck holds now', async () => {
    const repository = Object.assign(makeRepo(), {
      listResearchJobs: async () => [job({ warnings: ['Coverage shortfall for vice: found 2, minimum is 4. More text', 'Coverage shortfall for culture: found 0, minimum is 4. More text'] })],
    });
    const cards = [full(1), ...[1, 2, 3, 4, 5].map((n) => deckCard(10 + n, [], 'vice')), ...[1, 2].map((n) => deckCard(20 + n, [], 'culture'))];
    const { user } = renderWithProviders(<DeckStatusBar deckId="deck_1" marketName="Test" cards={cards} living={living()} />, { repository });
    await user.click(await screen.findByRole('button', { name: /details/i }));
    const notes = await screen.findByRole('region', { name: 'Coverage notes' });
    // Five risk cards now: the old "found 2" note is gone. Two culture cards: the note says 2, not 0.
    expect(notes).not.toHaveTextContent('risk and controversy');
    expect(notes).toHaveTextContent('Found 2 sourced culture signals (aiming for 4)');
  });

  it('turns a coverage shortfall into a plain sentence', () => {
    expect(plainCoverageNote('Coverage shortfall for vice: found 0, minimum is 4. More text'))
      .toBe('Found 0 sourced risk and controversy signals (aiming for 4). Only findings with a source are shown — nothing was made up to fill the gap.');
  });
});
