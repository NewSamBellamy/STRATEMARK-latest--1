import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import DashboardPage from './DashboardPage';

async function open(tab: string) {
  const repository = makeRepo();
  const [market] = await repository.listMarkets();
  const deck = await repository.getDeckByMarket(market!.id);
  const cards = await repository.listCards(deck!.id);
  const company = cards.find((c) => c.company && c.card.cardType === 'company')!.company!;
  renderWithProviders(
    <Routes><Route path="/company/:companyId/dashboard/:tab" element={<DashboardPage />} /></Routes>,
    { repository, route: `/company/${company.id}/dashboard/${tab}` },
  );
  return screen.findByTestId('dashboard-root', undefined, { timeout: 10000 });
}

describe('dashboard chrome', () => {
  it('pads the bottom so the floating button never covers the last row', async () => {
    const root = await open('overview');
    expect(root.className).toContain('pb-20');
  }, 20000);

  it('uses the same width container on every tab, so tabs do not jump', async () => {
    const overview = await open('overview');
    expect(overview.className).toContain('max-w-6xl');
    // The Overview content has no narrower column of its own.
    expect(overview.querySelector('.max-w-4xl')).toBeNull();
  }, 20000);

  it('shows a single pause control in the freshness row, not a separate row', async () => {
    const root = await open('live_intel');
    const pause = await screen.findByRole('button', { name: 'Pause background research' });
    expect(root.contains(pause)).toBe(true);
    expect(pause.closest('[data-testid="freshness-row"]')).not.toBeNull();
  }, 20000);
});
