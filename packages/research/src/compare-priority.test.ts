/**
 * "Compare is slow before research finishes": a compare asked while a deck's bulk research is queued or running is served
 * ahead of it on every pacing lane that has a priority, reads what the lined-up cards already have on file instead of
 * searching it again, and keeps what it finds on every card it names.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createGeminiClient } from './gemini';
import { withSearchFallback } from './search-fallback';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';
import type { DeckRefreshEvent } from '@mi/contracts';

const NOW = new Date().toISOString();
const QUESTION = 'Compare these 2 head-to-head: where each is stronger, where the research has gaps, and who you would back.';

describe('the model gate serves a compare ahead of a deck\'s bulk research', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const answer = (text: string) => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/a', title: 'A' } }] } }],
  }), { status: 200 });

  function gate(kind: 'ground' | 'structure') {
    const dispatched: string[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
      dispatched.push(body.contents[0]!.parts[0]!.text.split('\n')[0]!);
      return answer(kind === 'structure' ? '{"ok":true}' : 'fine');
    }) as unknown as typeof fetch;
    // chatModel '' keeps the compare on the grounded line, which is the line deck research uses.
    const client = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl, groundedRpm: 10, structureRpm: 10, chatModel: '' });
    return { client, dispatched };
  }

  it('grounded lane: a compare asked while bulk calls fill the window is dispatched at once, not a minute later', async () => {
    const { client, dispatched } = gate('ground');
    for (let n = 1; n <= 14; n += 1) void client.ground(`bulk-${n}`, { label: 'tab:history' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(dispatched).toHaveLength(9);
    void client.ground('compare', { label: 'chat', priority: 'urgent' });
    await vi.advanceTimersByTimeAsync(10);
    expect(dispatched).toContain('compare');
    expect(dispatched.filter((p) => p.startsWith('bulk')).length).toBe(9);
  });

  it('structure lane (answering from what is on file): same', async () => {
    const { client, dispatched } = gate('structure');
    const schema = z.object({ ok: z.boolean() });
    for (let n = 1; n <= 14; n += 1) void client.structure(`bulk-${n}`, schema, { label: 'tab:history' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(dispatched).toHaveLength(9);
    void client.structure('compare', schema, { label: 'chat:memory', priority: 'urgent' });
    await vi.advanceTimersByTimeAsync(10);
    expect(dispatched).toContain('compare');
  });

  it('search-fallback lane: when grounding is spent, the compare\'s own helper calls keep the urgent priority', async () => {
    const structurePriorities: Array<string | undefined> = [];
    const base = {
      ground: vi.fn(async () => { throw Object.assign(new Error('quota'), { status: 402 }); }),
      structure: vi.fn(async (_p: string, _s: unknown, opts?: { priority?: string }) => {
        structurePriorities.push(opts?.priority);
        return structurePriorities.length === 1 ? { query: 'acme beta compare' } : { text: 'Acme and Beta Corp differ.', quotes: [] };
      }),
    } as unknown as LlmClient;
    const search = vi.fn(async () => [{ title: 'T', url: 'https://example.com/r', snippet: 'Acme and Beta Corp differ.' }]);
    const client = withSearchFallback(base, () => [search]);
    await client.ground('compare', { label: 'chat', priority: 'urgent' });
    expect(structurePriorities).toEqual(['urgent', 'urgent']);
  });
});

function seed(evidenceFor: Array<'cmp_a' | 'cmp_b'>): RepoSnapshot {
  const base = migrateSnapshot(null).snapshot;
  const company = (id: string, name: string) => ({ id, name, oneLiner: `${name} makes things.`, websiteUrl: `https://${id}.example`, logoUrl: null, hqLocation: null, brandTheme: null });
  const card = (id: string, companyId: string, name: string) => ({
    id, deckId: 'deck_1', companyId, cardType: 'company', tier: 3, title: name, summary: 'A card.', keyPoints: [], citations: [], createdAt: NOW, updatedAt: NOW, hunted: false,
  });
  const notes: Record<string, { name: string; text: string; url: string }> = {
    cmp_a: { name: 'Acme', text: 'Acme raised $40M in a Series B round in 2025.', url: 'https://stored.example/acme' },
    cmp_b: { name: 'Beta Corp', text: 'Beta Corp raised $12M in a seed round in 2024.', url: 'https://stored.example/beta' },
  };
  return {
    ...base,
    markets: [{ id: 'mkt_1', name: 'Anvils', scopeDefinition: { vertical: 'Anvils' }, refreshCadence: 'weekly', createdAt: NOW }],
    decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: NOW, lastRefreshedAt: NOW }],
    companies: [company('cmp_a', 'Acme'), company('cmp_b', 'Beta Corp')],
    cards: [card('card_a', 'cmp_a', 'Acme'), card('card_b', 'cmp_b', 'Beta Corp')],
    researchEvidence: evidenceFor.map((id, i) => ({
      id: `ev_${i}`, companyId: id, companyName: notes[id]!.name, topic: 'funding', capturedAt: NOW, text: notes[id]!.text,
      citations: [{ url: notes[id]!.url, title: notes[id]!.name }], queries: [],
    })),
  } as unknown as RepoSnapshot;
}

const FRESH = 'Acme opened a new plant in Austin in 2026. Beta Corp hired a new finance chief in 2026.\n\nFollow-ups: a | b';
function setup(evidenceFor: Array<'cmp_a' | 'cmp_b'>, structured: unknown = { answerable: false, answer: '', passageIds: [] }) {
  const grounding = {
    provider: 'google-search', answerText: FRESH,
    supports: [
      { supportIndex: 0, text: 'Acme opened a new plant in Austin in 2026.', sources: [{ url: 'https://fresh.example/plant', title: 'Plant' }] },
      { supportIndex: 1, text: 'Beta Corp hired a new finance chief in 2026.', sources: [{ url: 'https://fresh.example/cfo', title: 'CFO' }] },
    ],
  };
  const ground = vi.fn(async (_p: string, _o?: { priority?: string; label?: string }) => ({ text: FRESH, citations: [], queries: ['acme beta'], grounding }));
  const structure = vi.fn(async (_p: string, _s: unknown, _o?: { priority?: string }) => structured);
  const client = { ground, structure } as unknown as LlmClient;
  let data = seed(evidenceFor);
  const store: ResearchStore = { read: () => data, write: (s: RepoSnapshot) => { data = structuredClone(s); } };
  const repository = new GeminiRepository({ apiKey: 'k', store, client, dashboardWarmup: false });
  const events: DeckRefreshEvent[] = [];
  repository.subscribeDeckRefresh((e) => events.push(e));
  return { repository, ground, structure, events, snap: () => data };
}
const scope = { kind: 'cards' as const, deckId: 'deck_1', cardIds: ['card_a', 'card_b'] };

describe('a compare reads what the lined-up cards already have on file', () => {
  it('answers a generic head-to-head from each card\'s stored research with no search, on the urgent lane', async () => {
    const { repository, ground, structure } = setup(['cmp_a', 'cmp_b'],
      { answerable: true, answer: 'Acme raised $40M in 2025; Beta Corp raised $12M in 2024.', passageIds: ['A1', 'A2'] });
    const t = await repository.askResearch!({ question: QUESTION, scope });
    expect(ground).not.toHaveBeenCalled();
    expect(structure).toHaveBeenCalledTimes(1);
    expect(structure.mock.calls[0]![2]).toMatchObject({ priority: 'urgent' });
    // Both companies' notes were handed to the model, not just the better-matching one.
    expect(structure.mock.calls[0]![0]).toContain('$40M');
    expect(structure.mock.calls[0]![0]).toContain('$12M');
    const m = t.messages.at(-1)!;
    expect(m.origin).toBe('memory');
    expect(m.citations.map((c) => c.url).sort()).toEqual(['https://stored.example/acme', 'https://stored.example/beta']);
  });

  it('searches, urgently, when one lined-up card has nothing on file yet, and still hands over what the other has', async () => {
    const { repository, ground, structure } = setup(['cmp_a']);
    await repository.askResearch!({ question: QUESTION, scope });
    expect(structure).not.toHaveBeenCalled();
    expect(ground).toHaveBeenCalledTimes(1);
    expect(ground.mock.calls[0]![1]).toMatchObject({ priority: 'urgent', label: 'chat' });
    expect(ground.mock.calls[0]![0]).toContain('$40M');
  });

  it('keeps what a mid-research compare finds on EACH selected card, and tells open views', async () => {
    const { repository, events, snap } = setup(['cmp_a']);
    const t = await repository.askResearch!({ question: QUESTION, scope });
    const kept = (snap().researchEvidence ?? []).filter((e) => e.topic === `chat:${t.id}`);
    expect(kept.map((e) => [e.companyId, e.cardId]).sort()).toEqual([['cmp_a', 'card_a'], ['cmp_b', 'card_b']]);
    // Each record carries only its own company's sentence and its own sources.
    expect(kept.find((e) => e.companyId === 'cmp_a')!.text).not.toContain('Beta Corp');
    expect(kept.find((e) => e.companyId === 'cmp_b')!.citations.map((c) => c.url)).toEqual(['https://fresh.example/cfo']);
    // The compare thread is on both cards' memory.
    expect((await repository.getCardMemory!('card_a')).threads.map((x) => x.id)).toContain(t.id);
    expect((await repository.getCardMemory!('card_b')).threads.map((x) => x.id)).toContain(t.id);
    // And the live deck is told which cards changed, so open views re-read them.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ deckId: 'deck_1', marketId: 'mkt_1', addedCardIds: [] });
    expect([...events[0]!.updatedCardIds].sort()).toEqual(['card_a', 'card_b']);
  });

  it('what the compare kept is read back by the next question: the same research is not bought twice', async () => {
    const { repository, ground } = setup(['cmp_a']);
    await repository.askResearch!({ question: QUESTION, scope });
    expect(ground).toHaveBeenCalledTimes(1);
    // Both cards now have notes on file; a second compare of the same cards is answerable from them.
    ground.mockClear();
    const second = setup(['cmp_a', 'cmp_b'], { answerable: true, answer: 'Acme raised $40M in 2025.', passageIds: ['A1'] });
    await second.repository.askResearch!({ question: QUESTION, scope });
    expect(second.ground).not.toHaveBeenCalled();
  });

  it('a single card keeps the old retrieval (no compare handling)', async () => {
    const { repository, ground } = setup(['cmp_a']);
    await repository.askResearch!({ question: QUESTION, scope: { kind: 'cards', deckId: 'deck_1', cardIds: ['card_a'] } });
    expect(ground).toHaveBeenCalledTimes(1);
  });
});
