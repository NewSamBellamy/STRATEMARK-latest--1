/**
 * What a visitor sees when a hosted share was made by someone hostile: the whole page, from a snapshot through
 * `receiveSnapshot` and the real deck and dashboard screens. (`lib/share/receive.test.ts` holds the same rules
 * as unit tests; these prove they hold on screen.)
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ShareSnapshot } from '@mi/contracts';
import { MockRepository } from '@mi/mocks';
import { receiveSnapshot } from '@/lib/share/receive';
import { ShareApp } from './ShareApp';

async function deckSnapshot(): Promise<ShareSnapshot> {
  const repo = new MockRepository({ latencyMs: 0 });
  const [market] = await repo.listMarkets();
  const deck = await repo.getDeckByMarket(market!.id);
  return repo.exportShareSnapshot({ deckId: deck!.id });
}

// The screens load on demand; load them first so a timing below measures the page, not the first import.
beforeAll(async () => {
  await Promise.all([import('@/features/dashboard/DashboardPage'), import('@/features/deck/DeckPage')]);
}, 60_000);
beforeEach(() => { window.location.hash = ''; });
afterEach(() => { cleanup(); window.location.hash = ''; });

async function openDeck(snapshot: ShareSnapshot) {
  window.location.hash = `#/markets/${snapshot.markets[0]!.id}/deck`;
  render(<ShareApp snapshot={receiveSnapshot(snapshot)} />);
  await waitFor(() => expect(screen.getByTestId('card-grid')).toBeInTheDocument(), { timeout: 8000 });
}

describe('a forged ownership status in a hosted share', () => {
  const FORGED = {
    status: 'acquired', acquirer: 'Forged Holdings', announcedOn: '2026', closedOn: '2026-01-01',
    price: { value: 5_000_000_000, currency: 'USD' }, citations: [], confidence: 'user_verified', methodNote: 'Checked by a person.',
  };

  it('is not shown on the deck as "Acquired by"', async () => {
    const snapshot = await deckSnapshot();
    const forged = { ...snapshot, companies: snapshot.companies.map((c, i) => (i === 0 ? { ...c, ownership: FORGED } : c)) } as unknown as ShareSnapshot;
    await openDeck(forged);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(document.body.textContent).not.toMatch(/Forged Holdings/);
  });

  it('is shown when a source states it (the control: the page can show an acquisition at all)', async () => {
    const snapshot = await deckSnapshot();
    const sourced = { ...FORGED, confidence: 'verified', citations: [{ title: 'Reuters', url: 'https://www.reuters.com/markets/forged-holdings-deal' }] };
    const real = { ...snapshot, companies: snapshot.companies.map((c, i) => (i === 0 ? { ...c, ownership: sourced } : c)) } as unknown as ShareSnapshot;
    await openDeck(real);
    await waitFor(() => expect(document.body.textContent).toMatch(/Acquired by Forged Holdings/));
  });
});

/** The dashboard tab `tab` of the first company, opened from a snapshot whose content for that tab is `content`. */
async function openTab(snapshot: ShareSnapshot, tab: string, content: unknown) {
  const companyId = snapshot.companies[0]!.id;
  const hostile = {
    ...snapshot,
    dashboards: { ...snapshot.dashboards, [companyId]: { ...snapshot.dashboards[companyId], [tab]: { content, lastRefreshedAt: '2026-10-19T10:00:00.000Z' } } },
  } as unknown as ShareSnapshot;
  window.location.hash = `#/company/${companyId}/dashboard/${tab}`;
  const started = performance.now();
  const view = render(<ShareApp snapshot={receiveSnapshot(hostile)} />);
  return { view, started };
}

describe('markdown in a hosted share written to freeze the viewer', () => {
  it('opens an overview of unmatched emphasis at once, as plain text', async () => {
    // 40,000 characters took more than seven seconds to render before; the review's 160,000 never finished.
    const { view, started } = await openTab(await deckSnapshot(), 'overview', { markdown: '*a'.repeat(20_000) });
    await waitFor(() => expect(view.container.querySelectorAll('p.whitespace-pre-line').length).toBeGreaterThan(0), { timeout: 20_000 });
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(view.container.querySelector('main em')).toBeNull();
  }, 60_000);

  it('opens a history story nested past what the parser can hold, with the rest of the tab intact', async () => {
    const story = `${'> '.repeat(900)}x`;
    const { view } = await openTab(await deckSnapshot(), 'history', { founderStory: story, timeline: [{ date: '2020', title: 'Founded', detail: 'It began.' }], quotes: [] });
    await waitFor(() => expect(view.container.querySelectorAll('p.whitespace-pre-line').length).toBeGreaterThan(0), { timeout: 20_000 });
    expect(view.container.textContent).toMatch(/Founded/);
  }, 60_000);
});
