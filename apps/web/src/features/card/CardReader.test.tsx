import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
  it('browses to the previous and next card with the arrow keys', async () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    const [onPrevious, onNext] = [vi.fn(), vi.fn()];
    const { user } = renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} onPrevious={onPrevious} onNext={onNext} />);
    await user.keyboard('{ArrowRight}');
    expect(onNext).toHaveBeenCalledTimes(1);
    await user.keyboard('{ArrowLeft}');
    expect(onPrevious).toHaveBeenCalledTimes(1);
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(onNext).toHaveBeenCalledTimes(1);
  });
  it('offers Next lane instead of a dead Next at the last card of a lane', async () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    const onNextLane = vi.fn();
    const { user } = renderWithProviders(
      <CardReader data={cwc} open onOpenChange={() => {}} onPrevious={() => {}} onNextLane={onNextLane} />,
    );
    expect(screen.queryByRole('button', { name: 'Next card' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next lane' }));
    expect(onNextLane).toHaveBeenCalledTimes(1);
  });
  it('keeps the plain Next card button while the lane has more cards', () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} onNext={() => {}} onNextLane={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Next lane' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next card' })).toBeEnabled();
  });
  it('keeps the figure coverage and source count in the reader, now that the face shows the update date', () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} />);
    expect(screen.getByTestId('card-reader-provenance')).toHaveTextContent(/\d\/4 figures sourced · (\d+ sources? tracked|Research needed)/);
  });
  it('shows one concise overview, the four core figures, and a clear dashboard action', () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} />);
    const dialog = within(screen.getByRole('dialog'));
    const facts = dialog.getByRole('region', { name: 'Company summary' });

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
    const facts = dialog.getByRole('region', { name: 'Company summary' });

    expect(dialog.getByRole('link', { name: /source for employees: annual filing/i })).toHaveAttribute(
      'href', 'https://sec.gov/Archives/report',
    );
    expect(facts).toHaveTextContent('from a primary source');
    expect(facts).toHaveTextContent('recorded 29 Sep 2026');
    expect(facts).not.toHaveTextContent('$40B');
    expect(facts).not.toHaveTextContent('$500B');
    expect(facts).toHaveTextContent('No sourced figure was found yet for');
  });

  it('shows a provider-attributed figure without calling it original-verified', () => {
    const cwc = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    const companyName = cwc.company!.name;
    const url = 'https://sec.gov/Archives/report';
    renderWithProviders(<CardReader data={{ ...cwc, metrics: [{ ...cwc.metrics[0]!,
      metricType: 'employees', value: 123, confidence: 'estimated', source: url,
      citations: [{ title: 'Annual filing', url }], passageSupport: null,
      capturedAt: '2026-10-06T00:00:00.000Z',
      reportedSupport: { provider: 'google-search', companyName, basis: 'employees',
        definition: 'employees', value: 123, unit: 'count', asOf: '2026-10-01',
        support: { supportIndex: 0, text: `${companyName} reported 123 employees as of October 1, 2026.`,
          sources: [{ chunkIndex: 0, url, title: 'Annual filing' }] } },
    }] }} open onOpenChange={() => {}} />);
    const facts = within(screen.getByRole('dialog')).getByRole('region', { name: 'Company summary' });
    expect(facts).toHaveTextContent('123');
    expect(facts).toHaveTextContent('source-reported and not independently verified');
    expect(facts).toHaveTextContent('dated 1 Oct 2026');
    expect(facts).not.toHaveTextContent('checked by a person');
  });

  it('keeps claims on vice cards attributed and visible without an Evidence tab', () => {
    const cwc = hydrate((c) => c.cardType === 'vice');
    renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} />);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByRole('tab')).not.toBeInTheDocument();
    expect(dialog.getByText(/quoted from its source/i)).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: /ask about this finding/i })).toBeInTheDocument();
    expect(dialog.queryByRole('link', { name: /open full company dashboard/i })).not.toBeInTheDocument();
    expect(dialog.queryByRole('region', { name: 'Company summary' })).not.toBeInTheDocument();
    const sources = dialog.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('http'));
    expect(sources.length).toBeGreaterThan(0);
  });

  it('opens culture cards as signal research, not as a company dashboard', () => {
    const cwc = hydrate((c) => c.cardType === 'culture');
    renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} />);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('region', { name: 'Research finding' })).toBeInTheDocument();
    expect(dialog.queryByRole('region', { name: 'Company summary' })).not.toBeInTheDocument();
    expect(dialog.getByRole('button', { name: /ask about this finding/i })).toBeInTheDocument();
    expect(dialog.queryByRole('link', { name: /open full company dashboard/i })).not.toBeInTheDocument();
  });

  it('reads a signal as a paragraph and a plain list with its sources: no box, no extra step, nothing clamped', async () => {
    const base = hydrate((c) => c.cardType === 'insight');
    const points = Array.from({ length: 7 }, (_, i) => `Point ${i + 1}: the evidence behind the finding, in one full sentence that is never cut off.`);
    const cwc = { ...base, card: { ...base.card, summary: 'Operators are shifting from cook-at-home kits to heat-and-eat meals as buyers pay for convenience.', keyPoints: points,
      citations: [{ title: 'reuters.com', url: 'https://www.reuters.com/a' }, { title: 'ft.com', url: 'https://www.ft.com/b' }] } };
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} />);
    const dialog = within(screen.getByRole('dialog'));

    const finding = dialog.getByRole('region', { name: 'Research finding' });
    expect(within(finding).getByText(/shifting from cook-at-home kits/)).toBeInTheDocument();
    // Every point shows in full, as a list item, however many there are (up to ten).
    expect(within(finding).getAllByRole('listitem')).toHaveLength(7);
    for (const point of points) expect(within(finding).getByText(point)).toBeInTheDocument();
    expect(within(finding).getByRole('link', { name: /reuters\.com/ })).toHaveAttribute('href', 'https://www.reuters.com/a');
    // There is no second "full finding" step any more, and the card stays on screen.
    expect(dialog.queryByRole('button', { name: /read full finding/i })).not.toBeInTheDocument();
    expect(dialog.getByTestId('collectible-card-front')).toBeInTheDocument();
    // The finding can still be saved as a PDF and shared from the same place.
    await user.click(dialog.getByRole('button', { name: /save as pdf/i }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(dialog.getByRole('button', { name: 'Share card' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: /ask about this finding/i })).toBeInTheDocument();
    print.mockRestore();
  });

  it('says plainly when a signal card has no detail yet, instead of an empty box', () => {
    const base = hydrate((c) => c.cardType === 'culture');
    const cwc = { ...base, card: { ...base.card, summary: null, keyPoints: [], citations: [] }, viceClaims: [] };
    renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} />);
    const finding = within(screen.getByRole('dialog')).getByRole('region', { name: 'Research finding' });
    expect(finding).toHaveTextContent('The research recorded no further detail for this card.');
    expect(finding).toHaveTextContent('No clickable source has been saved for this finding yet.');
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

  describe('focus on close', () => {
    const first = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    const second = hydrate((c) => c.cardType === 'culture');

    /** Mirrors the deck grid: the reader is driven by state, not a Radix trigger. */
    function Harness({ withReturnTarget = false }: { withReturnTarget?: boolean }) {
      const [active, setActive] = useState<typeof first | null>(null);
      return <>
        <button type="button" data-testid="first-card" onClick={() => setActive(first)}>first card</button>
        <button type="button" data-testid="second-card" onClick={() => setActive(second)}>second card</button>
        <CardReader data={active} open={active !== null} onOpenChange={(o) => { if (!o) setActive(null); }}
          onNext={active === first ? () => setActive(second) : undefined}
          returnFocusTo={withReturnTarget
            ? (cardId) => screen.getByTestId(cardId === second.card.id ? 'second-card' : 'first-card')
            : undefined} />
      </>;
    }

    it('returns focus to the card that opened the reader when Escape closes it', async () => {
      const { user } = renderWithProviders(<Harness />);
      await user.click(screen.getByTestId('first-card'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.getByTestId('first-card')).toHaveFocus());
    });

    it('returns focus to the card last shown after Next browsing, via the Close button', async () => {
      const { user } = renderWithProviders(<Harness withReturnTarget />);
      await user.click(screen.getByTestId('first-card'));
      await user.click(screen.getByRole('button', { name: 'Next card' }));
      // Browsing keeps focus inside the reader rather than behind it.
      await waitFor(() => expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement));
      await user.click(screen.getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.getByTestId('second-card')).toHaveFocus());
    });
  });
});
