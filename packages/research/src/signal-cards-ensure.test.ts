import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import type { Card } from '@mi/contracts';
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

/** A sentence of the answer and the source the search attributed it to (a risk is filed only on such a sentence). */
const supportOf = (text: string, sourceIndex: number, supportIndex: number) => ({
  supportIndex, text, sources: [{ chunkIndex: sourceIndex, url: SOURCES[sourceIndex]!.url, title: SOURCES[sourceIndex]!.title }],
});
/** What the search attributed, by the kind of question: the roster question's sentences, or the market's (each card's own words). */
const ROSTER_GROUNDING = { provider: 'google-search' as const, answerText: 'notes', supports: [
  ...ROSTER_ANSWER.risks.map((risk, i) => supportOf(risk.text, risk.sourceIndex, i)),
  ...ROSTER_ANSWER.culture.map((item, i) => supportOf(item.note, item.sourceIndex, 20 + i)),
] };
const MARKET_GROUNDING = { provider: 'google-search' as const, answerText: 'notes', supports: [...MARKET_ANSWER.barriers, ...MARKET_ANSWER.insights]
  .map((card, i) => supportOf(`${card.title}. ${card.summary} ${card.keyPoints.join(' ')}`, card.sourceIndex, i)) };

const SIGNAL_TYPES = ['barrier', 'insight', 'vice', 'culture'];
const DECK_CARDS = 'deck_fx';

/** A signal card as an earlier run (or discovery) left it: sourced or not. */
function signalCard(type: 'barrier' | 'insight' | 'vice' | 'culture', n: number, sourced: boolean, companyId: string | null = null): Card {
  return { id: `crd_${type}_${n}${sourced ? '' : '_x'}`, deckId: DECK_CARDS, companyId, cardType: type, title: type === 'vice' ? null : `Existing ${type} ${n}`,
    summary: type === 'vice' ? null : `Existing ${type} ${n} summary.`, tier: null, tierReason: null, keyPoints: [], createdAt: '2026-10-01T00:00:00.000Z',
    citations: sourced && type !== 'vice' ? [{ title: 'Source', url: `https://example.org/${type}/${n}`, credibility: 'reputable_secondary' }] : [] } as unknown as Card;
}

interface SetupOptions {
  structure?: (prompt: string) => unknown;
  groundFails?: number;
  groundError?: () => Error;
  /** Cards the deck already holds. */
  cards?: Card[];
  viceClaims?: Array<{ cardId: string; sourceUrl: string }>;
  savedCardIds?: string[];
  mutate?: (snapshot: RepoSnapshot) => void;
}

function setup(options: SetupOptions = {}) {
  let saved = { ...completenessFixture(), viceClaims: [], reports: [], briefings: [], savedCards: [],
    opportunity: {}, researchJobs: [], threads: [] } as unknown as RepoSnapshot;
  // Start from a deck with no signal cards at all, unless the test gives it some.
  saved.cards = saved.cards.filter((card) => !SIGNAL_TYPES.includes(card.cardType)).concat(options.cards ?? []);
  saved.viceClaims = (options.viceClaims ?? []).map((claim, i) => ({ id: `vc_${i}`, claimText: 'Existing claim.', sourceTitle: 'Source', ...claim })) as unknown as RepoSnapshot['viceClaims'];
  saved.savedCards = (options.savedCardIds ?? []).map((cardId) => ({ id: `sv_${cardId}`, cardId, savedAt: '2026-10-01T00:00:00.000Z' })) as unknown as RepoSnapshot['savedCards'];
  options.mutate?.(saved);
  let failures = options.groundFails ?? 0;
  const ground = vi.fn(async (prompt: string, _opts?: unknown): Promise<{ text: string; citations: typeof SOURCES; queries: string[]; grounding?: typeof ROSTER_GROUNDING }> => {
    if (failures > 0) { failures -= 1; throw (options.groundError ? options.groundError() : Object.assign(new Error('Gemini 503: request failed.'), { status: 503 })); }
    return { text: 'notes', citations: SOURCES, queries: ['q'], grounding: /RISKS|CULTURE/.test(prompt) ? ROSTER_GROUNDING : MARKET_GROUNDING };
  });
  const structure = vi.fn(async (prompt: string, schema: ZodType<unknown>) =>
    schema.parse((options.structure ?? ((p: string) => (p.includes('"risks"') ? ROSTER_ANSWER : MARKET_ANSWER)))(prompt)));
  const store = { read: () => structuredClone(saved), write: async (next: RepoSnapshot) => { saved = structuredClone(next); } };
  const make = (client: LlmClient = { ground, structure } as unknown as LlmClient) =>
    new GeminiRepository({ apiKey: 'test', client, groundedRpm: 0, dashboardWarmup: false, store });
  const repo = make();
  const countsOf = () => saved.cards.filter((c) => c.deckId === DECK_CARDS).reduce<Record<string, number>>((a, c) => { a[c.cardType] = (a[c.cardType] ?? 0) + 1; return a; }, {});
  return { repo, make, ground, structure, saved: () => saved, countsOf };
}

