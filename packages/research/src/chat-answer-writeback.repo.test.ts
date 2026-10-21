import { describe, expect, it, vi } from 'vitest';

vi.mock('./chat-writeback', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), chatEvidenceFromAnswer: () => { throw new Error('recorder down'); } }));

import { GeminiRepository, migrateSnapshot, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

describe('a failing evidence write-back', () => {
  it('never fails the answer', async () => {
    const NOW = new Date().toISOString();
    const base = migrateSnapshot(null).snapshot;
    let data = {
      ...base,
      markets: [{ id: 'mkt_1', name: 'Anvils', scopeDefinition: { vertical: 'Anvils' }, refreshCadence: 'weekly', createdAt: NOW }],
      decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: NOW, lastRefreshedAt: NOW }],
      companies: [{ id: 'cmp_a', name: 'Acme', oneLiner: 'x', websiteUrl: 'https://a.example', logoUrl: null, hqLocation: null, brandTheme: null }],
      cards: [{ id: 'card_a', deckId: 'deck_1', companyId: 'cmp_a', cardType: 'company', tier: 3, title: 'Acme', summary: 'A card.', keyPoints: [], citations: [], createdAt: NOW, updatedAt: NOW, hunted: false }],
    } as unknown as RepoSnapshot;
    const ground = vi.fn(async () => ({ text: 'Acme is steady.', citations: [], queries: [] }));
    const client = { ground, structure: vi.fn() } as unknown as LlmClient;
    const store: ResearchStore = { read: () => data, write: (s: RepoSnapshot) => { data = structuredClone(s); } };
    const repository = new GeminiRepository({ apiKey: 'k', store, client, dashboardWarmup: false });
    const t = await repository.askResearch!({ question: 'Who is winning?', scope: { kind: 'cards', deckId: 'deck_1', cardIds: ['card_a'] } });
    expect(t.messages[t.messages.length - 1]!.text).toBe('Acme is steady.');
  });
});
