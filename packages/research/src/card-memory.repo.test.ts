/**
 * Card memory: a card lists the conversations and reports that belong to it, with no migration for old data.
 * Fakes only; no live key.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

const NOW = new Date().toISOString();

function thread(id: string, scope: Record<string, unknown>, updatedAt: string, title = `Thread ${id}`) {
  return {
    id,
    scope,
    title,
    messages: [
      { id: `${id}_u`, role: 'user', text: `Question ${id}`, citations: [], at: updatedAt },
      { id: `${id}_a`, role: 'assistant', text: `Finding ${id}`, citations: [{ title: 'Src', url: `https://src.example/${id}` }], at: updatedAt },
    ],
    reportId: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

function seed(): RepoSnapshot {
  const base = migrateSnapshot(null).snapshot;
  const company = (id: string, name: string) => ({ id, name, oneLiner: `${name} makes things.`, websiteUrl: `https://${id}.example`, logoUrl: null, hqLocation: null, brandTheme: null });
  const card = (id: string, deckId: string, companyId: string | null, type: string, title: string) => ({
    id, deckId, companyId, cardType: type, tier: type === 'company' ? 3 : null, title, summary: 'A card.', keyPoints: [], citations: [], createdAt: NOW, updatedAt: NOW, hunted: false,
  });
  return {
    ...base,
    markets: [{ id: 'mkt_1', name: 'Anvils', scopeDefinition: { vertical: 'Anvils' }, refreshCadence: 'weekly', createdAt: NOW }],
    decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: NOW, lastRefreshedAt: NOW }],
    companies: [company('cmp_a', 'Acme'), company('cmp_b', 'Beta Corp')],
    cards: [
      card('card_a', 'deck_1', 'cmp_a', 'company', 'Acme'),
      card('card_b', 'deck_1', 'cmp_b', 'company', 'Beta Corp'),
      card('card_risk', 'deck_1', 'cmp_a', 'vice', 'Acme risk'),
    ],
    threads: [
      // Old shape: dashboard chat saved with no deck and no cardIds.
      thread('thr_old', { kind: 'company', deckId: null, companyId: 'cmp_a' }, '2026-01-02T00:00:00.000Z'),
      thread('thr_older', { kind: 'company', deckId: 'deck_1', companyId: 'cmp_a' }, '2026-01-01T00:00:00.000Z'),
      thread('thr_cards', { kind: 'cards', deckId: 'deck_1', cardIds: ['card_b'] }, '2026-01-03T00:00:00.000Z'),
      thread('thr_deck', { kind: 'deck', deckId: 'deck_1' }, '2026-01-04T00:00:00.000Z'),
    ],
  } as unknown as RepoSnapshot;
}

function repo() {
  const ground = vi.fn(async (_prompt: string, _opts?: { system?: string; label?: string }) => ({ text: 'Answer.\n\nFollow-ups: a | b', citations: [], queries: [] }));
  const structure = vi.fn();
  const client = { ground, structure } as unknown as LlmClient;
  let data = seed();
  const store: ResearchStore = { read: () => data, write: (s: RepoSnapshot) => { data = structuredClone(s); } };
  return { repository: new GeminiRepository({ apiKey: 'k', store, client, dashboardWarmup: false }), ground, structure, read: () => data };
}

describe('card memory: which conversations belong to a card', () => {
  it('shows an old company thread (deckId null, no cardIds) under its company card, newest first', async () => {
    const { repository } = repo();
    const memory = await repository.getCardMemory!('card_a');
    expect(memory.threads.map((t) => t.id)).toEqual(['thr_old', 'thr_older']);
    expect(memory.brief).toBeNull();
    const listed = await repository.listResearchThreads({ cardId: 'card_a' });
    expect(listed.map((t) => t.id)).toEqual(['thr_old', 'thr_older']);
  });

  it('shows a thread with explicit cardIds only under those cards', async () => {
    const { repository } = repo();
    expect((await repository.getCardMemory!('card_b')).threads.map((t) => t.id)).toEqual(['thr_cards']);
    expect((await repository.getCardMemory!('card_a')).threads.map((t) => t.id)).not.toContain('thr_cards');
    expect((await repository.listResearchThreads({ cardId: 'card_risk' })).map((t) => t.id)).toEqual([]);
  });

  it('keeps the deckId and companyId filters exactly as they were', async () => {
    const { repository } = repo();
    expect((await repository.listResearchThreads({ deckId: 'deck_1' })).map((t) => t.id)).toEqual(['thr_deck', 'thr_cards', 'thr_older']);
    expect((await repository.listResearchThreads({ companyId: 'cmp_a' })).map((t) => t.id)).toEqual(['thr_old', 'thr_older']);
    expect(await repository.listResearchThreads()).toHaveLength(4);
  });

  it('makes zero model calls when reading a card memory', async () => {
    const { repository, ground, structure } = repo();
    await repository.getCardMemory!('card_a');
    await repository.listResearchThreads({ cardId: 'card_a' });
    expect(ground).not.toHaveBeenCalled();
    expect(structure).not.toHaveBeenCalled();
  });

  it('stores scope.cardIds on a new thread', async () => {
    const { repository } = repo();
    const named = await repository.askResearch!({ question: 'Compare?', scope: { kind: 'cards', deckId: 'deck_1', cardIds: ['card_a', 'card_b'] } });
    expect(named.scope.cardIds).toEqual(['card_a', 'card_b']);
    const company = await repository.askResearch!({ question: 'How are they?', scope: { kind: 'company', deckId: null, companyId: 'cmp_b' } });
    expect(company.scope.cardIds).toEqual(['card_b']);
    const deck = await repository.askResearch!({ question: 'Who wins?', scope: { kind: 'deck', deckId: 'deck_1' } });
    expect(deck.scope.cardIds).toBeUndefined();
    expect((await repository.getCardMemory!('card_b')).threads.map((t) => t.id)).toContain(company.id);
  });
});

describe('card memory: reports', () => {
  it('stamps a report saved from a thread with its card, thread and focus kind', async () => {
    const { repository } = repo();
    const report = await repository.saveThreadAsReport!('thr_cards');
    expect(report.threadIds).toEqual(['thr_cards']);
    expect(report.focusKind).toBe('thread');
    expect(report.cardId).toBe('card_b');
    expect(report.deckId).toBe('deck_1');
    const memory = await repository.getCardMemory!('card_b');
    expect(memory.reports.map((r) => r.id)).toEqual([report.id]);
  });

  it('lists a company report under the company card when it has no cardId, newest first', async () => {
    const { repository, read } = repo();
    const old = { id: 'rpt_old', kind: 'company', subjectId: 'cmp_a', title: 'Old', markdown: '', citations: [], createdAt: '2026-01-01T00:00:00.000Z' };
    const newer = { id: 'rpt_new', kind: 'company', subjectId: 'cmp_a', title: 'New', markdown: '', citations: [], createdAt: '2026-02-01T00:00:00.000Z' };
    read().reports.push(old as never, newer as never);
    const memory = await repository.getCardMemory!('card_a');
    expect(memory.reports.map((r) => r.id)).toEqual(['rpt_new', 'rpt_old']);
    // A signal card does not inherit the company's reports.
    expect((await repository.getCardMemory!('card_risk')).reports).toEqual([]);
  });

  it('folds several threads, with their titles, into one report prompt', async () => {
    const { repository, ground } = repo();
    const report = await repository.generateReport({
      kind: 'company',
      subjectId: 'cmp_a',
      cardId: 'card_a',
      threadIds: ['thr_old', 'thr_older'],
    });
    const prompt = ground.mock.calls.map((c) => c[0]).join('\n');
    expect(prompt).toContain('Finding thr_old');
    expect(prompt).toContain('Finding thr_older');
    expect(prompt).toContain('Thread thr_old');
    expect(report.threadIds).toEqual(['thr_old', 'thr_older']);
    expect(report.cardId).toBe('card_a');
    // Several conversations is everything the card has, not one conversation.
    expect(report.focusKind).toBe('all');
  });

  it('still accepts a single threadId, and marks a report with no thread as all', async () => {
    const { repository, ground } = repo();
    const one = await repository.generateReport({ kind: 'company', subjectId: 'cmp_a', threadId: 'thr_old' });
    expect(ground.mock.calls.map((c) => c[0]).join('\n')).toContain('Finding thr_old');
    expect(one.threadIds).toEqual(['thr_old']);
    const none = await repository.generateReport({ kind: 'company', subjectId: 'cmp_a' });
    expect(none.focusKind).toBe('all');
    expect(none.threadIds).toEqual([]);
  });
});
