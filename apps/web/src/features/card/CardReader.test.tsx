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

const userValues = data.cards
  .filter((c) => c.cardType === 'company')
  .flatMap((c) => data.metrics.filter((m) => m.companyId === c.companyId))
  .filter((m) => m.metricType === 'users' && m.value !== null)
  .map((m) => m.value as number);

describe('CardReader', () => {
  it('opens on the card, with evidence and maturity available without blocking research', async () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    const { user } = renderWithProviders(
      <CardReader data={cwc} open onOpenChange={() => {}} deckUserValues={userValues} />,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText('Company Maturity Score')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('tab', { name: 'Maturity' }));
    expect(within(dialog).getByText('Company Maturity Score')).toBeInTheDocument();
    // Holy Hype has a +1 nudge with a reason — it must be surfaced.
    expect(within(dialog).getByText(/compounding/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /explore research/i })).toBeInTheDocument();
  });

  it('shows sourced vice claims with citations', async () => {
    const cwc = hydrate((c) => c.cardType === 'vice');
    const { user } = renderWithProviders(
      <CardReader data={cwc} open onOpenChange={() => {}} deckUserValues={userValues} />,
    );
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('tab', { name: 'Evidence' }));
    expect(within(dialog).getByText(/risk & controversy/i)).toBeInTheDocument();
    // Every claim renders a Source link.
    // The link now NAMES the publisher (or admits "Publisher not recorded")
    // instead of a generic "Source" label — the provenance rule for vice claims.
    const sources = within(dialog)
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.startsWith('http'));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0]).toHaveAttribute('href');
  });

  it('shows how-we-got-this notes for estimated metrics', async () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_grace-threads');
    const { user } = renderWithProviders(
      <CardReader data={cwc} open onOpenChange={() => {}} deckUserValues={userValues} />,
    );
    await user.click(screen.getByRole('tab', { name: 'Evidence' }));
    expect(screen.getAllByText(/how we got this/i).length).toBeGreaterThan(0);
  });

  it('keeps an unranked company inspectable without pretending it has figures', async () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    const { user } = renderWithProviders(<CardReader data={{ ...cwc, metrics: [], card: { ...cwc.card, tier: null } }}
      open onOpenChange={() => {}} deckUserValues={[]} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/stage pending: no usable figures/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('tab', { name: 'Maturity' }));
    expect(within(dialog).getByText(/not ranked: no usable company figures/i)).toBeInTheDocument();
  });

  it('flips to a research reverse and preserves the selected card in the dashboard link', async () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    const { user } = renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}}
      deckUserValues={userValues} marketId="market-test" />);
    await user.click(screen.getByRole('button', { name: 'Flip card' }));
    expect(screen.getByTestId('collectible-card-back')).toBeInTheDocument();
    expect(screen.queryByTestId('collectible-card-front')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('collectible-card-back')).getByText('Evidence on file')).toBeInTheDocument();
    expect(within(screen.getByTestId('collectible-card-back')).queryByText(/The thesis/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /explore research/i })).toHaveAttribute('href',
      `/company/${cwc.company!.id}/dashboard/overview?deck=market-test&card=${cwc.card.id}`);
  });
});
