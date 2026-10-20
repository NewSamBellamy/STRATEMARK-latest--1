import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { screen, within } from '@testing-library/react';
import { GeminiRepository, ImportRefusedError, MAX_IMPORT_CHARS } from '@mi/research';
import { Sidebar, SIDEBAR_DECKS } from '@/components/layout/Sidebar';
import { renderWithProviders } from '@/test/test-utils';
import { installBrowserResearch, openBrowserResearchStore, planResearchImport, readBrowserResearchData } from './browserResearchStore';
import { CRASHED, counters, market, openApp, real, unavailable, workspace, type ResearchFile } from './importTestKit';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

type Case = { name: string; change: (file: ResearchFile) => void; route: (file: ResearchFile) => string };
const marketId = (f: ResearchFile) => f.markets[0]!.id;
const companyId = (f: ResearchFile) => f.companies[0]!.id;
const tab = (content: unknown) => ({ content, lastRefreshedAt: '2026-01-01T00:00:00Z' });
const tabCase = (name: string, tabName: string, value: unknown): Case => ({
  name,
  change: (f) => { f.dashboards[companyId(f)] = { [tabName]: value }; },
  route: (f) => `/company/${companyId(f)}/dashboard/${tabName}`,
});

// Each is a file the second review found that imported cleanly and then crashed the page that draws it.
const cases: Case[] = [
  { name: 'a report whose sources are null', change: (f) => { f.reports = [{ id: 'r1', kind: 'deck', subjectId: 'd', title: 'T', markdown: 'm', citations: null, createdAt: '2026-01-01T00:00:00Z' }]; }, route: () => '/reports' },
  tabCase('History saved as a list', 'history', [1, 2]),
  tabCase('History saved as text', 'history', 'x'),
  tabCase('History with no content', 'history', tab(null)),
  tabCase('Live Intel saved as a number', 'live_intel', 5),
  tabCase('Live Intel with list content', 'live_intel', tab([])),
  tabCase('Mission & Governance saved as text', 'mission_governance', 'x'),
  tabCase('Mission & Governance with no content', 'mission_governance', tab(null)),
  { name: 'a market analysis that is text', change: (f) => { f.opportunity = { [marketId(f)]: 'text' }; }, route: (f) => `/markets/${marketId(f)}/opportunity` },
  { name: 'a market analysis that is a list', change: (f) => { f.opportunity = { [marketId(f)]: [] }; }, route: (f) => `/markets/${marketId(f)}/opportunity` },
  { name: 'a deck with the id toString', change: (f) => { f.decks[0]!.id = 'toString'; for (const c of f.cards as { deckId: string }[]) c.deckId = 'toString'; }, route: (f) => `/markets/${marketId(f)}/deck` },
  { name: 'a market with the id constructor', change: (f) => { f.markets[0]!.id = 'constructor'; (f.decks[0] as unknown as { marketId: string }).marketId = 'constructor'; }, route: () => '/markets/constructor/opportunity' },
  { name: 'a followed company that is an object', change: (f) => { f.follows = [{ companyId: { a: 1 }, followedAt: '2026-01-01T00:00:00Z' }]; }, route: () => '/today' },
  { name: 'a news item whose title is an object', change: (f) => {
    f.follows = [{ companyId: companyId(f), followedAt: '2026-01-01T00:00:00Z' }];
    f.moves = [{ id: 'mv', companyId: companyId(f), kind: 'funding', title: { a: 1 }, url: 'https://example.com/x', publishedAt: '2026-01-01T00:00:00Z', foundAt: '2026-01-01T00:00:00Z', source: 'news', readAt: null }];
  }, route: () => '/today' },
];

describe('an imported file cannot make a page crash', () => {
  it.each(cases)('$name', async ({ change, route }) => {
    const file = real();
    change(file);
    await installBrowserResearch(JSON.stringify(file));
    const app = await openApp(counters(), { route: route(file) });
    expect(app.text()).not.toMatch(CRASHED);
    app.unmount();
    // A page's code is fetched and compiled the first time a test asks for it, which can take seconds.
  }, 30_000);
});

