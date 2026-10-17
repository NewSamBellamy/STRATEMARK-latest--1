/**
 * The compare chat: the analyst is told which cards the user lined up, so the
 * answer is a head-to-head and not a generic reply to "compare these".
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot, type ResearchStore } from './repository';
import { CHAT_SYSTEM } from './prompts';
import type { LlmClient } from './types';

const NOW = new Date().toISOString();

function seed(): RepoSnapshot {
  const base = migrateSnapshot(null).snapshot;
  const company = (id: string, name: string) => ({ id, name, oneLiner: `${name} makes things.`, websiteUrl: `https://${id}.example`, logoUrl: null, hqLocation: null, brandTheme: null });
  const card = (id: string, companyId: string | null, type: string, title: string) => ({
    id, deckId: 'deck_1', companyId, cardType: type, tier: type === 'company' ? 3 : null, title, summary: 'A card.', keyPoints: [], citations: [], createdAt: NOW, updatedAt: NOW, hunted: false,
  });
  return {
    ...base,
    markets: [{ id: 'mkt_1', name: 'Anvils', scopeDefinition: { vertical: 'Anvils' }, refreshCadence: 'weekly', createdAt: NOW }],
    decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: NOW, lastRefreshedAt: NOW }],
    companies: [company('cmp_a', 'Acme'), company('cmp_b', 'Beta Corp')],
    cards: [card('card_a', 'cmp_a', 'company', 'Acme'), card('card_b', 'cmp_b', 'company', 'Beta Corp')],
  } as unknown as RepoSnapshot;
}

function repo() {
  const ground = vi.fn(async (_prompt: string, _opts?: { system?: string; label?: string }) => ({ text: 'Here is how they compare.\n\nFollow-ups: a | b', citations: [], queries: [] }));
  const client = { ground, structure: vi.fn() } as unknown as LlmClient;
  let data = seed();
  const store: ResearchStore = { read: () => data, write: (s: RepoSnapshot) => { data = structuredClone(s); } };
  return { repository: new GeminiRepository({ apiKey: 'k', store, client, dashboardWarmup: false }), ground };
}

describe('asking about cards the user lined up', () => {
  it('tells the analyst it is a head-to-head and names the companies', async () => {
    const { repository, ground } = repo();
    await repository.askResearch!({ question: 'Compare these head-to-head.', scope: { kind: 'cards', deckId: 'deck_1', cardIds: ['card_a', 'card_b'] } });
    const [prompt, opts] = ground.mock.calls[0]!;
    expect(prompt).toContain('THE USER LINED UP THESE CARDS TO COMPARE: Acme, Beta Corp');
    expect(prompt).toContain('head-to-head');
    expect(opts).toMatchObject({ system: CHAT_SYSTEM, label: 'chat' });
  });

  it('tells the analyst what "this" means when one card is in front of the user', async () => {
    const { repository, ground } = repo();
    await repository.askResearch!({ question: 'What stands out?', scope: { kind: 'cards', deckId: 'deck_1', cardIds: ['card_a'] } });
    expect(ground.mock.calls[0]![0]).toContain('THE USER HAS Acme IN FRONT OF THEM');
  });

  it('tells the analyst which company dashboard the user is on', async () => {
    const { repository, ground } = repo();
    await repository.askResearch!({ question: 'How are they doing?', scope: { kind: 'company', deckId: null, companyId: 'cmp_b' } });
    expect(ground.mock.calls[0]![0]).toContain("THE USER IS LOOKING AT Beta Corp'S DASHBOARD");
  });

  it('adds nothing for a whole-deck question', async () => {
    const { repository, ground } = repo();
    await repository.askResearch!({ question: 'Who is winning?', scope: { kind: 'deck', deckId: 'deck_1' } });
    expect(ground.mock.calls[0]![0]).not.toContain('THE USER LINED UP');
    expect(ground.mock.calls[0]![0]).not.toContain('IN FRONT OF THEM');
  });
});
