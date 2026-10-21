/**
 * A malformed conversation in a workspace (hand-edited, corrupt, or imported) must not take down every other
 * conversation of the card. Fakes only; no live key.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

const NOW = new Date().toISOString();

function setup(extraThreads: unknown[]) {
  const base = migrateSnapshot(null).snapshot;
  const company = { id: 'cmp_a', name: 'Acme', oneLiner: 'Acme makes things.', websiteUrl: 'https://cmp_a.example', logoUrl: null, hqLocation: null, brandTheme: null };
  const good = {
    id: 'thr_ok', scope: { kind: 'cards', deckId: 'deck_1', cardIds: ['card_a'] }, title: 'Good',
    messages: [{ id: 'm1', role: 'user', text: 'hello', citations: [], at: NOW }], reportId: null, createdAt: NOW, updatedAt: NOW,
  };
  const seeded = {
    ...base,
    markets: [{ id: 'mkt_1', name: 'Anvils', scopeDefinition: { vertical: 'Anvils' }, refreshCadence: 'weekly', createdAt: NOW }],
    decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: NOW, lastRefreshedAt: NOW }],
    companies: [company],
    cards: [{ id: 'card_a', deckId: 'deck_1', companyId: 'cmp_a', cardType: 'company', tier: 3, title: 'Acme', summary: 'A card.', keyPoints: [], citations: [], createdAt: NOW, updatedAt: NOW, hunted: false }],
    threads: [good, ...extraThreads],
  } as unknown as RepoSnapshot;
  const structure = vi.fn(async () => ({ reply: 'Hey!' }));
  let data = seeded;
  const store: ResearchStore = { read: () => data, write: (s: RepoSnapshot) => { data = structuredClone(s); } };
  const repository = new GeminiRepository({ apiKey: 'k', store, client: { structure, ground: vi.fn() } as unknown as LlmClient, dashboardWarmup: false });
  return repository;
}

const hostile = [
  { id: 'thr_noscope', title: 'x', messages: [], createdAt: NOW, updatedAt: NOW },
  { id: 'thr_nomsgs', scope: { kind: 'cards', deckId: 'deck_1', cardIds: ['card_a'] }, title: 'y', createdAt: NOW, updatedAt: NOW },
  { id: 'thr_badmsgs', scope: { kind: 'cards', deckId: 'deck_1', cardIds: ['card_a'] }, title: 'z', messages: 'nope', createdAt: NOW, updatedAt: NOW },
];

describe('a malformed stored conversation', () => {
  it('does not break the card memory or the thread list', async () => {
    const repository = setup(hostile);
    const memory = await repository.getCardMemory!('card_a');
    expect(memory.threads.map((t) => t.id)).toEqual(['thr_ok']);
    const listed = await repository.listResearchThreads!({ cardId: 'card_a' });
    expect(listed.map((t) => t.id)).toEqual(['thr_ok']);
  });

  it('does not stop a good conversation from being continued', async () => {
    const repository = setup(hostile);
    const t = await repository.askResearch!({ question: 'hey', threadId: 'thr_ok' });
    expect(t.messages.length).toBe(3);
  });
});
