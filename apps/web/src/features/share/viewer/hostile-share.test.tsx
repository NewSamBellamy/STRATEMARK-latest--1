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

const NOW = '2026-10-19T10:00:00.000Z';
const newsItem = (i: number) => ({
  id: `i${i}`, source: 'news', title: `Story ${i}`, url: 'https://news.example/story', summary: 'A short summary.', detail: 'Some detail.', publishedDate: '2026-10-01',
  sentiment: 'positive', publishedAt: NOW, stale: false, publisher: 'Pub', imageUrl: null,
});
const person = (i: number) => ({ id: `n${i}`, name: `Person ${i}`, role: 'Engineer', group: 'exec', parentId: i === 0 ? null : `n${Math.floor((i - 1) / 3)}`, bio: 'Works on things.' });

describe('lists in a hosted share written to freeze the viewer', () => {
  it('opens a news feed of five thousand items showing the first hundred, at once', async () => {
    // Five thousand items were about ninety thousand page elements before.
    const { view, started } = await openTab(await deckSnapshot(), 'live_intel', { items: Array.from({ length: 5_000 }, (_unused, i) => newsItem(i)), lastRefreshedAt: NOW, cadence: 'weekly' });
    await waitFor(() => expect(view.container.textContent).toMatch(/Story 0/), { timeout: 30_000 });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(document.querySelectorAll('*').length).toBeLessThan(8_000);
    expect(view.container.textContent).not.toMatch(/Story 100/);
  }, 90_000);

  it('opens a team of twenty thousand people showing the first two hundred, at once', async () => {
    // Twenty thousand froze the tab for more than a minute before.
    const { view, started } = await openTab(await deckSnapshot(), 'team_org', { nodes: Array.from({ length: 20_000 }, (_unused, i) => person(i)) });
    await waitFor(() => expect(view.container.textContent).toMatch(/Person 0/), { timeout: 30_000 });
    expect(performance.now() - started).toBeLessThan(8_000);
    expect(document.querySelectorAll('*').length).toBeLessThan(30_000);
    expect(view.container.textContent).not.toMatch(/Person 200/);
  }, 90_000);

  it('opens a history of twenty thousand milestones and quotes showing the first of each, at once', async () => {
    const timeline = Array.from({ length: 20_000 }, (_unused, i) => ({ date: '2020', title: `Milestone ${i}`, detail: 'It happened.' }));
    const quotes = Array.from({ length: 20_000 }, (_unused, i) => ({ text: `Quote ${i}`, attribution: 'Someone' }));
    const { view, started } = await openTab(await deckSnapshot(), 'history', { founderStory: 'It began.', timeline, quotes });
    await waitFor(() => expect(view.container.textContent).toMatch(/Milestone 0/), { timeout: 30_000 });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(document.querySelectorAll('*').length).toBeLessThan(15_000);
    expect(view.container.textContent).not.toMatch(/Milestone 200/);
  }, 90_000);

  it('opens products, roadmap items and relationships by the thousand showing the first of each, at once', async () => {
    const products = Array.from({ length: 5_000 }, (_unused, i) => ({ name: `Product ${i}`, description: 'It does things.', revenueNote: 'Not disclosed', url: null, status: 'live' }));
    const roadmap = Array.from({ length: 5_000 }, (_unused, i) => ({ title: `Roadmap ${i}`, horizon: 'now', detail: 'Soon.', date: null }));
    const relationships = Array.from({ length: 5_000 }, (_unused, i) => ({ name: `Partner ${i}`, kind: 'partner', quote: 'They work together.', sourceUrl: null, sourceTitle: null }));
    const { view, started } = await openTab(await deckSnapshot(), 'products_roadmap', { products, roadmap, relationships });
    await waitFor(() => expect(view.container.textContent).toMatch(/Product 0/), { timeout: 30_000 });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(document.querySelectorAll('*').length).toBeLessThan(15_000);
    expect(view.container.textContent).not.toMatch(/Product 100/);
  }, 90_000);
});

describe('a hosted share does not start the living deck', () => {
  it('opens a deck without creating a background worker (the share page forbids workers, and nothing here researches)', async () => {
    const snapshot = await deckSnapshot();
    let workers = 0;
    class CountingWorker {
      onmessage: unknown = null;
      onerror: unknown = null;
      constructor() { workers += 1; }
      postMessage() { /* a ticker that never ticks */ }
      terminate() { /* nothing to stop */ }
    }
    const urls = URL as unknown as { createObjectURL?: unknown };
    const hadObjectUrl = 'createObjectURL' in urls;
    const savedWorker = (globalThis as { Worker?: unknown }).Worker;
    const savedObjectUrl = urls.createObjectURL;
    (globalThis as { Worker?: unknown }).Worker = CountingWorker;
    urls.createObjectURL = () => 'blob:stub';
    try {
      await openDeck(snapshot);
      // Give the desks the time the runtime needs to schedule its first turn, were it running.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(workers).toBe(0);
    } finally {
      (globalThis as { Worker?: unknown }).Worker = savedWorker;
      if (hadObjectUrl) urls.createObjectURL = savedObjectUrl;
      else delete urls.createObjectURL;
    }
  }, 30_000);
});
