/**
 * "Save as report" from a conversation (the single-pass path): only the sourced answers are folded in, never the analyst's
 * own questions or unsourced turns, and a figure only a question contains is not stated. Fakes only; no live key.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

const NOW = new Date().toISOString();
const FOUND = { title: 'Bloomberg', url: 'https://www.bloomberg.com/acme' };

function setup() {
  const base = migrateSnapshot(null).snapshot;
  const data = {
    ...base,
    markets: [{ id: 'mkt_1', name: 'Anvils', scopeDefinition: { vertical: 'Anvils' }, refreshCadence: 'weekly', createdAt: NOW }],
    decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: NOW, lastRefreshedAt: NOW }],
    companies: [{ id: 'cmp_a', name: 'Acme', oneLiner: 'x', websiteUrl: 'https://a.example', logoUrl: null, hqLocation: null, brandTheme: null }],
    cards: [{ id: 'card_a', deckId: 'deck_1', companyId: 'cmp_a', cardType: 'company', tier: 3, title: 'Acme', summary: 'A card.', keyPoints: [], citations: [], createdAt: NOW, updatedAt: NOW, hunted: false }],
    threads: [{
      id: 'thr_1', scope: { kind: 'company', deckId: 'deck_1', companyId: 'cmp_a' }, title: 'Rumour', reportId: null, createdAt: NOW, updatedAt: NOW,
      messages: [
        { id: 'm1', role: 'user', text: 'Someone told me Acme raised $500M, is that right?', citations: [], at: NOW },
        { id: 'm2', role: 'assistant', text: 'Acme leads enterprise per Bloomberg.', citations: [FOUND], at: NOW },
        { id: 'm3', role: 'assistant', text: 'Unsourced rumour: Acme will merge.', citations: [], at: NOW },
      ],
    }],
  } as unknown as RepoSnapshot;
  const ground = vi.fn(async (_p: string, _o?: unknown) => ({ text: '## Executive summary\n\nAcme leads enterprise. Acme raised $500M last year.', citations: [FOUND], queries: [] }));
  let held = data;
  const store: ResearchStore = { read: () => held, write: (s: RepoSnapshot) => { held = structuredClone(s); } };
  const repo = new GeminiRepository({ apiKey: 'k', store, client: { ground, structure: vi.fn() } as unknown as LlmClient, dashboardWarmup: false });
  return { repo, ground };
}

describe('saveThreadAsReport (single-pass path)', () => {
  it('folds in only the sourced answers, not the questions or unsourced turns', async () => {
    const { repo, ground } = setup();
    await repo.saveThreadAsReport!('thr_1');
    const prompt = String(ground.mock.calls[0]![0]);
    expect(prompt).toContain('Acme leads enterprise per Bloomberg.');
    expect(prompt).not.toContain('Someone told me');
    expect(prompt).not.toContain('Unsourced rumour');
  });

  it('does not state a figure that only the analyst typed', async () => {
    const { repo } = setup();
    const report = await repo.saveThreadAsReport!('thr_1');
    expect(report.markdown).toContain('Acme leads enterprise');
    expect(report.markdown).not.toContain('$500M');
  });
});
