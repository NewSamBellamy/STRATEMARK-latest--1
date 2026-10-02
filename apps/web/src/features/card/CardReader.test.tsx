import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { buildDataset } from '@mi/mocks';
import { renderWithProviders } from '@/test/test-utils';
import { CardReader } from './CardReader';

const data = buildDataset();

function hydrate(predicate: (c: (typeof data.cards)[number]) => boolean) {
  const card = data.cards.find(predicate)!;
  const company = card.companyId ? data.companies.find((c) => c.id === card.companyId)! : null;
  const metrics = card.companyId ? data.metrics.filter((m) => m.companyId === card.companyId) : [];
  const viceClaims = data.viceClaims.filter((v) => v.cardId === card.id);
  return { card, company, metrics, viceClaims };
}

describe('CardReader', () => {
  it('shows one concise overview, the four core figures, and a clear dashboard action', () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} />);
    const dialog = within(screen.getByRole('dialog'));
    const facts = dialog.getByRole('region', { name: 'Core company figures' });

    expect(dialog.queryByRole('tab')).not.toBeInTheDocument();
    expect(facts).toHaveTextContent('Employees');
    expect(facts).toHaveTextContent(/Revenue|ARR/);
    expect(facts).toHaveTextContent(/Users|Customers/);
    expect(facts).toHaveTextContent(/Valuation|Market cap/);
    expect(dialog.queryByText('Company Maturity Score')).not.toBeInTheDocument();
    expect(dialog.getByText(/No source receipt is attached to this summary/i)).toBeInTheDocument();
    expect(dialog.getByRole('link', { name: /open full company dashboard/i })).toBeInTheDocument();
  });

  it('keeps unsupported or unlinked figures unknown and exposes source publisher and capture date', () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    const base = cwc.metrics[0]!;
    const sourced = {
      ...cwc,
      metrics: [{
        ...base,
        metricType: 'employees' as const,
        value: 123,
        confidence: 'verified' as const,
        source: 'https://investor.example.com/report',
        citations: [{ title: 'Annual filing', url: 'https://investor.example.com/report', credibility: 'primary' as const }],
        methodNote: null,
        capturedAt: '2026-09-29T12:00:00.000Z',
      }, {
        ...base,
        id: 'unsupported-arr',
        metricType: 'arr' as const,
        value: 40_000_000_000,
        confidence: 'estimated' as const,
        source: null,
        citations: [],
      }, {
        ...base,
        id: 'unlinked-valuation',
        metricType: 'valuation' as const,
        value: 500_000_000_000,
        confidence: 'verified' as const,
        source: 'Company investor relations page',
        citations: [],
      }],
    };
    renderWithProviders(<CardReader data={sourced} open onOpenChange={() => {}} />);
    const dialog = within(screen.getByRole('dialog'));
    const facts = dialog.getByRole('region', { name: 'Core company figures' });

    expect(dialog.getByRole('link', { name: /source for employees: annual filing/i })).toHaveAttribute(
      'href', 'https://investor.example.com/report',
    );
    expect(facts).toHaveTextContent('Primary source');
    expect(facts).toHaveTextContent('Recorded Sep 29, 2026');
    expect(facts).not.toHaveTextContent('$40B');
    expect(facts).not.toHaveTextContent('$500B');
    expect(facts).toHaveTextContent('No source-backed figure');
  });

  it('keeps claims on vice cards attributed and visible without an Evidence tab', () => {
    const cwc = hydrate((c) => c.cardType === 'vice');
    renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} />);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByRole('tab')).not.toBeInTheDocument();
    expect(dialog.getByText(/not asserted as unverified fact/i)).toBeInTheDocument();
    const sources = dialog.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('http'));
    expect(sources.length).toBeGreaterThan(0);
  });

  it('keeps the card one-sided and preserves the selected card in its dashboard link', () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} marketId="market-test" />);
    expect(screen.getByTestId('collectible-card-front')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /flip card/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('collectible-card-back')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open full company dashboard/i })).toHaveAttribute(
      'href', `/company/${cwc.company!.id}/dashboard/overview?deck=market-test&card=${cwc.card.id}`,
    );
  });
});
