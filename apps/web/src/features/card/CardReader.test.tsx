import { describe, expect, it, vi } from 'vitest';
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
  it('opens the dashboard without also issuing a deck-close URL change', async () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    const onOpenChange = vi.fn();
    const { user } = renderWithProviders(<CardReader data={cwc} open onOpenChange={onOpenChange} marketId="mkt_apparel" />);
    const link = screen.getByRole('link', { name: /open full company dashboard/i });
    expect(link).toHaveAttribute('href', expect.stringContaining(`/company/${cwc.company!.id}/dashboard/overview?`));
    await user.click(link);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
  it('shows one concise overview, the four core figures, and a clear dashboard action', () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} />);
    const dialog = within(screen.getByRole('dialog'));
    const facts = dialog.getByRole('region', { name: 'Core company figures' });

    expect(dialog.queryByRole('tab')).not.toBeInTheDocument();
    expect(facts).toHaveTextContent('Employees');
    expect(facts).toHaveTextContent(/Revenue|ARR/);
    expect(facts).toHaveTextContent(/Users|Customers|Installs|Downloads|Followers|GitHub stars/);
    expect(facts).toHaveTextContent(/Valuation|Market cap/);
    expect(dialog.queryByText('Company Maturity Score')).not.toBeInTheDocument();
    expect(dialog.getByText(/No source receipt is attached to this summary/i)).toBeInTheDocument();
    expect(dialog.getByRole('link', { name: /open full company dashboard/i })).toBeInTheDocument();
  });

  it('does not call an explicit awaiting-verification state an unsourced summary', () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    renderWithProviders(<CardReader data={{
      ...cwc,
      card: { ...cwc.card, summary: 'No source-backed company snapshot is ready yet.', citations: [] },
      company: { ...cwc.company!, oneLiner: 'No source-backed company snapshot is ready yet.' },
    }} open onOpenChange={() => {}} />);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getAllByText('No source-backed company snapshot is ready yet.')).toHaveLength(2);
    expect(dialog.queryByText(/No source receipt is attached to this summary/i)).not.toBeInTheDocument();
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
        // Recognized publisher fixture, not an independently fetched filing.
        source: 'https://sec.gov/Archives/report',
        citations: [{ title: 'Annual filing', url: 'https://sec.gov/Archives/report', credibility: 'primary' as const }],
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
      'href', 'https://sec.gov/Archives/report',
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
    expect(dialog.getByRole('button', { name: /ask about this finding/i })).toBeInTheDocument();
    expect(dialog.queryByRole('link', { name: /open full company dashboard/i })).not.toBeInTheDocument();
    expect(dialog.queryByRole('region', { name: 'Core company figures' })).not.toBeInTheDocument();
    const sources = dialog.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('http'));
    expect(sources.length).toBeGreaterThan(0);
  });

  it('opens culture cards as signal research, not as a company dashboard', () => {
    const cwc = hydrate((c) => c.cardType === 'culture');
    renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} />);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('region', { name: 'Research summary' })).toBeInTheDocument();
    expect(dialog.queryByRole('region', { name: 'Core company figures' })).not.toBeInTheDocument();
    expect(dialog.getByRole('button', { name: /ask about this finding/i })).toBeInTheDocument();
    expect(dialog.queryByRole('link', { name: /open full company dashboard/i })).not.toBeInTheDocument();
  });

  it('expands a signal into a sourced, printable report without inventing new claims', async () => {
    const cwc = hydrate((c) => c.cardType === 'insight');
    const { user } = renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} />);
    const dialog = within(screen.getByRole('dialog'));

    await user.click(dialog.getByRole('button', { name: /read full finding/i }));

    expect(dialog.getByRole('region', { name: /full research finding/i })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: /save as pdf/i })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: /share report/i })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: /ask ai about this finding/i })).toBeInTheDocument();
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
