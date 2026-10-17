/**
 * The read-only snapshot a share link carries: stored research only, shaped for
 * the viewer, with nothing private and no research started to make it.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

const REUTERS = { title: 'Reuters', url: 'https://www.reuters.com/business/acme-2026' };
const NOW = new Date().toISOString();

function seed(): RepoSnapshot {
  const base = migrateSnapshot(null).snapshot;
  const company = (id: string, name: string) => ({ id, name, oneLiner: `${name} makes things.`, websiteUrl: `https://${id}.example`, logoUrl: null, hqLocation: null, brandTheme: null });
  const card = (id: string, companyId: string | null, type: string) => ({
    id, deckId: 'deck_1', companyId, cardType: type, tier: type === 'company' ? 3 : null, title: id, summary: 'A card.', keyPoints: ['One point'],
    citations: [REUTERS], createdAt: NOW, updatedAt: NOW, hunted: false,
  });
  return {
    ...base,
    markets: [{ id: 'mkt_1', name: 'Anvils', scopeDefinition: { vertical: 'Anvils' }, refreshCadence: 'weekly', createdAt: NOW }],
    decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: NOW, lastRefreshedAt: NOW }],
    companies: [company('cmp_a', 'Acme'), company('cmp_b', 'Beta')],
    cards: [card('card_a', 'cmp_a', 'company'), card('card_b', 'cmp_b', 'company'), card('card_v', null, 'vice')],
    metrics: [
      { id: 'm_a', companyId: 'cmp_a', metricType: 'revenue', value: 120, confidence: 'user_verified', source: REUTERS.url, citations: [REUTERS], methodNote: null, capturedAt: NOW },
      { id: 'm_b', companyId: 'cmp_b', metricType: 'revenue', value: 50, confidence: 'user_verified', source: REUTERS.url, citations: [REUTERS], methodNote: null, capturedAt: NOW },
    ],
    viceClaims: [{ id: 'vc_1', cardId: 'card_v', claimText: 'A sourced claim.', sourceUrl: REUTERS.url, sourceTitle: 'Reuters' }],
    dashboards: {
      cmp_a: {
        history: { content: { founderStory: 'Founded in a garage.', timeline: [{ date: '2012', title: 'Founded', detail: 'In Austin.' }], quotes: [] }, citations: [REUTERS], lastRefreshedAt: NOW },
        live_intel: { content: { items: [], lastRefreshedAt: NOW, cadence: 'weekly' }, citations: [REUTERS], lastRefreshedAt: NOW },
      },
      cmp_b: { history: { content: { founderStory: 'Beta story.', timeline: [], quotes: [] }, citations: [REUTERS], lastRefreshedAt: NOW } },
    },
    threads: [{ id: 'thr_1', title: 'private chat', messages: [] }],
    reports: [{ id: 'rpt_1', kind: 'company', subjectId: 'cmp_a', title: 'Private report', markdown: '', citations: [], createdAt: NOW }],
    researchEvidence: [{ id: 'ev_1', companyId: 'cmp_a', companyName: 'Acme', topic: 'overview', capturedAt: NOW, text: 'private evidence', citations: [REUTERS], queries: [] }],
  } as unknown as RepoSnapshot;
}

function repo() {
  const throwing = vi.fn(() => { throw new Error('a share must never call the model'); });
  const client = { ground: throwing, structure: throwing, generate: throwing } as unknown as LlmClient;
  let data = seed();
  const store: ResearchStore = { read: () => data, write: (s: RepoSnapshot) => { data = structuredClone(s); } };
  return { repository: new GeminiRepository({ apiKey: 'k', store, client, dashboardWarmup: false }), throwing };
}

describe('peekDashboardTab', () => {
  it('returns a stored tab as the dashboard shows it, without any model call', async () => {
    const { repository, throwing } = repo();
    const tab = await repository.peekDashboardTab!('cmp_a', 'history');
    expect(tab?.tab).toBe('history');
    expect((tab?.content as { founderStory: string }).founderStory).toBe('Founded in a garage.');
    expect(throwing).not.toHaveBeenCalled();
  });

  it('is null for a tab that was never researched, and never starts researching it', async () => {
    const { repository, throwing } = repo();
    expect(await repository.peekDashboardTab!('cmp_b', 'live_intel')).toBeNull();
    expect(await repository.peekDashboardTab!('cmp_b', 'team_org')).toBeNull();
    expect(await repository.peekDashboardTab!('cmp_unknown', 'history')).toBeNull();
    expect(throwing).not.toHaveBeenCalled();
  });

  it('does not read the private research tab', async () => {
    const { repository } = repo();
    expect(await repository.peekDashboardTab!('cmp_a', 'research')).toBeNull();
  });
});

describe('exportShareSnapshot', () => {
  it('packages one company card with only that company, its figures and its stored tabs', async () => {
    const { repository, throwing } = repo();
    const snapshot = await repository.exportShareSnapshot!({ deckId: 'deck_1', cardId: 'card_a' });
    expect(snapshot.kind).toBe('card');
    expect(snapshot.focusCardId).toBe('card_a');
    expect(snapshot.cards.map((c) => c.id)).toEqual(['card_a']);
    expect(snapshot.companies.map((c) => c.id)).toEqual(['cmp_a']);
    expect(snapshot.metrics.every((m) => m.companyId === 'cmp_a')).toBe(true);
    expect(Object.keys(snapshot.dashboards)).toEqual(['cmp_a']);
    expect(Object.keys(snapshot.dashboards.cmp_a!)).toEqual(expect.arrayContaining(['history', 'live_intel']));
    expect(throwing).not.toHaveBeenCalled();
  });

  it('packages a whole deck with every card, company and stored tab', async () => {
    const { repository } = repo();
    const snapshot = await repository.exportShareSnapshot!({ deckId: 'deck_1' });
    expect(snapshot.kind).toBe('deck');
    expect(snapshot.focusCardId).toBeNull();
    expect(snapshot.cards.map((c) => c.id).sort()).toEqual(['card_a', 'card_b', 'card_v']);
    expect(snapshot.companies.map((c) => c.id).sort()).toEqual(['cmp_a', 'cmp_b']);
    expect(snapshot.viceClaims.map((v) => v.id)).toEqual(['vc_1']);
    expect(snapshot.markets).toHaveLength(1);
  });

  it('carries a signal card (no company) without inventing a dashboard for it', async () => {
    const { repository } = repo();
    const snapshot = await repository.exportShareSnapshot!({ deckId: 'deck_1', cardId: 'card_v' });
    expect(snapshot.companies).toEqual([]);
    expect(snapshot.dashboards).toEqual({});
    expect(snapshot.viceClaims).toHaveLength(1);
  });

  it('never lends a signal card a company: no company, figures or tabs travel with it', async () => {
    const data = seed();
    // A facet card written for a company still carries its companyId.
    (data.cards.find((c) => c.id === 'card_v') as unknown as { companyId: string }).companyId = 'cmp_a';
    const store: ResearchStore = { read: () => data, write: () => undefined };
    const withFacet = new GeminiRepository({ apiKey: 'k', store, client: {} as unknown as LlmClient, dashboardWarmup: false });
    const snapshot = await withFacet.exportShareSnapshot!({ deckId: 'deck_1', cardId: 'card_v' });
    expect(snapshot.companies).toEqual([]);
    expect(snapshot.metrics).toEqual([]);
    expect(snapshot.dashboards).toEqual({});
  });

  it('carries the metrics tab, a free projection of the stored figures, without a model call', async () => {
    const { repository, throwing } = repo();
    const snapshot = await repository.exportShareSnapshot!({ deckId: 'deck_1', cardId: 'card_a' });
    expect(Object.keys(snapshot.dashboards.cmp_a!)).toContain('metrics');
    expect(throwing).not.toHaveBeenCalled();
  });

  it('leaves out a tab that was never researched instead of researching it', async () => {
    const { repository, throwing } = repo();
    const snapshot = await repository.exportShareSnapshot!({ deckId: 'deck_1', cardId: 'card_b' });
    // History was stored; metrics is a free projection; nothing else was researched, so nothing else is claimed.
    expect(Object.keys(snapshot.dashboards.cmp_b!).sort()).toEqual(['history', 'metrics']);
    expect(throwing).not.toHaveBeenCalled();
  });

  it('carries nothing private: no chats, reports or evidence vault', async () => {
    const { repository } = repo();
    const text = JSON.stringify(await repository.exportShareSnapshot!({ deckId: 'deck_1' }));
    expect(text).not.toContain('private chat');
    expect(text).not.toContain('Private report');
    expect(text).not.toContain('private evidence');
  });

  it('refuses a deck or card that is not there', async () => {
    const { repository } = repo();
    await expect(repository.exportShareSnapshot!({ deckId: 'nope' })).rejects.toThrow('Deck not found');
    await expect(repository.exportShareSnapshot!({ deckId: 'deck_1', cardId: 'nope' })).rejects.toThrow('Card not found');
  });
});