const NONE = { barrier: 0, insight: 0, vice: 0, culture: 0 };

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

  it('does nothing, and pays for nothing, for a deck that has just been searched, even for a kind that stayed short', async () => {
    const { repo, ground } = setup();
    await repo.ensureSignalCards('deck_fx');
    ground.mockClear();
    // Culture stopped at two (a market rarely documents more): it rests, it is not asked for on every open.
    const again = await repo.ensureSignalCards('deck_fx');
    expect(again.added).toEqual(NONE);
    expect(ground).not.toHaveBeenCalled();
  });

  it('asks again, for the short kind only, once its rest is over', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    const { repo, ground } = setup();
    await repo.ensureSignalCards('deck_fx');
    ground.mockClear();
    vi.setSystemTime(Date.now() + 4 * 24 * 60 * 60 * 1000);
    await repo.ensureSignalCards('deck_fx');
    expect(ground.mock.calls.length).toBe(1);
    expect(ground.mock.calls.every((call) => !/BARRIERS/.test(String(call[0])))).toBe(true);
  });

  it('searches for every kind when asked to, and never files the same company or the same title twice', async () => {
    const { repo, ground, countsOf } = setup();
    await repo.ensureSignalCards('deck_fx');
    ground.mockClear();
    const again = await repo.ensureSignalCards('deck_fx', { force: true });
    expect(ground.mock.calls.length).toBe(2); // the market search and the roster search
    expect(again.added).toEqual(NONE);
    expect(countsOf()).toMatchObject({ barrier: 5, insight: 5, vice: 3, culture: 2 });
  });

  it('does not search for a kind that is already full, even when asked to', async () => {
    const full = ['barrier', 'insight', 'culture'].flatMap((type) => [...Array(10).keys()].map((n) => signalCard(type as 'barrier', n, true, type === 'culture' ? 'acme' : null)));
    const vice = [...Array(10).keys()].map((n) => signalCard('vice', n, true, 'acme'));
    const { repo, ground } = setup({ cards: [...full, ...vice], viceClaims: vice.map((card) => ({ cardId: card.id, sourceUrl: `https://example.org/${card.id}` })) });
    const result = await repo.ensureSignalCards('deck_fx', { force: true });
    expect(ground).not.toHaveBeenCalled();
    expect(result).toEqual({ added: NONE, failed: false, failedKinds: [] });
  });

  it('counts only sourced cards: unsourced ones neither fill the minimum nor keep a sourced one out', async () => {
    const culture = ['acme', 'gamma'].map((id, n) => signalCard('culture', n, false, id));
    const barriers = [0, 1, 2, 3].map((n) => signalCard('barrier', n, false));
    const { repo, saved, countsOf } = setup({ cards: [...culture, ...barriers] });
    const result = await repo.ensureSignalCards('deck_fx');
    // Four unsourced barriers would have looked like "enough" and been left; two unsourced culture cards held their companies.
    expect(result.added).toMatchObject({ barrier: 5, culture: 2 });
    expect(saved().cards.filter((c) => c.cardType === 'culture' && !c.citations.length)).toEqual([]);
    expect(countsOf().culture).toBe(2);
    // An unsourced barrier is replaced only by a sourced one that says the same thing (same title); the rest stay.
    expect(saved().cards.filter((c) => c.cardType === 'barrier' && !c.citations.length)).toHaveLength(4);
  });

  it('replaces an unsourced barrier by a sourced card with the same title', async () => {
    const same = { ...signalCard('barrier', 1, false), title: 'Barrier number 1 in this market' };
    const { repo, saved } = setup({ cards: [same] });
    await repo.ensureSignalCards('deck_fx');
    expect(saved().cards.find((c) => c.id === same.id)).toBeUndefined();
    expect(saved().cards.filter((c) => c.title === 'Barrier number 1 in this market' && c.citations.length > 0)).toHaveLength(1);
  });

  it('keeps an unsourced card that nothing sourced replaces, and one the user saved', async () => {
    const stays = signalCard('culture', 9, false, 'beta');
    const saved = signalCard('culture', 7, false, 'acme');
    const { repo, saved: snapshot } = setup({ cards: [stays, saved], savedCardIds: [saved.id] });
    await repo.ensureSignalCards('deck_fx');
    const ids = snapshot().cards.map((c) => c.id);
    expect(ids).toContain(stays.id);
    expect(ids).toContain(saved.id);
  });

  it('counts a vice card by its sourced claims', async () => {
    const withClaim = signalCard('vice', 1, true, 'acme');
    const without = signalCard('vice', 2, true, 'gamma');
    const { repo, saved } = setup({ cards: [withClaim, without], viceClaims: [{ cardId: withClaim.id, sourceUrl: 'https://www.reuters.com/x' }, { cardId: without.id, sourceUrl: '' }] });
    await repo.ensureSignalCards('deck_fx');
    // Gamma's card had no sourced claim, so a sourced one for Gamma was filed in its place.
    expect(saved().cards.find((c) => c.id === without.id)).toBeUndefined();
    expect(saved().cards.some((c) => c.cardType === 'vice' && c.companyId === 'gamma')).toBe(true);
  });

  it('pays for the insight fallback only when insight cards are wanted', async () => {
    const insights = [0, 1, 2, 3].map((n) => signalCard('insight', n, true));
    const full = [...['vice', 'culture'].flatMap((type) => [0, 1, 2, 3].map((n) => signalCard(type as 'vice', n, true, 'acme')))];
    const { repo, ground } = setup({
      cards: [...insights, ...full],
      viceClaims: full.filter((c) => c.cardType === 'vice').map((c) => ({ cardId: c.id, sourceUrl: `https://example.org/${c.id}` })),
      // The first pass names five barriers and one insight: insights would be below the minimum, but they are not wanted.
      structure: (prompt) => (prompt.includes('"risks"') ? ROSTER_ANSWER : { barriers: MARKET_ANSWER.barriers, insights: MARKET_ANSWER.insights.slice(0, 1) }),
    });
    const result = await repo.ensureSignalCards('deck_fx');
    expect(result.added.barrier).toBe(5);
    expect(ground.mock.calls.length).toBe(1);
  });

  it('tries a search that errors for a passing reason once more, and reports a failure instead of an empty deck as done', async () => {
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
    expect(result.failedKinds).toEqual(['barrier', 'insight', 'vice', 'culture']);
    expect(result.added).toEqual(NONE);
    expect(dead.countsOf().barrier).toBeUndefined();
  });

  it('does not search again for an error that would only repeat (a rejected key, a spent quota, output that never parsed)', async () => {
    const quota = setup({ groundFails: 99, groundError: () => Object.assign(new Error('Gemini quota exhausted'), { status: 402 }) });
    const result = await quota.repo.ensureSignalCards('deck_fx');
    expect(result.failed).toBe(true);
    expect(quota.ground.mock.calls.length).toBe(2); // one try per search, not two

    const unparsable = setup({ structure: () => { throw new Error('Gemini returned invalid research data after two attempts.'); } });
    const bad = await unparsable.repo.ensureSignalCards('deck_fx');
    expect(bad.failed).toBe(true);
    expect(unparsable.ground.mock.calls.length).toBe(2);
  });

  it('after an error, tries again on a later open, not on every open', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    const dead = setup({ groundFails: 2, groundError: () => Object.assign(new Error('Gemini 400'), { status: 400 }) });
    expect((await dead.repo.ensureSignalCards('deck_fx')).failed).toBe(true);
    dead.ground.mockClear();
    await dead.repo.ensureSignalCards('deck_fx');
    expect(dead.ground).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    const later = await dead.repo.ensureSignalCards('deck_fx');
    expect(later.failed).toBe(false);
    expect(dead.countsOf().barrier).toBe(5);
  });

  it('takes the rest before the paid search, so a reload or a second tab does not start another', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = setup();
    first.ground.mockImplementation(async () => { await gate; return { text: 'notes', citations: SOURCES, queries: ['q'] }; });
    const running = first.repo.ensureSignalCards('deck_fx');
    await vi.waitFor(() => expect(first.ground).toHaveBeenCalled());
    // A second repository over the same stored deck, as a reload or another tab would be.
    const other = first.make({ ground: vi.fn(), structure: vi.fn() } as unknown as LlmClient);
    const second = await other.ensureSignalCards('deck_fx');
    expect(second).toEqual({ added: NONE, failed: false, failedKinds: [] });
    release();
    await running;
  });

  it('runs one search per deck at a time: a second ask joins the first', async () => {
    const { repo, ground } = setup();
    const [a, b] = await Promise.all([repo.ensureSignalCards('deck_fx'), repo.ensureSignalCards('deck_fx')]);
    expect(a).toBe(b);
    expect(ground.mock.calls.length).toBe(2);
  });

  it('a forced ask that arrives during an unforced search runs after it, instead of being dropped', async () => {
    const { repo, ground } = setup();
    const unforced = repo.ensureSignalCards('deck_fx');
    const forced = repo.ensureSignalCards('deck_fx', { force: true });
    expect(forced).not.toBe(unforced);
    await Promise.all([unforced, forced]);
    expect(ground.mock.calls.length).toBe(4); // the first run's two searches, and the forced run's two
  });

  it('keeps and announces what it found when the run is cut short', async () => {
    const controller = new AbortController();
    const { repo, saved, ground } = setup();
    const events: string[][] = [];
    repo.subscribeDeckRefresh((event) => events.push(event.addedCardIds));
    ground.mockImplementation(async (_prompt: string, opts?: unknown) => {
      if ((opts as { label?: string } | undefined)?.label === 'signal:roster') { controller.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }
      return { text: 'notes', citations: SOURCES, queries: ['q'] };
    });
    await expect(repo.ensureSignalCards('deck_fx', { signal: controller.signal })).rejects.toThrow();
    expect(saved().cards.filter((c) => c.cardType === 'barrier')).toHaveLength(5);
    expect(events.flat()).toHaveLength(10);
  });

  it('works for a market stored without a scope', async () => {
    const { repo, countsOf } = setup({ mutate: (snapshot) => { delete (snapshot.markets[0] as { scopeDefinition?: unknown }).scopeDefinition; } });
    await repo.ensureSignalCards('deck_fx');
    expect(countsOf().barrier).toBe(5);
  });

  it('an honest empty answer adds nothing and is not a failure', async () => {
    const { repo, countsOf } = setup({ structure: (prompt) => (prompt.includes('"risks"') ? { risks: [], culture: [] } : { barriers: [], insights: [] }) });
    const result = await repo.ensureSignalCards('deck_fx');
    expect(result).toEqual({ added: NONE, failed: false, failedKinds: [] });
    expect(countsOf().vice).toBeUndefined();
  });

  it('an unknown deck is a no-op', async () => {
    const { repo, ground } = setup();
    expect(await repo.ensureSignalCards('deck_nope')).toEqual({ added: NONE, failed: false, failedKinds: [] });
    expect(ground).not.toHaveBeenCalled();
  });
});

