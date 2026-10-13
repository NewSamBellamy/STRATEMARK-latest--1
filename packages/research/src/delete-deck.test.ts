/**
 * Local deck deletion: removing a deck takes everything that only existed for
 * it, keeps companies another deck still shows, stops research that could
 * write it back, and never half-applies when the save fails.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';

const now = '2026-10-01T00:00:00.000Z';
const client = {
  ground: vi.fn(async () => { throw new Error('no network in tests'); }),
  structure: vi.fn(async () => { throw new Error('no network in tests'); }),
} as unknown as LlmClient;

function company(id: string, name: string) {
  return { id, name, oneLiner: `${name} does things.`, websiteUrl: `https://${id}.com`, logoUrl: null, hqLocation: null, brandTheme: null };
}
function card(id: string, deckId: string, companyId: string | null, cardType = 'company') {
  return { id, deckId, companyId, cardType, title: id, tier: null, tierReason: null };
}
function metric(companyId: string, value: number) {
  return { id: `met_${companyId}`, companyId, metricType: 'employees', value, confidence: 'user_verified',
    source: 'Analyst confirmed', citations: [], methodNote: null, capturedAt: now };
}

/** Two decks: A holds solo + shared + a signal card; B holds shared. */
function seed(): RepoSnapshot {
  const base = migrateSnapshot(null).snapshot;
  return {
    ...base,
    markets: [
      { id: 'mkt_a', name: 'Market A', scopeDefinition: { vertical: 'A', geography: null, notes: null }, refreshCadence: 'weekly', createdAt: now },
      { id: 'mkt_b', name: 'Market B', scopeDefinition: { vertical: 'B', geography: null, notes: null }, refreshCadence: 'weekly', createdAt: now },
    ],
    decks: [
      { id: 'dck_a', marketId: 'mkt_a', createdAt: now, lastRefreshedAt: null },
      { id: 'dck_b', marketId: 'mkt_b', createdAt: now, lastRefreshedAt: null },
    ],
    companies: [company('cmp_solo', 'Solo Co'), company('cmp_shared', 'Shared Co')],
    metrics: [metric('cmp_solo', 10), metric('cmp_shared', 20)],
    cards: [card('crd_a_solo', 'dck_a', 'cmp_solo'), card('crd_a_shared', 'dck_a', 'cmp_shared'),
      card('crd_a_vice', 'dck_a', null, 'vice'), card('crd_b_shared', 'dck_b', 'cmp_shared')],
    viceClaims: [{ id: 'vc_a', cardId: 'crd_a_vice' }, { id: 'vc_b', cardId: 'crd_b_shared' }],
    dashboards: { cmp_solo: {}, cmp_shared: {} },
    companyMarket: { cmp_solo: 'Market A', cmp_shared: 'Market A' },
    reports: [
      { id: 'rpt_deck_a', kind: 'deck', subjectId: 'dck_a', title: 'A', markdown: 'a', citations: [], createdAt: now },
      { id: 'rpt_solo', kind: 'company', subjectId: 'cmp_solo', title: 'S', markdown: 's', citations: [], createdAt: now },
      { id: 'rpt_shared', kind: 'company', subjectId: 'cmp_shared', title: 'SH', markdown: 'sh', citations: [], createdAt: now },
    ],
    briefings: [
      { id: 'brf_a', marketId: 'mkt_a', deckId: 'dck_a', marketName: 'Market A', generatedAt: now, windowHours: 24, headline: 'a', updates: [], insights: [] },
      { id: 'brf_b', marketId: 'mkt_b', deckId: 'dck_b', marketName: 'Market B', generatedAt: now, windowHours: 24, headline: 'b', updates: [], insights: [] },
    ],
    savedCards: [{ cardId: 'crd_a_solo', savedAt: now }, { cardId: 'crd_b_shared', savedAt: now }],
    opportunity: { mkt_a: { markdown: 'a', citations: [], at: now }, mkt_b: { markdown: 'b', citations: [], at: now } },
    researchJobs: [
      { id: 'job_a', status: 'completed', stage: 'signals', brief: { prompt: 'A' }, deck: { id: 'dck_a', marketId: 'mkt_a', createdAt: now, lastRefreshedAt: null },
        catalogNames: [], completedEntityNames: [], partialCards: [], warnings: [], error: null, createdAt: now, updatedAt: now },
      { id: 'job_b', status: 'completed', stage: 'signals', brief: { prompt: 'B' }, deck: { id: 'dck_b', marketId: 'mkt_b', createdAt: now, lastRefreshedAt: null },
        catalogNames: [], completedEntityNames: [], partialCards: [], warnings: [], error: null, createdAt: now, updatedAt: now },
    ],
    threads: [
      { id: 'thr_a', scope: { kind: 'deck', deckId: 'dck_a' }, title: 'a', messages: [], reportId: null, createdAt: now, updatedAt: now },
      { id: 'thr_b', scope: { kind: 'deck', deckId: 'dck_b' }, title: 'b', messages: [], reportId: null, createdAt: now, updatedAt: now },
    ],
    researchEvidence: [
      { id: 'ev_solo', companyId: 'cmp_solo', topic: 't', capturedAt: now, text: 'x', citations: [], queries: [] },
      { id: 'ev_shared', companyId: 'cmp_shared', topic: 't', capturedAt: now, text: 'y', citations: [], queries: [] },
    ],
    originalSourceAttempts: [
      { id: 'osa_solo', companyId: 'cmp_solo', metricType: 'employees', capturedAt: now, receipts: [] },
      { id: 'osa_shared', companyId: 'cmp_shared', metricType: 'employees', capturedAt: now, receipts: [] },
    ],
    removedFromDeck: [{ deckId: 'dck_a', companyKey: 'gone', at: now }, { deckId: 'dck_b', companyKey: 'gone', at: now }],
    sourceChecks: {
      'cmp_solo|employees|10|https://x.com': { finalUrl: null, found: false, read: false, checkedAt: now },
      'cmp_shared|employees|20|https://y.com': { finalUrl: null, found: false, read: false, checkedAt: now },
    },
  } as unknown as RepoSnapshot;
}

