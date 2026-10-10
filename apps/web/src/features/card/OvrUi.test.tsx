import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { buildDataset } from '@mi/mocks';
import type { CardWithCompany, CompanyMetric } from '@mi/contracts';
import { renderWithProviders } from '@/test/test-utils';
import { GameCard } from './GameCard';
import { CmsBreakdown } from './CmsBreakdown';
import { rateCardAlone } from './rating';

const dataset = buildDataset();
const card = dataset.cards.find((c) => c.cardType === 'company' && c.companyId)!;
const company = dataset.companies.find((c) => c.id === card.companyId)!;
const seed = dataset.metrics.find((m) => m.companyId === company.id)!;
const sourced = (patch: Partial<CompanyMetric>): CompanyMetric => ({ ...seed, value: 500, metricType: 'employees',
  confidence: 'verified', source: null,
  citations: [{ title: 'Annual report', url: 'https://sec.gov/Archives/report', credibility: 'primary' }], ...patch });
const rated: CardWithCompany = { card: { ...card, tier: 7 }, company, metrics: [sourced({})], viceClaims: [] };
const unsourced: CardWithCompany = { card: { ...card, tier: 7 }, company, viceClaims: [],
  metrics: [sourced({ confidence: 'estimated', citations: [] })] };

describe('OVR on the card face', () => {
  it('shows the rating as a trading-card plaque on the art, keeping the footer stage label', () => {
    const rating = rateCardAlone(rated)!;
    renderWithProviders(<GameCard data={rated} />);
    const el = screen.getByTestId('card-ovr');
    expect(el).toHaveTextContent(new RegExp(`^${rating.overall}OVR$`));
    expect(el.className).toMatch(/collectible__ovr--(icon|gold|silver|bronze)/);
    expect(el.getAttribute('title')).toMatch(/Overall rating \d+\/99/);
  });
  it('withholds OVR when no figure is sourced, like the tier', () => {
    renderWithProviders(<GameCard data={unsourced} />);
    expect(screen.queryByTestId('card-ovr')).not.toBeInTheDocument();
    expect(screen.getByText('Stage pending')).toBeInTheDocument();
  });
});

describe('OVR breakdown', () => {
  it('explains how OVR is calculated next to the tier derivation', () => {
    renderWithProviders(<CmsBreakdown card={rated.card} metrics={rated.metrics} deckUserValues={[]} rating={rateCardAlone(rated)} />);
    expect(screen.getByTestId('ovr-breakdown')).toBeInTheDocument();
    expect(screen.getByText(/How OVR is calculated/)).toBeInTheDocument();
    expect(screen.getByText('Maturity tier')).toBeInTheDocument();
    expect(screen.getByText('Company Maturity Score')).toBeInTheDocument();
  });
  it('says plainly when nothing could be rated', () => {
    renderWithProviders(<CmsBreakdown card={unsourced.card} metrics={unsourced.metrics} deckUserValues={[]} rating={null} />);
    expect(screen.getByText('Not rated')).toBeInTheDocument();
  });
});
