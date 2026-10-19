import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { Company, Ownership } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import DashboardPage from './DashboardPage';

// The dashboard header's ownership chip links to the deal's source. Its label
// can stand on a human check alone, so the stored citation behind it is not
// guaranteed to be a web address.
async function openWith(ownership: Ownership) {
  const repository = makeRepo();
  const [market] = await repository.listMarkets();
  const deck = await repository.getDeckByMarket(market!.id);
  const cards = await repository.listCards(deck!.id);
  const company = cards.find((c) => c.company && c.card.cardType === 'company')!.company as Company;
  vi.spyOn(repository, 'getCompany').mockResolvedValue({ ...company, ownership });
  const { unmount } = renderWithProviders(
    <Routes><Route path="/company/:companyId/dashboard/:tab" element={<DashboardPage />} /></Routes>,
    { repository, route: `/company/${company.id}/dashboard/overview` },
  );
  const chip = await screen.findByTestId('ownership-label', undefined, { timeout: 10000 });
  return { chip, unmount };
}

const base = { status: 'acquired' as const, acquirer: 'Alphabet', announcedOn: '2025-03-17', closedOn: '2025-05-27', price: null };

describe('dashboard ownership chip', () => {
  it('does not link a source that is not a web address', async () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
      const { chip, unmount } = await openWith({ ...base, confidence: 'user_verified', citations: [{ url, title: 'Deal source' }] });
      expect(chip).toHaveTextContent('Acquired by Alphabet');
      expect(chip.tagName).toBe('SPAN');
      expect(chip).not.toHaveAttribute('href');
      unmount();
    }
  }, 40000);

  it('links the first source that is a web address, not a hostile one stored before it', async () => {
    const { chip } = await openWith({
      ...base, confidence: 'verified',
      citations: [{ url: 'javascript:alert(1)', title: 'Bad' }, { url: 'https://www.sec.gov/deal', title: 'SEC' }],
    });
    expect(chip.tagName).toBe('A');
    expect(chip).toHaveAttribute('href', 'https://www.sec.gov/deal');
  }, 20000);
});
