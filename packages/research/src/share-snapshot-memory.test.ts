/**
 * What a share carries about card memory: briefs (validated, sourced) and never conversations, distilled memory or the
 * evidence a chat answer wrote back. Fakes only; no live key.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

const NOW = new Date().toISOString();
const REUTERS = { title: 'Reuters', url: 'https://www.reuters.com/business/acme-2026' };
const cost = { estUsd: 0.05, calls: 2, searches: 1 };

function repo() {
  const base = migrateSnapshot(null).snapshot;
  const company = (id: string, name: string) => ({ id, name, oneLiner: `${name} makes things.`, websiteUrl: `https://${id}.example`, logoUrl: null, hqLocation: null, brandTheme: null });
  const card = (id: string, companyId: string | null, type: string) => ({
    id, deckId: 'deck_1', companyId, cardType: type, tier: type === 'company' ? 3 : null, title: id, summary: 'A card.', keyPoints: [], citations: [REUTERS], createdAt: NOW, updatedAt: NOW, hunted: false,
  });
  const good = { cardId: 'card_i', cardType: 'insight', builtAt: NOW, lead: 'A sourced lead.', points: [{ text: 'A sourced point about the market.', sources: [REUTERS] }], sources: [REUTERS], cost };
  const bad = { cardId: 'card_j', cardType: 'insight', builtAt: NOW, lead: 'FORGED-LEAD', points: [{ text: 'FORGED-POINT with no source at all.', sources: [] }], sources: [], cost };
  const data = {
    ...base,
    markets: [{ id: 'mkt_1', name: 'Anvils', scopeDefinition: { vertical: 'Anvils' }, refreshCadence: 'weekly', createdAt: NOW }],
    decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: NOW, lastRefreshedAt: NOW }],
    companies: [company('cmp_a', 'Acme')],
    cards: [card('card_a', 'cmp_a', 'company'), card('card_i', null, 'insight'), card('card_j', null, 'insight')],
    signalBriefs: { card_i: good, card_j: bad },
    threads: [{
      id: 'thr_1', scope: { kind: 'cards', deckId: 'deck_1', cardIds: ['card_a', 'card_i'] }, title: 'SECRET-THREAD-TITLE',
      messages: [{ id: 'm1', role: 'user', text: 'SECRET-THREAD-TEXT', citations: [], at: NOW }],
      semanticMemory: { distilledFacts: [{ fact: 'SECRET-DISTILLED-FACT' }] }, reportId: null, createdAt: NOW, updatedAt: NOW,
    }],
    researchEvidence: [{ id: 'ev_1', companyId: 'cmp_a', companyName: 'Acme', topic: 'chat:thr_1', capturedAt: NOW, text: 'SECRET-CHAT-EVIDENCE', citations: [REUTERS], queries: [] }],
  } as unknown as RepoSnapshot;
  let held = data;
  const throwing = vi.fn(() => { throw new Error('a share must never call the model'); });
  const store: ResearchStore = { read: () => held, write: (s: RepoSnapshot) => { held = structuredClone(s); } };
  return new GeminiRepository({ apiKey: 'k', store, client: { ground: throwing, structure: throwing, generate: throwing } as unknown as LlmClient, dashboardWarmup: false });
}

describe('a share and card memory', () => {
  it('carries a valid brief but no conversation, distilled memory or written-back evidence', async () => {
    const text = JSON.stringify(await repo().exportShareSnapshot!({ deckId: 'deck_1' }));
    expect(text).toContain('A sourced point about the market.');
    for (const secret of ['SECRET-THREAD-TITLE', 'SECRET-THREAD-TEXT', 'SECRET-DISTILLED-FACT', 'SECRET-CHAT-EVIDENCE']) expect(text).not.toContain(secret);
  });

  it('does not carry a stored brief that fails validation (a point with no source)', async () => {
    const text = JSON.stringify(await repo().exportShareSnapshot!({ deckId: 'deck_1' }));
    expect(text).not.toContain('FORGED');
  });
});