describe('an imported file cannot freeze the app by size or number of rows', () => {
  it('refuses a file of many small decks with a plain message and changes nothing', async () => {
    const store = await openBrowserResearchStore();
    await store.write(workspace(market('m_mine', 'Mine')));
    const before = await readBrowserResearchData();
    const hostile = real();
    hostile.markets = Array.from({ length: 501 }, (_, n) => market(`m${n}`, `Market ${n}`));
    await expect(installBrowserResearch(JSON.stringify(hostile))).rejects.toThrow('This file holds 501 decks, more than the 500 an import can bring in. It is probably not a Stratemark export.');
    expect(await readBrowserResearchData()).toEqual(before);
  });

  it('refuses a file larger than any real workspace before reading its rows', () => {
    // A string cannot be 150 MB inside a test, so a stand-in with that length: it must be refused on its size alone.
    const tooLarge = { length: MAX_IMPORT_CHARS + 1 } as unknown as string;
    expect(() => planResearchImport(tooLarge)).toThrow(ImportRefusedError);
    expect(() => planResearchImport(tooLarge)).toThrow(/larger than the 150 MB an import can bring in/);
  });

  it('draws at most 50 decks in the sidebar and leaves the rest under View all', async () => {
    const markets = Array.from({ length: 120 }, (_, n) => market(`m${n}`, `Deck ${n}`, new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString()));
    await (await openBrowserResearchStore()).write(workspace(...markets));
    const repository = new GeminiRepository({ apiKey: 'k', client: {} as never, store: await openBrowserResearchStore(), dashboardWarmup: false, originalSourceReader: unavailable } as never);
    const { container } = renderWithProviders(<Sidebar />, { repository: repository as never });
    await screen.findByText('Deck 119');
    const decks = [...container.querySelectorAll('a[href*="/markets/"]')];
    expect(SIDEBAR_DECKS).toBe(50);
    expect(decks).toHaveLength(50);
    // The newest are the ones shown.
    expect(within(container).getByText('Deck 70')).toBeInTheDocument();
    expect(within(container).queryByText('Deck 69')).toBeNull();
    expect(within(container).getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/history');
  });
});

describe('an imported file cannot send the app to Today or start its daily check', () => {
  it('leaves out followed companies, so the first page is not Today and nothing is searched', async () => {
    const file = real();
    file.follows = file.companies.map((c) => ({ companyId: c.id, followedAt: '2026-01-01T00:00:00Z' }));
    file.movesRefreshedAt = { [companyId(file)]: '2026-01-01T00:00:00Z' };
    await installBrowserResearch(JSON.stringify(file));
    const saved = JSON.parse((await readBrowserResearchData()).current!);
    expect(saved.follows).toBeUndefined();
    expect(saved.movesRefreshedAt).toBeUndefined();
    const count = counters();
    const app = await openApp(count, { route: '/', waitMs: 1500 });
    expect(count).toEqual({ ground: 0, structure: 0, news: 0, reads: 0 });
    expect(app.text()).not.toMatch(/^Today/);
    app.unmount();
  });
});

describe('a figure that is not a finite number', () => {
  it('is left out of an import instead of being saved as a verified null', async () => {
    const json = JSON.stringify(real()).replace(/"value":253500000000/, '"value":1e999');
    expect(json).toContain('1e999');
    const plan = planResearchImport(json);
    expect(plan.snapshot.metrics.every((m) => m.value === null || Number.isFinite(m.value))).toBe(true);
    expect(plan.snapshot.metrics).toHaveLength(47);
    await installBrowserResearch(json);
    const stored = JSON.parse((await readBrowserResearchData()).current!);
    expect(stored.metrics.filter((m: { value: unknown; confidence: string }) => m.value === null && m.confidence !== 'unknown')).toEqual([]);
  });
});

describe('an imported figure is judged here, not on the file\'s word', () => {
  it('ignores the gate version the file claims', async () => {
    const file = real();
    file.metricGateVersion = 999;
    await installBrowserResearch(JSON.stringify(file));
    const stored = JSON.parse((await readBrowserResearchData()).current!);
    expect(stored.metricGateVersion).not.toBe(999);
    expect(stored.metricGateVersion).toBeGreaterThan(0);
  });
});