describe('an allegation without a source never leaves the repository', () => {
  it('is dropped from the card, the claim list and a share', async () => {
    const card = signalCard('vice', 1, true, 'acme');
    const { repo } = setup({ cards: [card], viceClaims: [
      { cardId: card.id, sourceUrl: '' },
      { cardId: card.id, sourceUrl: 'javascript:alert(1)' },
      { cardId: card.id, sourceUrl: 'https://www.reuters.com/real' },
    ] });
    expect((await repo.getViceClaims(card.id)).map((claim) => claim.sourceUrl)).toEqual(['https://www.reuters.com/real']);
    expect((await repo.getCard(card.id))!.viceClaims.map((claim) => claim.sourceUrl)).toEqual(['https://www.reuters.com/real']);
    const shared = await repo.exportShareSnapshot({ deckId: DECK_CARDS });
    expect(shared.viceClaims.map((claim) => claim.sourceUrl)).toEqual(['https://www.reuters.com/real']);
  });
});

describe('a search is stopped, cut short or given odd data without leaving a mess', () => {
  it('deleting a deck while its search runs leaves no card, claim or rest behind, even when the search ends afterwards', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const { repo, ground, saved } = setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = ground.getMockImplementation()!;
    ground.mockImplementation(async (prompt: string, opts?: unknown) => { await gate; return original(prompt, opts); });
    const running = repo.ensureSignalCards('deck_fx');
    await vi.advanceTimersByTimeAsync(50);
    expect(ground).toHaveBeenCalled();
    const deleting = repo.deleteDeck('deck_fx');
    // The delete waits a bounded while for the search, then goes ahead: the search is still hanging at this point.
    await vi.advanceTimersByTimeAsync(16_000);
    expect(await deleting).toBe(true);
    release();
    await running.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(100);
    expect(saved().cards.filter((c) => c.deckId === 'deck_fx')).toEqual([]);
    expect(saved().viceClaims).toEqual([]);
    expect(saved().signalRest?.deck_fx).toBeUndefined();
  });

  it('a search stopped before it began does not rest the kinds it never searched', async () => {
    const { repo, ground, countsOf } = setup();
    const stopped = new AbortController();
    stopped.abort();
    await expect(repo.ensureSignalCards('deck_fx', { signal: stopped.signal })).rejects.toThrow();
    expect(ground).not.toHaveBeenCalled();
    // The next ask searches: nothing was rested.
    const result = await repo.ensureSignalCards('deck_fx');
    expect(result.added.barrier).toBe(5);
    expect(countsOf().barrier).toBe(5);
  });

  it('a rest stored far in the future (a wrong clock, an imported file) is not honoured past the longest rest', async () => {
    const future = { barrier: '2099-01-01T00:00:00.000Z', insight: '9999-12-31T00:00:00.000Z', vice: '2099-06-01T00:00:00.000Z', culture: '2200-01-01T00:00:00.000Z' };
    const { repo, ground } = setup({ mutate: (snapshot) => { snapshot.signalRest = { deck_fx: future }; } });
    await repo.ensureSignalCards('deck_fx');
    expect(ground.mock.calls.length).toBe(2);
  });

  it('a recorded market plan that is not a plan is ignored, and the market’s own scope is used', async () => {
    const { repo, ground } = setup({ mutate: (snapshot) => { snapshot.researchJobs = [{ id: 'job_odd', deck: { id: 'deck_fx' }, marketPlan: 'not a plan' }] as unknown as RepoSnapshot['researchJobs']; } });
    await repo.ensureSignalCards('deck_fx');
    const prompt = String(ground.mock.calls[0]![0]);
    expect(prompt).toContain('Fixture Robotics');
    expect(prompt).not.toContain('undefined');
  });
});
