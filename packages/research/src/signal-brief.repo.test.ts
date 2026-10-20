/**
 * Signal briefs in the repository: stored by card id, read without spending, rebuilt only with force, one build for
 * concurrent requests, nothing stored on failure, removed with the card or deck, carried by a share, and an import is sifted.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import type { Card, SignalBrief } from '@mi/contracts';
import { completenessFixture } from './completeness-report.fixture';
import { GeminiRepository, type RepoSnapshot } from './repository';
import { MAX_IMPORTED_SIGNAL_BRIEFS, siftSignalBriefs } from './signal-brief-sift';
import type { LlmClient } from './types';

const NEWS = 'https://news.example/acme-fine';
const FINE = 'Acme Robotics was fined $2 million by a safety regulator in March 2024 after a warehouse robot injured a worker.';
const at = '2026-10-01T00:00:00.000Z';
const signalCard = (id: string, cardType: Card['cardType'], companyId: string | null): Card => ({
  id, deckId: 'deck_fx', companyId, cardType, title: 'Acme safety fine', summary: null, tier: null, tierReason: null, citations: [], keyPoints: [], createdAt: at,
});

function setup() {
  const base = {
    ...completenessFixture(), viceClaims: [], reports: [], briefings: [], savedCards: [], opportunity: {}, researchJobs: [], threads: [],
  } as unknown as RepoSnapshot;
  base.cards = [...base.cards, signalCard('card_acme_vice', 'vice', 'acme')];
  let saved: RepoSnapshot = base;
  let release: (() => void) | null = null;
  const gate = { hold: false };
  const ground = vi.fn(async () => {
    if (gate.hold) await new Promise<void>((resolve) => { release = resolve; });
    return {
      text: FINE, queries: [], citations: [{ title: 'News Example', url: NEWS }],
      grounding: { provider: 'google-search' as const, answerText: FINE, supports: [{ supportIndex: 0, text: FINE, sources: [{ chunkIndex: 0, url: NEWS, title: 'News Example' }] }] },
    };
  });
  const structure = vi.fn(async (_p: string, schema: ZodType<unknown>) => schema.parse({ lead: '', points: [{ text: FINE, sourceIndex: 1 }] }));
  const client: LlmClient = { ground, structure: structure as unknown as LlmClient['structure'] };
  const repo = new GeminiRepository({ apiKey: 'test', client, dashboardWarmup: false,
    originalSourceReader: async (url) => ({ requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: 'offline' }),
    store: { read: () => structuredClone(saved), write: async (next) => { saved = structuredClone(next); } } });
  return { repo, ground, structure, saved: () => saved, gate, release: () => release?.() };
}

describe('signal briefs in the repository', () => {
  it('peek never researches; the first request builds and stores; later ones are free; force rebuilds', async () => {
    const { repo, ground, structure, saved } = setup();
    expect(await repo.peekSignalBrief('card_acme_vice')).toBeNull();
    expect(ground).not.toHaveBeenCalled();

    const brief = await repo.researchSignalBrief({ cardId: 'card_acme_vice' });
    expect(brief.points).toHaveLength(1);
    expect(ground).toHaveBeenCalledTimes(1);
    expect(structure).toHaveBeenCalledTimes(1);
    expect(saved().signalBriefs?.card_acme_vice).toEqual(brief);

    expect(await repo.researchSignalBrief({ cardId: 'card_acme_vice' })).toEqual(brief);
    expect(await repo.peekSignalBrief('card_acme_vice')).toEqual(brief);
    expect(ground).toHaveBeenCalledTimes(1);

    await repo.researchSignalBrief({ cardId: 'card_acme_vice', force: true });
    expect(ground).toHaveBeenCalledTimes(2);
    expect(structure).toHaveBeenCalledTimes(2);
  });

  it('two concurrent requests for one card share one build', async () => {
    const { repo, ground, structure, gate, release } = setup();
    gate.hold = true;
    const a = repo.researchSignalBrief({ cardId: 'card_acme_vice' });
    const b = repo.researchSignalBrief({ cardId: 'card_acme_vice', force: true });
    await vi.waitFor(() => expect(ground).toHaveBeenCalledTimes(1));
    release();
    expect(await a).toEqual(await b);
    expect(ground).toHaveBeenCalledTimes(1);
    expect(structure).toHaveBeenCalledTimes(1);
  });

  it('a failed build stores nothing and keeps an earlier brief', async () => {
    const { repo, ground, saved } = setup();
    ground.mockRejectedValueOnce(new Error('offline'));
    await expect(repo.researchSignalBrief({ cardId: 'card_acme_vice' })).rejects.toThrow('offline');
    expect(saved().signalBriefs).toBeUndefined();
    expect(await repo.peekSignalBrief('card_acme_vice')).toBeNull();

    const first = await repo.researchSignalBrief({ cardId: 'card_acme_vice' });
    ground.mockRejectedValueOnce(new Error('offline'));
    await expect(repo.researchSignalBrief({ cardId: 'card_acme_vice', force: true })).rejects.toThrow();
    expect(await repo.peekSignalBrief('card_acme_vice')).toEqual(first);
  });

  it('refuses an entity card and an unknown card without calling the client', async () => {
    const { repo, ground } = setup();
    await expect(repo.researchSignalBrief({ cardId: 'card_acme' })).rejects.toThrow(/signal cards/);
    await expect(repo.researchSignalBrief({ cardId: 'nope' })).rejects.toThrow(/Card not found/);
    expect(ground).not.toHaveBeenCalled();
  });

  it('deleting the card removes its brief, and a brief of a card that is gone is not served', async () => {
    const { repo, saved } = setup();
    await repo.researchSignalBrief({ cardId: 'card_acme_vice' });
    await repo.researchSignalBrief({ cardId: 'card_barrier' }).catch(() => undefined);
    await repo.removeCard('card_acme_vice');
    expect(saved().signalBriefs?.card_acme_vice).toBeUndefined();
    expect(await repo.peekSignalBrief('card_acme_vice')).toBeNull();
  });

  it('deleting the deck removes its briefs', async () => {
    const { repo, saved } = setup();
    await repo.researchSignalBrief({ cardId: 'card_acme_vice' });
    expect(await repo.deleteMarket('mkt_fx')).toBe(true);
    expect(saved().signalBriefs?.card_acme_vice).toBeUndefined();
  });

  it('the share export carries the brief of the signal card it exports, and only signal cards', async () => {
    const { repo } = setup();
    const brief = await repo.researchSignalBrief({ cardId: 'card_acme_vice' });
    const share = await repo.exportShareSnapshot({ deckId: 'deck_fx', cardId: 'card_acme_vice' });
    expect(share.signalBriefs).toEqual({ card_acme_vice: brief });
    const other = await repo.exportShareSnapshot({ deckId: 'deck_fx', cardId: 'card_acme' });
    expect(other.signalBriefs).toEqual({});
  });
});

const validBrief = (cardId: string): SignalBrief => ({
  cardId, cardType: 'vice', builtAt: at, lead: 'Lead.', points: [{ text: FINE, sources: [{ title: 'News', url: NEWS }] }], sources: [{ title: 'News', url: NEWS }],
  cost: { estUsd: null, calls: null, searches: null },
});

describe('siftSignalBriefs (a hostile import)', () => {
  it('keeps well-formed briefs under their own card id and drops everything else', () => {
    const raw = JSON.parse(`{
      "card_a": ${JSON.stringify(validBrief('card_a'))},
      "card_b": ${JSON.stringify(validBrief('someone_else'))},
      "card_c": {"cardId": "card_c", "points": "nope"},
      "card_d": null,
      "__proto__": ${JSON.stringify(validBrief('__proto__'))},
      "constructor": ${JSON.stringify(validBrief('constructor'))},
      "toString": ${JSON.stringify(validBrief('toString'))}
    }`);
    const out = siftSignalBriefs(raw);
    expect(Object.keys(out)).toEqual(['card_a']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).cardId).toBeUndefined();
  });

  it('caps the size of the map and survives non-objects', () => {
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < MAX_IMPORTED_SIGNAL_BRIEFS + 500; i += 1) huge[`c${i}`] = validBrief(`c${i}`);
    expect(Object.keys(siftSignalBriefs(huge))).toHaveLength(MAX_IMPORTED_SIGNAL_BRIEFS);
    for (const bad of [null, undefined, 5, 'x', [validBrief('a')]]) expect(siftSignalBriefs(bad)).toEqual({});
  });
});
