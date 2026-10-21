/**
 * askResearch routing: answer from what the card already knows, search only when needed, never search for a greeting.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

const NOW = new Date().toISOString();
const SRC = [{ url: 'https://stored.example/one', title: 'One' }, { url: 'https://stored.example/two', title: 'Two' }];

function seed(passages: number): RepoSnapshot {
  const base = migrateSnapshot(null).snapshot;
  const company = (id: string, name: string) => ({ id, name, oneLiner: `${name} makes things.`, websiteUrl: `https://${id}.example`, logoUrl: null, hqLocation: null, brandTheme: null });
  const card = (id: string, companyId: string, name: string) => ({
    id, deckId: 'deck_1', companyId, cardType: 'company', tier: 3, title: name, summary: 'A card.', keyPoints: [], citations: [], createdAt: NOW, updatedAt: NOW, hunted: false,
  });
  const notes = [
    'Acme raised $40M in a Series B funding round in 2025.',
    'Acme funding investors include Foundry and Northline.',
    'Acme funding history: a seed round and the Series B.',
  ];
  return {
    ...base,
    markets: [{ id: 'mkt_1', name: 'Anvils', scopeDefinition: { vertical: 'Anvils' }, refreshCadence: 'weekly', createdAt: NOW }],
    decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: NOW, lastRefreshedAt: NOW }],
    companies: [company('cmp_a', 'Acme'), company('cmp_b', 'Beta Corp')],
    cards: [card('card_a', 'cmp_a', 'Acme'), card('card_b', 'cmp_b', 'Beta Corp')],
    researchEvidence: notes.slice(0, passages).map((text, i) => ({
      id: `ev_${i}`, companyId: 'cmp_a', companyName: 'Acme', topic: 'funding', capturedAt: NOW, text, citations: [SRC[i % 2]!], queries: [],
    })),
  } as unknown as RepoSnapshot;
}

const FRESH_TEXT = 'Acme opened a new plant in Austin in 2026. I would watch their hiring.\n\nFollow-ups: a | b';
function setup(passages: number, structured: unknown = { answerable: false, answer: '', passageIds: [] }) {
  const grounding = {
    provider: 'google-search', answerText: FRESH_TEXT,
    supports: [{ supportIndex: 0, text: 'Acme opened a new plant in Austin in 2026.', sources: [{ url: 'https://fresh.example/plant', title: 'Plant' }] }],
  };
  const ground = vi.fn(async (_p: string, _o?: { priority?: string; label?: string }) => ({ text: FRESH_TEXT, citations: [], queries: ['acme plant'], grounding }));
  const structure = vi.fn(async (_p: string, _s: unknown, _o?: unknown) => structured);
  const client = { ground, structure } as unknown as LlmClient;
  let data = seed(passages);
  const store: ResearchStore = { read: () => data, write: (s: RepoSnapshot) => { data = structuredClone(s); } };
  const repository = new GeminiRepository({ apiKey: 'k', store, client, dashboardWarmup: false });
  return { repository, ground, structure, snap: () => data };
}
const scope = { kind: 'cards' as const, deckId: 'deck_1', cardIds: ['card_a'] };
const lastMsg = (t: { messages: Array<{ role: string; text: string; citations: Array<{ url: string }>; origin?: string }> }) => t.messages[t.messages.length - 1]!;

describe('askResearch routing', () => {
  it('answers from stored research with no grounded call, citing only stored URLs', async () => {
    const { repository, ground, structure } = setup(3, { answerable: true, answer: 'Acme raised $40M in 2025. See https://evil.example/x.', passageIds: ['A1'] });
    const t = await repository.askResearch!({ question: 'How much funding has Acme raised?', scope });
    expect(ground).not.toHaveBeenCalled();
    expect(structure).toHaveBeenCalledTimes(1);
    const m = lastMsg(t);
    expect(m.origin).toBe('memory');
    expect(m.text).toContain('$40M');
    expect(m.text).not.toContain('evil.example');
    expect(m.citations.length).toBeGreaterThan(0);
    expect(m.citations.every((c) => c.url.startsWith('https://stored.example/'))).toBe(true);
  });

  it('ignores a URL the model puts in passageIds or text for its sources', async () => {
    const { repository } = setup(3, { answerable: true, answer: 'Acme raised $40M.', passageIds: ['https://evil.example/x', 'A1'] });
    const m = lastMsg(await repository.askResearch!({ question: 'How much funding has Acme raised?', scope }));
    expect(m.citations.map((c) => c.url).every((u) => u.startsWith('https://stored.example/'))).toBe(true);
  });

  it('removes a figure the named passages do not state', async () => {
    const { repository } = setup(3, { answerable: true, answer: 'Acme raised $40M in 2025. Its valuation is $900M.', passageIds: ['A1'] });
    const m = lastMsg(await repository.askResearch!({ question: 'How much funding has Acme raised?', scope }));
    expect(m.text).toContain('$40M');
    expect(m.text).not.toContain('$900M');
  });

  it('goes fresh for "latest news on Acme" even with passages on file', async () => {
    const { repository, ground, structure } = setup(3);
    const m = lastMsg(await repository.askResearch!({ question: 'latest news on Acme', scope }));
    expect(ground).toHaveBeenCalledTimes(1);
    expect(structure).not.toHaveBeenCalled();
    expect(m.origin).toBe('fresh');
  });

  it('goes fresh when fewer than two relevant passages are stored, and when asked to search again', async () => {
    const few = setup(1);
    await few.repository.askResearch!({ question: 'How much funding has Acme raised?', scope });
    expect(few.ground).toHaveBeenCalledTimes(1);
    expect(few.structure).not.toHaveBeenCalled();
    const again = setup(3);
    await again.repository.askResearch!({ question: 'How much funding has Acme raised?', scope, fresh: true });
    expect(again.ground).toHaveBeenCalledTimes(1);
  });

  it('puts the fresh call on the urgent lane and the answer length in the prompt', async () => {
    const { repository, ground } = setup(0);
    await repository.askResearch!({ question: 'Who is winning?', scope });
    const [prompt, opts] = ground.mock.calls[0]!;
    expect(opts?.priority).toBe('urgent');
    expect(prompt).toContain('ANSWER LENGTH:');
  });

  it('makes no grounded call and no search for a greeting, and answers briefly', async () => {
    const { repository, ground, structure } = setup(3, { reply: 'Hey! What should we dig into?' });
    const t = await repository.askResearch!({ question: 'hey, whats up', scope });
    expect(ground).not.toHaveBeenCalled();
    expect(structure).toHaveBeenCalledTimes(1);
    expect(structure.mock.calls[0]![0]).toContain('ANSWER LENGTH: brief');
    expect(lastMsg(t).text).toBe('Hey! What should we dig into?');
    expect(lastMsg(t).citations).toEqual([]);
  });

  it('falls through to exactly one grounded call when memory cannot answer, with the length line', async () => {
    const { repository, ground, structure } = setup(3);
    const m = lastMsg(await repository.askResearch!({ question: 'How much funding has Acme raised?', scope }));
    expect(structure).toHaveBeenCalledTimes(1);
    expect(structure.mock.calls[0]![0]).toContain('ANSWER LENGTH:');
    expect(ground).toHaveBeenCalledTimes(1);
    expect(ground.mock.calls[0]![1]?.priority).toBe('urgent');
    expect(m.origin).toBe('fresh');
  });

  it('records the fresh answer attributed sentence for its company', async () => {
    const { repository, snap } = setup(0);
    const t = await repository.askResearch!({ question: 'Who is winning?', scope });
    const kept = (snap().researchEvidence ?? []).filter((e) => e.topic === `chat:${t.id}`);
    expect(kept.map((e) => [e.companyId, e.text, e.cardId])).toEqual([['cmp_a', 'Acme opened a new plant in Austin in 2026.', 'card_a']]);
    expect(kept[0]!.citations.map((c) => c.url)).toEqual(['https://fresh.example/plant']);
  });
});
