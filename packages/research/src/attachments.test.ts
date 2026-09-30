/**
 * askResearch attachments — pinned reports/conversations become the MAIN
 * FOCUS of the grounded prompt (the "attachment bar" contract).
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

function snapshot(): RepoSnapshot {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    markets: [],
    decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: now, lastRefreshedAt: now }],
    companies: [],
    metrics: [],
    cards: [],
    viceClaims: [],
    dashboards: {},
    companyMarket: {},
    opportunity: {},
    reports: [
      {
        id: 'rpt_a',
        kind: 'site_audit',
        subjectId: 'https://reka.ai',
        title: 'Reka — Site Audit',
        markdown: 'The landing page buries its value proposition below the fold.',
        citations: [],
        createdAt: now,
      },
    ],
    briefings: [],
    savedCards: [],
    researchJobs: [],
    threads: [
      {
        id: 'thr_prior',
        scope: { kind: 'deck', deckId: 'deck_1' },
        title: 'Conversion metrics dig',
        messages: [
          { id: 'm1', role: 'user', text: 'How do their conversion rates compare?', citations: [], at: now },
          { id: 'm2', role: 'assistant', text: 'Sources put trial-to-paid near 9%.', citations: [], at: now },
        ],
        reportId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  } as unknown as RepoSnapshot;
}

function memoryStore(initial: RepoSnapshot): ResearchStore {
  let data: RepoSnapshot | null = initial;
  return {
    read: () => data,
    write: (snap: RepoSnapshot) => {
      data = snap;
    },
  };
}

describe('askResearch — pinned attachments ground the conversation', () => {
  it('folds attached report + prior conversation into the prompt as the main focus', async () => {
    const ground = vi.fn().mockResolvedValue({ text: 'answer', citations: [], queries: [] });
    const repo = new GeminiRepository({
      apiKey: 'k',
      store: memoryStore(snapshot()),
      client: { ground, structure: vi.fn() } as unknown as LlmClient,
    });

    await repo.askResearch({
      scope: { kind: 'deck', deckId: 'deck_1' },
      question: 'Given the audit, what should they fix first?',
      attachments: { reportIds: ['rpt_a'], threadIds: ['thr_prior'] },
    });

    const prompt = ground.mock.calls[0]![0] as string;
    expect(prompt).toContain('ATTACHED REFERENCES');
    expect(prompt).toContain('Reka — Site Audit');
    expect(prompt).toContain('buries its value proposition');
    expect(prompt).toContain('Conversion metrics dig');
    expect(prompt).toContain('trial-to-paid near 9%');
  });

  it('unknown attachment ids are ignored, never crash', async () => {
    const ground = vi.fn().mockResolvedValue({ text: 'answer', citations: [], queries: [] });
    const repo = new GeminiRepository({
      apiKey: 'k',
      store: memoryStore(snapshot()),
      client: { ground, structure: vi.fn() } as unknown as LlmClient,
    });
    await repo.askResearch({
      scope: { kind: 'deck', deckId: 'deck_1' },
      question: 'q',
      attachments: { reportIds: ['nope'], threadIds: ['also-nope'] },
    });
    const prompt = ground.mock.calls[0]![0] as string;
    expect(prompt).not.toContain('ATTACHED REFERENCES');
  });

  it('includes source receipts when research is scoped to a market finding', async () => {
    const data = snapshot();
    data.cards.push({
      id: 'insight_1',
      deckId: 'deck_1',
      companyId: null,
      cardType: 'insight',
      title: 'Inference prices are falling',
      summary: 'Several providers lowered inference prices this quarter.',
      keyPoints: ['The change is concentrated in hosted models.'],
      citations: [
        {
          title: 'Provider pricing announcement',
          url: 'https://provider.example/pricing-update',
          credibility: 'primary',
        },
      ],
    } as unknown as RepoSnapshot['cards'][number]);
    const ground = vi.fn().mockResolvedValue({ text: 'answer', citations: [], queries: [] });
    const repo = new GeminiRepository({
      apiKey: 'k',
      store: memoryStore(data),
      client: { ground, structure: vi.fn() } as unknown as LlmClient,
    });

    await repo.askResearch({
      scope: { kind: 'cards', deckId: 'deck_1', cardIds: ['insight_1'], cardType: 'insight' },
      question: 'What evidence supports this trend?',
    });

    const prompt = ground.mock.calls[0]![0] as string;
    expect(prompt).toContain('Provider pricing announcement');
    expect(prompt).toContain('https://provider.example/pricing-update');
  });
});
