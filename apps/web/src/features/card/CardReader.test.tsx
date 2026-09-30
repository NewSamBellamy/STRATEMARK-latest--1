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
  it('opens as a concise one-page company summary with sources and deeper research', () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    const withSource = {
      ...cwc,
      metrics: cwc.metrics.map((metric, index) =>
        index === 0
          ? {
              ...metric,
              citations: [
                {
                  title: 'Company filing',
                  url: 'https://investor.example.com/filing',
                  credibility: 'primary' as const,
                },
              ],
            }
          : metric,
      ),
    };
    renderWithProviders(<CardReader data={withSource} open onOpenChange={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Company snapshot')).toBeInTheDocument();
    expect(within(dialog).queryByRole('tab')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /ask researcher/i })).toBeInTheDocument();
    expect(within(dialog).getByText(/figures recorded/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/^Sources ·/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole('region', { name: 'Company summary and sources' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /explore research/i })).toBeInTheDocument();
  });

  it('shows sourced vice claims in the one-page risk summary', () => {
    const cwc = hydrate((c) => c.cardType === 'vice');
    renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/risk & controversy/i)).toBeInTheDocument();
    // Every claim renders a Source link.
    // The link now NAMES the publisher (or admits "Publisher not recorded")
    // instead of a generic "Source" label — the provenance rule for vice claims.
    const sources = within(dialog)
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.startsWith('http'));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0]).toHaveAttribute('href');
    expect(within(dialog).queryByText('Evidence needed')).not.toBeInTheDocument();
  });

  it('opens a company-linked risk card as a finding, not a company dashboard', () => {
    const cwc = hydrate((c) => c.cardType === 'vice' && c.companyId !== null);
    renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('button', { name: /discuss this finding/i }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('link', { name: /explore research/i }),
    ).not.toBeInTheDocument();
  });

  it('names the next action for a market insight instead of using a generic finding CTA', () => {
    const cwc = hydrate((c) => c.cardType === 'insight');
    renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} />);

    expect(screen.getByRole('button', { name: /explore this trend/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /discuss this finding/i })).not.toBeInTheDocument();
  });

  it('shows AI-attributed sources and periods, not legacy unlinked notes', () => {
    const cwc = hydrate((c) => c.cardType === 'insight');
    const sourcedFinding = {
      ...cwc,
      company: null,
      card: {
        ...cwc.card,
        companyId: null,
        title: 'Inference pricing shift',
        keyPoints: ['Legacy detail without claim-level provenance.'],
        evidencePoints: [
          {
            text: 'Hosted inference prices fell during the second quarter.',
            timeWindow: 'Q2 2026',
            citations: [{ title: 'provider.example', url: 'https://provider.example/pricing' }],
          },
          {
            text: 'A second finding has no reported period.',
            timeWindow: null,
            citations: [{ title: 'research.example', url: 'https://research.example/report' }],
          },
        ],
      },
    } as typeof cwc;

    renderWithProviders(<CardReader data={sourcedFinding} open onOpenChange={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getAllByText('Hosted inference prices fell during the second quarter.'),
    ).toHaveLength(2); // collectible face + expanded details
    expect(within(dialog).getByText(/AI-reported period · Q2 2026/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /AI-attributed from research notes; they have not been independently verified/i,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Period not stated')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /provider\.example/i })).toHaveAttribute(
      'href',
      'https://provider.example/pricing',
    );
    expect(
      within(dialog).queryByText('Legacy detail without claim-level provenance.'),
    ).not.toBeInTheDocument();
  });

  it('keeps evidence details in the company research view', () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_grace-threads');
    renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} />);
    expect(screen.getByRole('link', { name: /explore research/i })).toBeInTheDocument();
    expect(screen.queryByText(/how we got this/i)).not.toBeInTheDocument();
  });

  it('keeps an unranked company inspectable without pretending it has figures', () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    renderWithProviders(
      <CardReader
        data={{ ...cwc, metrics: [], card: { ...cwc.card, tier: null } }}
        open
        onOpenChange={() => {}}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/stage unavailable: no usable figures/i)).toBeInTheDocument();
  });

  it('keeps the card one-sided and preserves the selected card in the dashboard link', () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    renderWithProviders(
      <CardReader data={cwc} open onOpenChange={() => {}} marketId="market-test" />,
    );
    expect(screen.getByTestId('collectible-card-front')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /flip card/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('collectible-card-back')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /explore research/i })).toHaveAttribute(
      'href',
      `/company/${cwc.company!.id}/dashboard/overview?deck=market-test&card=${cwc.card.id}`,
    );
  });
});
