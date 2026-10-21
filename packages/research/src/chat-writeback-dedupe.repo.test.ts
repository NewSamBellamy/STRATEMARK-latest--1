/**
 * Saving a fresh answer back must not pile up copies of one sentence: copies would count as separate stored passages and let
 * a single finding stand in for the two a memory answer needs. Fakes only; no live key.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

const NOW = new Date().toISOString();
const TEXT = 'Acme opened a new plant in Austin in 2026.';

describe('write-back of a fresh answer', () => {
  it('keeps one record per attributed sentence however often the same answer comes back', async () => {
    const base = migrateSnapshot(null).snapshot;
    let data = {
      ...base,
      markets: [{ id: 'mkt_1', name: 'Anvils', scopeDefinition: { vertical: 'Anvils' }, refreshCadence: 'weekly', createdAt: NOW }],
      decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: NOW, lastRefreshedAt: NOW }],
      companies: [{ id: 'cmp_a', name: 'Acme', oneLiner: 'x', websiteUrl: 'https://a.example', logoUrl: null, hqLocation: null, brandTheme: null }],
      cards: [{ id: 'card_a', deckId: 'deck_1', companyId: 'cmp_a', cardType: 'company', tier: 3, title: 'Acme', summary: 'A card.', keyPoints: [], citations: [], createdAt: NOW, updatedAt: NOW, hunted: false }],
    } as unknown as RepoSnapshot;
    const grounding = { provider: 'google-search', answerText: TEXT, supports: [{ supportIndex: 0, text: TEXT, sources: [{ url: 'https://fresh.example/plant', title: 'Plant' }] }] };
    const ground = vi.fn(async () => ({ text: TEXT, citations: [], queries: ['acme plant'], grounding }));
    const store: ResearchStore = { read: () => data, write: (s: RepoSnapshot) => { data = structuredClone(s); } };
    const repository = new GeminiRepository({ apiKey: 'k', store, client: { ground, structure: vi.fn() } as unknown as LlmClient, dashboardWarmup: false });
    const scope = { kind: 'cards' as const, deckId: 'deck_1', cardIds: ['card_a'] };
    const first = await repository.askResearch!({ question: 'Where does Acme build?', scope, fresh: true });
    await repository.askResearch!({ question: 'Where does Acme build?', scope, threadId: first.id, fresh: true });
    await repository.askResearch!({ question: 'Where does Acme build?', scope, fresh: true });
    const kept = (data.researchEvidence ?? []).filter((e) => e.topic.startsWith('chat:') && e.text === TEXT);
    expect(kept).toHaveLength(1);
  });
});
