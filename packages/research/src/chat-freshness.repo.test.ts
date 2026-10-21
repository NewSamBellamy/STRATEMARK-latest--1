/**
 * The 14-day rule: stored research older than 14 days is never served as a current answer. The question is searched
 * afresh, and the old notes only ride along as dated context. Fakes only; no live key.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot, type ResearchStore } from './repository';
import { isFreshPassage, MEMORY_MAX_AGE_DAYS } from './chat-route';
import type { LlmClient } from './types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date().toISOString();
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const SRC = [{ url: 'https://stored.example/one', title: 'One' }, { url: 'https://stored.example/two', title: 'Two' }];
const NOTES = [
  'Acme raised $40M in a Series B funding round in 2025.',
  'Acme funding investors include Foundry and Northline.',
  'Acme funding history: a seed round and the Series B.',
];

function setup(ages: number[]) {
  const base = migrateSnapshot(null).snapshot;
  const company = { id: 'cmp_a', name: 'Acme', oneLiner: 'Acme makes things.', websiteUrl: 'https://cmp_a.example', logoUrl: null, hqLocation: null, brandTheme: null };
  const seeded = {
    ...base,
    markets: [{ id: 'mkt_1', name: 'Anvils', scopeDefinition: { vertical: 'Anvils' }, refreshCadence: 'weekly', createdAt: NOW }],
    decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: NOW, lastRefreshedAt: NOW }],
    companies: [company],
    cards: [{ id: 'card_a', deckId: 'deck_1', companyId: 'cmp_a', cardType: 'company', tier: 3, title: 'Acme', summary: 'A card.', keyPoints: [], citations: [], createdAt: NOW, updatedAt: NOW, hunted: false }],
    researchEvidence: ages.map((age, i) => ({
      id: `ev_${i}`, companyId: 'cmp_a', companyName: 'Acme', topic: 'funding', capturedAt: ago(age), text: NOTES[i]!, citations: [SRC[i % 2]!], queries: [],
    })),
  } as unknown as RepoSnapshot;
  const ground = vi.fn(async (_p: string, _o?: unknown) => ({ text: 'Acme has not announced a new round.', citations: [], queries: ['acme funding'] }));
  const structure = vi.fn(async (_p: string, _s: unknown, _o?: unknown) => ({ answerable: true, answer: 'Acme raised $40M in 2025.', passageIds: ['A1'] }));
  let data = seeded;
  const store: ResearchStore = { read: () => data, write: (s: RepoSnapshot) => { data = structuredClone(s); } };
  const repository = new GeminiRepository({ apiKey: 'k', store, client: { ground, structure } as unknown as LlmClient, dashboardWarmup: false });
  return { repository, ground, structure };
}
const scope = { kind: 'cards' as const, deckId: 'deck_1', cardIds: ['card_a'] };
const Q = 'How much funding has Acme raised?';

describe('isFreshPassage', () => {
  it('is fresh up to 14 days, stale after, and never fresh without a readable or sane date', () => {
    const now = new Date('2026-10-20T00:00:00.000Z');
    expect(MEMORY_MAX_AGE_DAYS).toBe(14);
    expect(isFreshPassage({ capturedAt: '2026-10-07T00:00:00.000Z' }, now)).toBe(true);
    expect(isFreshPassage({ capturedAt: '2026-10-05T00:00:00.000Z' }, now)).toBe(false);
    expect(isFreshPassage({}, now)).toBe(false);
    expect(isFreshPassage({ capturedAt: 'yesterday-ish' }, now)).toBe(false);
    expect(isFreshPassage({ capturedAt: '2099-01-01T00:00:00.000Z' }, now)).toBe(false);
  });
});

describe('askResearch and the 14-day rule', () => {
  it('searches afresh when every stored passage is older than 14 days, with the old notes as dated context', async () => {
    const { repository, ground, structure } = setup([20, 30, 40]);
    const t = await repository.askResearch!({ question: Q, scope });
    expect(structure).not.toHaveBeenCalled();
    expect(ground).toHaveBeenCalledTimes(1);
    expect(t.messages[t.messages.length - 1]!.origin).toBe('fresh');
    expect(ground.mock.calls[0]![0]).toMatch(/captured \d{4}-\d{2}-\d{2}/);
  });

  it('does not let one fresh passage plus stale ones stand in for a search', async () => {
    const { repository, ground, structure } = setup([1, 30, 40]);
    await repository.askResearch!({ question: Q, scope });
    expect(structure).not.toHaveBeenCalled();
    expect(ground).toHaveBeenCalledTimes(1);
  });

  it('still answers from memory when two or more relevant passages are recent', async () => {
    const { repository, ground, structure } = setup([1, 5, 40]);
    const t = await repository.askResearch!({ question: Q, scope });
    expect(ground).not.toHaveBeenCalled();
    expect(structure).toHaveBeenCalledTimes(1);
    expect(t.messages[t.messages.length - 1]!.origin).toBe('memory');
    // The stale passage is not offered to the memory call.
    expect(String(structure.mock.calls[0]![0]).split('STORED RESEARCH')[1]).not.toContain('a seed round and the Series B');
  });
});
