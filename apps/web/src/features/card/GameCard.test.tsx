import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { buildDataset } from '@mi/mocks';
import { renderWithProviders } from '@/test/test-utils';
import { GameCard } from './GameCard';

const data = buildDataset();
const companyCard = data.cards.find(
  (c) => c.cardType === 'company' && c.companyId === 'cmp_gracewear-global',
)!;
const viceCard = data.cards.find((c) => c.cardType === 'vice')!;
const barrierCard = data.cards.find((c) => c.cardType === 'barrier')!;

function hydrate(cardId: string) {
  const card = data.cards.find((c) => c.id === cardId)!;
  const company = card.companyId ? data.companies.find((c) => c.id === card.companyId)! : null;
  const metrics = card.companyId ? data.metrics.filter((m) => m.companyId === card.companyId) : [];
  const viceClaims = data.viceClaims.filter((v) => v.cardId === card.id);
  return { card, company, metrics, viceClaims };
}

describe('GameCard', () => {
  it('shows a collectible face with truthful metrics, not a quality rating', () => {
    const cwc = hydrate(companyCard.id);
    const deckUserValues = data.metrics
      .filter((m) => m.metricType === 'users' && m.confidence !== 'unknown' && m.value !== null)
      .map((m) => m.value as number);
    renderWithProviders(<GameCard data={cwc} deckUserValues={deckUserValues} />);
    expect(screen.getAllByText('GraceWear Global').length).toBeGreaterThan(0);
    expect(screen.getByText(cwc.company!.oneLiner)).toBeInTheDocument();
    expect(screen.getByText('Revenue / ARR')).toBeInTheDocument();
    expect(screen.getByText(/\d\/4 figures sourced/)).toBeInTheDocument();
    expect(screen.queryByText(/Very Strong|Very Weak/)).not.toBeInTheDocument();
    expect(screen.getByText(/research needed/i)).toBeInTheDocument();
    // HQ shown.
    expect(screen.getByText(/Los Angeles/)).toBeInTheDocument();
  });

  it('never renders a fabricated YoY growth arrow (no-fabrication rule)', () => {
    // The card used to paint `fakeYoY` percentages invented from the metric's
    // own digits. Growth indicators are banned until real history exists.
    renderWithProviders(<GameCard data={hydrate(companyCard.id)} />);
    expect(screen.queryByText(/%\s*YoY/i)).not.toBeInTheDocument();
    // Dense provenance labels stay off the collectible face; its footer carries
    // the source count and the first-look inspector owns source receipts.
    expect(screen.queryByText(/Source linked|Not confirmed|Human checked/i)).not.toBeInTheDocument();
    expect(screen.getByText(/sourced figures|research needed/i)).toBeInTheDocument();
  });

  it('fires onOpen when clicked', async () => {
    const onOpen = vi.fn();
    const { user } = renderWithProviders(
      <GameCard data={hydrate(companyCard.id)} onOpen={onOpen} />,
    );
    await user.click(screen.getByRole('button', { name: /^GraceWear Global — Company card$/ }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('does not treat the generic placeholder theme as a company brand', () => {
    const cwc = hydrate(companyCard.id);
    renderWithProviders(
      <GameCard
        data={{
          ...cwc,
          company: {
            ...cwc.company!,
            brandTheme: {
              primary: '#4f46e5',
              secondary: '#a5b4fc',
              accent: '#f59e0b',
              text: '#0f172a',
              background: '#ffffff',
              fontFamily: null,
              source: 'default',
            },
          },
        }}
      />,
    );
    expect(screen.getByTestId('collectible-card-front')).not.toHaveStyle('--card-accent: #4f46e5');
  });
  it('does not pass off a model-guessed palette as the company brand', () => {
    const cwc = hydrate(companyCard.id);
    renderWithProviders(
      <GameCard
        data={{
          ...cwc,
          company: {
            ...cwc.company!,
            brandTheme: { ...cwc.company!.brandTheme!, source: 'llm' },
          },
        }}
      />,
    );
    expect(screen.getByTestId('collectible-card-front')).not.toHaveStyle('--card-accent: #111827');
  });

  it('keeps save and share controls outside the card-opening button', async () => {
    const onOpen = vi.fn();
    const onShare = vi.fn();
    const { user } = renderWithProviders(
      <GameCard data={hydrate(companyCard.id)} onOpen={onOpen} onShare={onShare} />,
    );
    const inspect = screen.getByRole('button', { name: /^GraceWear Global — Company card$/ });
    expect(inspect.querySelector('button')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Share card' }));
    expect(onShare).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows a sourced-risk indicator on a Vice card', () => {
    renderWithProviders(<GameCard data={hydrate(viceCard.id)} />);
    expect(screen.getByText(/risk signal/i)).toBeInTheDocument();
  });

  it('renders a non-company Barrier card with its title, no metrics', () => {
    const cwc = hydrate(barrierCard.id);
    renderWithProviders(<GameCard data={cwc} />);
    expect(screen.getByText(cwc.card.title!)).toBeInTheDocument();
    expect(screen.queryByText('ARR')).not.toBeInTheDocument();
  });
});

describe('the status badge on a card', () => {
  it('rises with the card when the card is hovered: the badge carries the class the lift rule targets, and the rule matches the lift of the card itself', () => {
    const cwc = hydrate(companyCard.id);
    const pending = { ...cwc, card: { ...cwc.card, tier: null } };
    renderWithProviders(<GameCard data={pending} deckStatus="running" />);
    const badge = screen.getByTestId('card-researching');
    expect(badge.className).toContain('card-sleeve__badge');
    // jsdom does not run :hover or :has, so the stylesheet itself is checked: the badge moves the same distance at the same pace.
    const css = readFileSync(resolve(__dirname, 'collectible.css'), 'utf8');
    const lift = /\.card-sleeve__open:hover\s*\{[^}]*transform:\s*(translateY\([^)]*\))/.exec(css)?.[1];
    const badgeLift = /\.card-sleeve:has\(\.card-sleeve__open:hover\) \.card-sleeve__badge\s*\{[^}]*transform:\s*(translateY\([^)]*\))/.exec(css)?.[1];
    expect(lift).toBeTruthy();
    expect(badgeLift).toBe(lift);
    expect(/\.card-sleeve__open\s*\{[^}]*transform 180ms ease/.test(css)).toBe(true);
    expect(/\.card-sleeve__badge\s*\{[^}]*transform 180ms ease/.test(css)).toBe(true);
  });
});
