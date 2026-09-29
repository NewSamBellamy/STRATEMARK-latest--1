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
    expect(screen.getByText('ARR')).toBeInTheDocument();
    expect(screen.getByText(/Indicative · T/)).toBeInTheDocument();
    expect(screen.queryByText(/Very Strong|Very Weak/)).not.toBeInTheDocument();
    expect(screen.getByText(/0 sourced figures/)).toBeInTheDocument();
    // HQ shown.
    expect(screen.getByText(/Los Angeles/)).toBeInTheDocument();
  });

  it('never renders a fabricated YoY growth arrow (no-fabrication rule)', () => {
    // The card used to paint `fakeYoY` percentages invented from the metric's
    // own digits. Growth indicators are banned until real history exists.
    renderWithProviders(<GameCard data={hydrate(companyCard.id)} />);
    expect(screen.queryByText(/%\s*YoY/i)).not.toBeInTheDocument();
    // Confidence provenance chips render instead (Verified / Estimated).
    expect(
      screen.getAllByText(/Verified|Estimated|User verified/).length,
    ).toBeGreaterThan(0);
  });

  it('fires onOpen when clicked', async () => {
    const onOpen = vi.fn();
    const { user } = renderWithProviders(<GameCard data={hydrate(companyCard.id)} onOpen={onOpen} />);
    await user.click(screen.getByRole('button', { name: /GraceWear Global/ }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('does not treat the generic placeholder theme as a company brand', () => {
    const cwc = hydrate(companyCard.id);
    renderWithProviders(<GameCard data={{ ...cwc, company: {
      ...cwc.company!, brandTheme: {
        primary: '#4f46e5', secondary: '#a5b4fc', accent: '#f59e0b',
        text: '#0f172a', background: '#ffffff', fontFamily: null, source: 'default',
      },
    } }} />);
    expect(screen.getByTestId('collectible-card-front')).not.toHaveStyle('--card-accent: #4f46e5');
  });

  it('keeps save and share controls outside the card-opening button', async () => {
    const onOpen = vi.fn();
    const onShare = vi.fn();
    const { user } = renderWithProviders(<GameCard data={hydrate(companyCard.id)} onOpen={onOpen} onShare={onShare} />);
    const inspect = screen.getByRole('button', { name: /GraceWear Global/ });
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
