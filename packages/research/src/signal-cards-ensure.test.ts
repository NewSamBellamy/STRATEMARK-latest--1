import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { completenessFixture } from './completeness-report.fixture';
import { GeminiRepository, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const SOURCES = [
  { title: 'reuters.com', url: 'https://www.reuters.com/a' },
  { title: 'ft.com', url: 'https://www.ft.com/b' },
  { title: 'bbc.com', url: 'https://www.bbc.com/c' },
];

/** The structuring answers each kind of search gets, keyed by what its prompt asks for. */
const MARKET_ANSWER = {
  barriers: [1, 2, 3, 4, 5].map((n) => ({ title: `Barrier number ${n} in this market`, summary: `Barrier ${n} summary.`, sourceIndex: n % 3, sourceIndexes: [], keyPoints: [`Point ${n}`] })),
  insights: [1, 2, 3, 4, 5].map((n) => ({ title: `Insight number ${n} in this market`, summary: `Insight ${n} summary.`, sourceIndex: n % 3, sourceIndexes: [], keyPoints: [`Point ${n}`] })),
};
const ROSTER_ANSWER = {
  risks: [
    { company: 'Acme Robotics', text: 'Acme Robotics was fined by a safety regulator over a warehouse robot recall in 2024.', sourceIndex: 0 },
    { company: 'Gamma Shop', text: 'Gamma Shop settled a consumer class action over subscription billing in 2023.', sourceIndex: 1 },
    { company: 'Beta Capital', text: 'Beta Capital faced a regulator inquiry into marketing claims in 2022.', sourceIndex: 2 },
    { company: 'Acme Robotics', text: 'Acme Robotics disclosed a customer data breach affecting its fleet dashboard in 2025.', sourceIndex: 1 },
  ],
  culture: [
    { company: 'Acme Robotics', note: 'Acme Robotics publishes an engineer-led values charter and a four-day build week, according to its careers page.', sourceIndex: 2 },
    { company: 'Gamma Shop', note: 'Gamma Shop is a certified B Corporation and says its mission is fair pay for pickers.', sourceIndex: 1 },
  ],
};

function setup(options: { structure?: (prompt: string) => unknown; groundFails?: number } = {}) {
  let saved = { ...completenessFixture(), viceClaims: [], reports: [], briefings: [], savedCards: [],
    opportunity: {}, researchJobs: [], threads: [] } as unknown as RepoSnapshot;
  // Start from a deck with no signal cards at all.
  saved.cards = saved.cards.filter((card) => !['barrier', 'insight', 'vice', 'culture'].includes(card.cardType));
  let failures = options.groundFails ?? 0;
  const ground = vi.fn(async (_prompt: string, _opts?: unknown) => {
    if (failures > 0) { failures -= 1; throw new Error('503'); }
    return { text: 'notes', citations: SOURCES, queries: ['q'] };
  });
  const structure = vi.fn(async (prompt: string, schema: ZodType<unknown>) =>
    schema.parse((options.structure ?? ((p: string) => (p.includes('"risks"') ? ROSTER_ANSWER : MARKET_ANSWER)))(prompt)));
  const repo = new GeminiRepository({ apiKey: 'test', client: { ground, structure } as unknown as LlmClient, groundedRpm: 0, dashboardWarmup: false,
    store: { read: () => structuredClone(saved), write: async (next) => { saved = structuredClone(next); } } });
  const countsOf = () => saved.cards.filter((c) => c.deckId === 'deck_fx').reduce<Record<string, number>>((a, c) => { a[c.cardType] = (a[c.cardType] ?? 0) + 1; return a; }, {});
  return { repo, ground, structure, saved: () => saved, countsOf };
}

describe('a deck gets its four market-signal kinds', () => {
  it('fills a deck that has none with barrier, insight, vice and culture cards, each with its source, and saves them', async () => {
    const { repo, saved, countsOf } = setup();
    const events: string[][] = [];
    repo.subscribeDeckRefresh((event) => events.push(event.addedCardIds));
    const result = await repo.ensureSignalCards('deck_fx');
    expect(result.failed).toBe(false);
    expect(result.added).toEqual({ barrier: 5, insight: 5, vice: 3, culture: 2 });
    expect(countsOf()).toMatchObject({ barrier: 5, insight: 5, vice: 3, culture: 2 });
    const vice = saved().cards.filter((c) => c.cardType === 'vice');
    // One vice card per company, with every sourced claim under it (a company's second claim joins its card).
    expect(new Set(vice.map((c) => c.companyId)).size).toBe(3);
    const acme = vice.find((c) => c.companyId === 'acme')!;
    expect(saved().viceClaims.filter((v) => v.cardId === acme.id).map((v) => v.sourceUrl)).toEqual(['https://www.reuters.com/a', 'https://www.ft.com/b']);
    for (const card of saved().cards.filter((c) => ['barrier', 'insight', 'culture'].includes(c.cardType))) expect(card.citations.length, card.cardType).toBeGreaterThan(0);
    expect(events.flat().length).toBe(15);
  });

  it('does nothing, and pays for nothing, for a deck that has enough of every kind', async () => {
    const { repo, ground } = setup();
    await repo.ensureSignalCards('deck_fx');
    ground.mockClear();
    const again = await repo.ensureSignalCards('deck_fx');
    expect(again.added).toEqual({ barrier: 0, insight: 0, vice: 0, culture: 0 });
    // Culture stopped at two (a market rarely documents more); only that kind is asked for again, once.
    expect(ground.mock.calls.length).toBeLessThanOrEqual(1);
    const prompts = ground.mock.calls.map((call) => String(call[0]));
    expect(prompts.every((prompt) => !/BARRIERS/.test(prompt))).toBe(true);
  });

  it('searches for every kind when asked to, and never files the same company or the same title twice', async () => {
    const { repo, ground, countsOf } = setup();
    await repo.ensureSignalCards('deck_fx');
    ground.mockClear();
    const again = await repo.ensureSignalCards('deck_fx', { force: true });
    expect(ground.mock.calls.length).toBe(2); // the market search and the roster search
    expect(again.added).toEqual({ barrier: 0, insight: 0, vice: 0, culture: 0 });
    expect(countsOf()).toMatchObject({ barrier: 5, insight: 5, vice: 3, culture: 2 });
  });

  it('tries a search that errors once more, and reports a failure instead of an empty deck as done', async () => {
    vi.useFakeTimers();
    const retried = setup({ groundFails: 1 });
    const pending = retried.repo.ensureSignalCards('deck_fx');
    await vi.advanceTimersByTimeAsync(2_500);
    expect((await pending).failed).toBe(false);
    expect(retried.countsOf().barrier).toBe(5);

    const dead = setup({ groundFails: 99 });
    const failing = dead.repo.ensureSignalCards('deck_fx');
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await failing;
    expect(result.failed).toBe(true);
    expect(result.added).toEqual({ barrier: 0, insight: 0, vice: 0, culture: 0 });
    expect(dead.countsOf().barrier).toBeUndefined();
  });

  it('runs one search per deck at a time: a second ask joins the first', async () => {
    const { repo, ground } = setup();
    const [a, b] = await Promise.all([repo.ensureSignalCards('deck_fx'), repo.ensureSignalCards('deck_fx')]);
    expect(a).toBe(b);
    expect(ground.mock.calls.length).toBe(2);
  });

  it('an honest empty answer adds nothing and is not a failure', async () => {
    const { repo, countsOf } = setup({ structure: (prompt) => (prompt.includes('"risks"') ? { risks: [], culture: [] } : { barriers: [], insights: [] }) });
    const result = await repo.ensureSignalCards('deck_fx');
    expect(result).toEqual({ added: { barrier: 0, insight: 0, vice: 0, culture: 0 }, failed: false });
    expect(countsOf().vice).toBeUndefined();
  });

  it('an unknown deck is a no-op', async () => {
    const { repo, ground } = setup();
    expect(await repo.ensureSignalCards('deck_nope')).toEqual({ added: { barrier: 0, insight: 0, vice: 0, culture: 0 }, failed: false });
    expect(ground).not.toHaveBeenCalled();
  });
});
