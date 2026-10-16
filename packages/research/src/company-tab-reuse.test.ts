import { describe, expect, it, vi } from 'vitest';
import { completenessFixture } from './completeness-report.fixture';
import { selectOriginalSourceAttempts, type OriginalSourceAttempt } from './original-source';
import { GeminiRepository, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';

const DAY = 24 * 60 * 60_000;
const PRODUCT_QUOTE = 'Acme Fleet Manager is the software operators use to run every warehouse robot.';
const productPage = (id: string, companyId: string): OriginalSourceAttempt => ({ id, companyId, metricType: 'products_roadmap',
  capturedAt: '2026-10-10T00:00:00.000Z', receipts: [{ requestedUrl: 'https://acme.example/products', finalUrl: 'https://acme.example/products',
    text: `Products. ${PRODUCT_QUOTE} Contact sales.`, status: 'retrieved', httpStatus: 200, contentHash: 'b'.repeat(64), retrievedAt: '2026-10-10T00:00:00.000Z' }] });

/** The fixture deck with Acme Robotics' tabs opened `ageDays` ago, plus Acme added again by a second deck. */
function twinWorkspace(ageDays: number, twin: { websiteUrl?: string } = {}): RepoSnapshot {
  const snap = { ...completenessFixture(), viceClaims: [], reports: [], briefings: [], savedCards: [],
    opportunity: {}, researchJobs: [], threads: [] } as unknown as RepoSnapshot;
  const acme = snap.companies.find((c) => c.id === 'acme')!;
  snap.companies.push({ ...acme, id: 'acme_2', ...twin });
  const at = new Date(Date.now() - ageDays * DAY).toISOString();
  snap.dashboards = { ...snap.dashboards, acme: {
    history: { content: { markdown: '## History\n\nAcme Robotics was founded to automate warehouses.' }, citations: [], lastRefreshedAt: at },
    products_roadmap: { content: { products: [], roadmap: [] }, citations: [], lastRefreshedAt: at,
      productSelections: { products: [{ name: 'Fleet Manager', status: null, sourceUrl: 'https://acme.example/products', quote: PRODUCT_QUOTE }], roadmap: [] } },
  } } as RepoSnapshot['dashboards'];
  return snap;
}

/** The desktop shape: saved pages in their own store, which accepts only src_<uuid> ids. */
function desktopRepo(start: RepoSnapshot, store: OriginalSourceAttempt[]) {
  let saved = structuredClone(start);
  const ground = vi.fn(async () => { throw new Error('no paid search in this test'); });
  const structure = vi.fn(async () => { throw new Error('no paid search in this test'); });
  const save = vi.fn(async (attempt: OriginalSourceAttempt) => {
    if (!/^src_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(attempt.id)) throw new Error('Invalid original-source attempt.');
    store.push(structuredClone(attempt));
  });
  const repo = new GeminiRepository({ apiKey: 'test', client: { ground, structure } as unknown as LlmClient, dashboardWarmup: false,
    originalSources: { retrieve: vi.fn(), save, list: async (input) => selectOriginalSourceAttempts(store, input) },
    store: { read: () => structuredClone(saved), write: async (next) => { saved = structuredClone(next); } } });
  return { repo, ground, structure, store, saved: () => saved };
}

describe('a company already researched in another deck opens its tabs without a new search', () => {
  it('on desktop, the second deck\'s tabs come from the twin, products re-checked against its own copy of the page', async () => {
    const store = [productPage('src_p1', 'acme')];
    const { repo, ground, structure } = desktopRepo(twinWorkspace(2), store);
    const twinProducts = await repo.getDashboardTab('acme', 'products_roadmap');
    expect(twinProducts?.content.products.map((p) => p.name)).toEqual(['Fleet Manager']);

    // The warm-up opens several tabs at once: one borrow, one copy of the page.
    const [history, products] = await Promise.all([repo.getDashboardTab('acme_2', 'history'), repo.getDashboardTab('acme_2', 'products_roadmap')]);
    expect(history?.content).toEqual({ markdown: '## History\n\nAcme Robotics was founded to automate warehouses.' });
    expect(products?.content.products.map((p) => p.name)).toEqual(['Fleet Manager']);
    expect(products?.citations?.map((c) => c.url)).toEqual(['https://acme.example/products']);
    expect(store.filter((row) => row.companyId === 'acme_2')).toHaveLength(1);
    expect(ground).not.toHaveBeenCalled();
    expect(structure).not.toHaveBeenCalled();
  });

  it('a twin whose page cannot be filed lends nothing, so the tab is researched as usual', async () => {
    const store = [productPage('src_p1', 'acme')];
    const { repo, ground, saved } = desktopRepo(twinWorkspace(2), store);
    const original = store.push.bind(store);
    store.push = () => { throw new Error('disk full'); };
    await repo.getDashboardTab('acme_2', 'products_roadmap').catch(() => null);
    store.push = original;
    expect(ground).toHaveBeenCalled();
    expect(saved().dashboards.acme_2?.history).toBeUndefined();
  });

  it('a twin whose tabs are a month old lends nothing', async () => {
    const { repo, ground, saved } = desktopRepo(twinWorkspace(40), [productPage('src_p1', 'acme')]);
    await repo.getDashboardTab('acme_2', 'history').catch(() => null);
    expect(ground).toHaveBeenCalled();
    expect(saved().dashboards.acme_2?.products_roadmap).toBeUndefined();
  });

  it('a company with the same name but a different website never borrows', async () => {
    const store = [productPage('src_p1', 'acme')];
    const { repo, ground, saved } = desktopRepo(twinWorkspace(2, { websiteUrl: 'https://acme-robotics.example' }), store);
    await repo.getDashboardTab('acme_2', 'history').catch(() => null);
    expect(ground).toHaveBeenCalled();
    expect(saved().dashboards.acme_2?.products_roadmap).toBeUndefined();
    expect(store.filter((row) => row.companyId === 'acme_2')).toHaveLength(0);
  });

  it('a forced refresh never borrows', async () => {
    const { repo, ground } = desktopRepo(twinWorkspace(2), [productPage('src_p1', 'acme')]);
    await repo.getDashboardTab('acme_2', 'history', true).catch(() => null);
    expect(ground).toHaveBeenCalled();
  });

  it('in the browser, where pages live in the workspace, the twin\'s tabs and page are copied there', async () => {
    let saved = twinWorkspace(2);
    saved.originalSourceAttempts = [productPage('src_p1', 'acme')];
    const ground = vi.fn(async () => { throw new Error('no paid search in this test'); });
    const repo = new GeminiRepository({ apiKey: 'test', client: { ground, structure: ground } as unknown as LlmClient, dashboardWarmup: false,
      originalSourceReader: vi.fn(), store: { read: () => structuredClone(saved), write: async (next) => { saved = structuredClone(next); } } });
    const products = await repo.getDashboardTab('acme_2', 'products_roadmap');
    expect(products?.content.products.map((p) => p.name)).toEqual(['Fleet Manager']);
    expect(saved.originalSourceAttempts?.filter((row) => row.companyId === 'acme_2')).toHaveLength(1);
    expect(ground).not.toHaveBeenCalled();
  });
});

/** A workspace that survives an app restart: each `make()` is a fresh repository on the same saved state and pages. */
function restartable(start: RepoSnapshot, store: OriginalSourceAttempt[]) {
  let saved = structuredClone(start);
  const ground = vi.fn(async () => { throw new Error('no paid search in this test'); });
  const make = () => new GeminiRepository({ apiKey: 'test', client: { ground, structure: ground } as unknown as LlmClient, dashboardWarmup: false,
    originalSources: { retrieve: vi.fn(), save: async (a) => { store.push(structuredClone(a)); }, list: async (input) => selectOriginalSourceAttempts(store, input) },
    store: { read: () => structuredClone(saved), write: async (next) => { saved = structuredClone(next); } } });
  return { make, ground, saved: () => saved };
}

describe('what a twin must never lend', () => {
  it('two different companies with the same name on one shared host (LinkedIn pages) are not twins', async () => {
    const snap = twinWorkspace(1);
    snap.companies.find((c) => c.id === 'acme')!.websiteUrl = 'https://www.linkedin.com/company/acme-other';
    snap.companies.find((c) => c.id === 'acme_2')!.websiteUrl = 'https://www.linkedin.com/company/acme-robotics-gmbh';
    const { make, ground, saved } = restartable(snap, [productPage('src_p1', 'acme')]);
    await make().getDashboardTab('acme_2', 'history').catch(() => null);
    expect(ground).toHaveBeenCalled();
    expect(saved().dashboards.acme_2?.history).toBeUndefined();
  });

  it('an Overview the twin itself hides (its narrative names another company) is not lent', async () => {
    const snap = twinWorkspace(1);
    const text = 'Orbital Freight designs reusable cargo rockets for lunar delivery.';
    const cite = 'https://www.reuters.com/business/orbital-freight-profile';
    snap.dashboards = { acme: { overview: { content: { markdown: '' }, citations: [], lastRefreshedAt: new Date(Date.now() - DAY).toISOString(),
      overviewEvidenceVersion: 3, overviewNarrative: { companyId: 'orbital_freight', basis: 'google-search', answerText: text,
        citations: [{ title: 'Reuters', url: cite }], paragraphs: [{ section: 'background', text, supportIndices: [], sourceUrls: [cite] }] } } } } as unknown as RepoSnapshot['dashboards'];
    const { make, ground } = restartable(snap, []);
    const repo = make();
    expect(JSON.stringify((await repo.getDashboardTab('acme', 'overview'))?.content)).not.toContain('Orbital Freight');
    const borrowed = await repo.getDashboardTab('acme_2', 'overview').catch(() => null);
    expect(JSON.stringify(borrowed?.content ?? null)).not.toContain('Orbital Freight');
    expect(ground).toHaveBeenCalled();
  });

  it('after a deck refresh, even across an app restart, tabs from before the refresh are not lent back', async () => {
    const snap = twinWorkspace(5);
    // acme_2 sits on the refreshed deck; acme (the twin) keeps its five-day-old tabs in another deck.
    snap.cards.filter((card) => card.companyId === 'acme').forEach((card) => { card.companyId = 'acme_2'; });
    const { make, ground, saved } = restartable(snap, [productPage('src_p1', 'acme')]);
    await make().refreshDeck('mkt_fx');
    expect(saved().decks[0]!.lastRefreshedAt).not.toBeNull();
    ground.mockClear();
    // A new repository on the same saved state: what an app restart sees.
    await make().getDashboardTab('acme_2', 'history').catch(() => null);
    expect(ground).toHaveBeenCalled();
    expect(saved().dashboards.acme_2?.history).toBeUndefined();
  });
});

describe('borrowing never costs a free step', () => {
  it('the twin\'s saved notes are still lent after its tabs are borrowed, so missing figures recover for free', async () => {
    const snap = twinWorkspace(1);
    snap.researchEvidence = [{ id: 'ev_arr', companyId: 'acme', companyName: 'Acme Robotics', topic: 'arr', capturedAt: '2026-10-10T00:00:00.000Z',
      text: 'Acme Robotics ARR reached $40M in 2026.', citations: [{ title: 'Reuters', url: 'https://www.reuters.com/x' }], queries: [] }] as unknown as RepoSnapshot['researchEvidence'];
    const { make, saved } = restartable(snap, [productPage('src_p1', 'acme')]);
    await make().getDashboardTab('acme_2', 'history');
    expect(saved().researchEvidence?.some((e) => e.companyId === 'acme_2' && e.topic === 'arr')).toBe(true);
  });

  it('a free tab opened before the twin finished does not stop a later borrow of the rest', async () => {
    const snap = twinWorkspace(1);
    snap.dashboards = { acme: {}, acme_2: { live_landing: { content: { url: 'https://acme.example', embeddable: true, screenshotUrl: null },
      citations: [], lastRefreshedAt: new Date().toISOString() } } } as unknown as RepoSnapshot['dashboards'];
    snap.dashboards.acme = twinWorkspace(1).dashboards.acme!;
    const { make, ground, saved } = restartable(snap, [productPage('src_p1', 'acme')]);
    const history = await make().getDashboardTab('acme_2', 'history');
    expect(history?.content).toEqual({ markdown: '## History\n\nAcme Robotics was founded to automate warehouses.' });
    expect(ground).not.toHaveBeenCalled();
    expect(saved().dashboards.acme_2?.live_landing).toBeDefined();
  });
});