function harness(initial: RepoSnapshot = seed()) {
  let saved: RepoSnapshot = structuredClone(initial);
  let fail = false;
  const store = {
    read: () => structuredClone(saved),
    write: vi.fn(async (next: RepoSnapshot) => {
      if (fail) throw new Error('Disk full');
      saved = structuredClone(next);
    }),
  };
  const open = () => new GeminiRepository({ apiKey: 'test-placeholder', client, store });
  return { store, open, saved: () => structuredClone(saved), failWrites: () => { fail = true; } };
}

describe('GeminiRepository.deleteMarket', () => {
  it('removes the deck and everything only it used, and the deletion survives reopen', async () => {
    const h = harness();
    const repo = h.open();
    const events = vi.fn();
    repo.subscribeDeckRefresh(events);

    expect(await repo.deleteMarket('mkt_a')).toBe(true);

    for (const snap of [h.saved(), (h.open() as unknown as { snap: RepoSnapshot }).snap]) {
      expect(snap.markets.map((m) => m.id)).toEqual(['mkt_b']);
      expect(snap.decks.map((d) => d.id)).toEqual(['dck_b']);
      expect(snap.cards.map((c) => c.id)).toEqual(['crd_b_shared']);
      expect(snap.viceClaims.map((v) => v.id)).toEqual(['vc_b']);
      expect(snap.savedCards.map((s) => s.cardId)).toEqual(['crd_b_shared']);
      expect(snap.researchJobs.map((j) => j.id)).toEqual(['job_b']);
      expect(snap.briefings.map((b) => b.id)).toEqual(['brf_b']);
      expect(Object.keys(snap.opportunity)).toEqual(['mkt_b']);
      expect(snap.removedFromDeck?.map((r) => r.deckId)).toEqual(['dck_b']);
      expect(snap.threads.map((t) => t.id)).toEqual(['thr_b']);
      expect(snap.reports.map((r) => r.id)).toEqual(['rpt_shared']);
      expect(snap.companies.map((c) => c.id)).toEqual(['cmp_shared']);
      expect(snap.metrics.map((m) => m.companyId)).toEqual(['cmp_shared']);
      expect(Object.keys(snap.dashboards)).toEqual(['cmp_shared']);
      expect(Object.keys(snap.sourceChecks ?? {})).toEqual(['cmp_shared|employees|20|https://y.com']);
      expect(snap.researchEvidence?.map((e) => e.id)).toEqual(['ev_shared']);
      expect(snap.originalSourceAttempts?.map((o) => o.id)).toEqual(['osa_shared']);
      expect(Object.keys(snap.companyMarket)).toEqual(['cmp_shared']);
    }
    expect(await repo.listMarkets()).toHaveLength(1);
    expect(await repo.getDeckByMarket('mkt_a')).toBeNull();
    expect(events).toHaveBeenCalledWith(expect.objectContaining({
      marketId: 'mkt_a', deckId: 'dck_a', companyIds: ['cmp_solo'],
      prunedCardIds: ['crd_a_solo', 'crd_a_shared', 'crd_a_vice'],
    }));
  });

  it('keeps a company another deck still shows, with its figures, and relabels its market', async () => {
    const h = harness();
    const repo = h.open();
    await repo.deleteMarket('mkt_a');
    const snap = h.saved();
    expect(snap.companies.find((c) => c.id === 'cmp_shared')).toMatchObject({ name: 'Shared Co' });
    expect(snap.metrics.find((m) => m.companyId === 'cmp_shared')).toMatchObject({ value: 20 });
    expect(snap.companyMarket.cmp_shared).toBe('Market B');
    expect((await repo.getCompany('cmp_shared'))?.name).toBe('Shared Co');
  });

  it('accepts a deck id or a market id through deleteDeck', async () => {
    const byDeck = harness();
    expect(await byDeck.open().deleteDeck('dck_a')).toBe(true);
    expect(byDeck.saved().markets.map((m) => m.id)).toEqual(['mkt_b']);
    const byMarket = harness();
    expect(await byMarket.open().deleteDeck('mkt_a')).toBe(true);
    expect(byMarket.saved().decks.map((d) => d.id)).toEqual(['dck_b']);
  });

  it('cancels research still running for the deck, and nothing it writes afterwards comes back', async () => {
    const initial = seed();
    initial.researchJobs[0]!.status = 'running';
    const h = harness(initial);
    const repo = h.open();
    const internals = repo as unknown as {
      snap: RepoSnapshot;
      persist(): Promise<void>;
      jobControllers: Map<string, AbortController>;
      activeBackgroundJobs: Map<string, Promise<void>>;
    };
    internals.snap.researchJobs[0]!.status = 'running';
    const controller = new AbortController();
    internals.jobControllers.set('job_a', controller);
    // The job's tail: once aborted it still lands one more card and saves,
    // the way a late ingest would.
    const tail = new Promise<void>((resolve) => {
      controller.signal.addEventListener('abort', () => {
        void (async () => {
          await new Promise((r) => setTimeout(r, 5));
          internals.snap.cards.push(card('crd_a_late', 'dck_a', 'cmp_late') as never);
          internals.snap.researchJobs[0]!.status = 'cancelled';
          await internals.persist();
          resolve();
        })();
      }, { once: true });
    });
    internals.activeBackgroundJobs.set('job_a', tail);

    expect(await repo.deleteMarket('mkt_a')).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    await tail;
    const reopened = (h.open() as unknown as { snap: RepoSnapshot }).snap;
    for (const snap of [h.saved(), reopened, internals.snap]) {
      expect(snap.cards.some((c) => c.deckId === 'dck_a')).toBe(false);
      expect(snap.decks.some((d) => d.id === 'dck_a')).toBe(false);
      expect(snap.researchJobs.some((j) => j.id === 'job_a')).toBe(false);
    }
  });

  it('returns false for an unknown id and writes nothing', async () => {
    const h = harness();
    const repo = h.open();
    expect(await repo.deleteMarket('mkt_missing')).toBe(false);
    expect(await repo.deleteDeck('dck_missing')).toBe(false);
    expect(h.store.write).not.toHaveBeenCalled();
  });

  it('leaves everything in place when the save fails', async () => {
    const h = harness();
    const repo = h.open();
    const before = JSON.stringify(h.saved());
    const events = vi.fn();
    repo.subscribeDeckRefresh(events);
    h.failWrites();
    await expect(repo.deleteMarket('mkt_a')).rejects.toThrow('Disk full');
    expect(JSON.stringify(h.saved())).toBe(before);
    const snap = (repo as unknown as { snap: RepoSnapshot }).snap;
    expect(snap.markets.map((m) => m.id)).toEqual(['mkt_a', 'mkt_b']);
    expect(snap.cards).toHaveLength(4);
    expect(snap.companies).toHaveLength(2);
    expect(events).not.toHaveBeenCalled();
  });
});
