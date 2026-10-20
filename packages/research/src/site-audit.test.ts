/**
 * auditSite — the landing-page teardown, and the deck-report baked gate.
 *
 * Contract under test:
 *   1. One grounded pass → a structured, clamped, junk-filtered audit report
 *      saved into the reports library as kind 'site_audit'.
 *   2. generateReport(kind='deck') is GATED while the deck still forms —
 *      it throws before spending a research call.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

function snapshot(opts?: { formingCard?: boolean }): RepoSnapshot {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    markets: [
      {
        id: 'mkt_1',
        name: 'Frontier AI',
        scopeDefinition: { vertical: 'AI', geography: 'Global', inclusions: [], exclusions: [] },
        refreshCadence: 'manual',
        createdAt: now,
      },
    ],
    decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: now, lastRefreshedAt: now }],
    companies: [
      {
        id: 'cmp_1',
        name: 'OpenAI',
        oneLiner: 'Frontier AI research and deployment company.',
        websiteUrl: 'https://openai.com',
        logoUrl: null,
        hqLocation: 'San Francisco, CA',
        brandTheme: null,
      },
    ],
    metrics: [],
    cards: [
      {
        id: 'card_1',
        deckId: 'deck_1',
        companyId: 'cmp_1',
        cardType: 'company',
        title: null,
        summary: null,
        tier: opts?.formingCard ? null : 8,
        tierReason: null,
        citations: [],
        keyPoints: [],
        createdAt: now,
      },
    ],
    viceClaims: [],
    dashboards: {},
    companyMarket: { cmp_1: 'Frontier AI' },
    opportunity: {},
    reports: [],
    briefings: [],
    savedCards: [],
    researchJobs: opts?.formingCard
      ? [
          {
            id: 'job_1',
            status: 'queued',
            stage: 'metrics',
            brief: { prompt: 'x', region: null },
            deck: { id: 'deck_1', marketId: 'mkt_1', createdAt: now, lastRefreshedAt: now },
            catalogNames: [],
            completedEntityNames: [],
            partialCards: [],
            warnings: [],
            error: null,
            createdAt: now,
            updatedAt: now,
          },
        ]
      : [],
    threads: [],
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

function repoWith(client: LlmClient, snap = snapshot()): GeminiRepository {
  return new GeminiRepository({ apiKey: 'k', store: memoryStore(snap), client });
}

describe('auditSite — the landing-page teardown', () => {
  it('composes a structured audit report: clamped scores, computed overall, junk filtered', async () => {
    const ground = vi.fn().mockResolvedValue({
      text: 'audit notes',
      citations: [
        { title: 'openai.com', url: 'https://openai.com' },
        { title: 'fatjoe.com', url: 'https://fatjoe.com/seo-blog/openai' }, // junk → dropped
      ],
      queries: [],
    });
    const structure = vi.fn().mockResolvedValue({
      scores: [
        { area: 'value_proposition', score: 14, verdict: 'Clear promise.' }, // clamps to 10
        { area: 'trust', score: 0, verdict: 'Thin proof.' }, // clamps to 1
      ],
      working: [{ title: 'Headline', detail: 'Concrete and specific.' }],
      missing: [{ title: 'Social proof', detail: 'No customer logos.', impact: 'Lower trust at decision time.' }],
      designSummary: 'Minimal, typographic, research-lab register.',
      designNotes: ['Monochrome palette', 'Generous whitespace'],
      testFirst: [{ title: 'Add proof band', detail: 'Logos above the fold should lift conversions.' }],
    });
    const repo = repoWith({ ground, structure } as unknown as LlmClient);

    const report = await repo.auditSite({ url: 'openai.com', companyId: 'cmp_1' });

    expect(ground).toHaveBeenCalledTimes(1);
    expect(report.kind).toBe('site_audit');
    expect(report.audit!.url).toBe('https://openai.com'); // protocol added
    expect(report.audit!.scores[0]!.score).toBe(10);
    expect(report.audit!.scores[1]!.score).toBe(1);
    expect(report.audit!.overall).toBe(Math.round(((10 + 1) / 2) * 10)); // 55
    expect(report.audit!.missing[0]!.impact).toContain('trust');
    expect(report.citations).toHaveLength(1); // junk domain filtered
    expect(report.markdown).toContain("## What's missing");

    // Saved into the library.
    const listed = await repo.listReports();
    expect(listed[0]!.id).toBe(report.id);
  });
});

describe('generateReport — deck reports gate on a baked deck', () => {
  it('throws before any research call while the deck still forms', async () => {
    const ground = vi.fn();
    const structure = vi.fn();
    const repo = repoWith(
      { ground, structure } as unknown as LlmClient,
      snapshot({ formingCard: true }),
    );

    await expect(repo.generateReport({ kind: 'deck', subjectId: 'deck_1' })).rejects.toThrow(
      /still forming/,
    );
    expect(ground).not.toHaveBeenCalled();
  });

  it('does not make a report written from a conversation wait for the deck, and digests only cards that have formed', async () => {
    const ground = vi.fn().mockResolvedValue({
      text: '## Executive summary\nFrom the conversation.',
      citations: [{ title: 'Reuters', url: 'https://reuters.com/x' }],
      queries: [],
    });
    const structure = vi.fn();
    const snap = snapshot({ formingCard: true });
    snap.threads = [{
      id: 'thr_1', scope: { kind: 'deck', deckId: 'deck_1' }, title: 'Who is winning', createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), reportId: null,
      messages: [
        { id: 'm1', role: 'user', text: 'Who is winning?', citations: [], createdAt: new Date().toISOString() },
        { id: 'm2', role: 'assistant', text: 'OpenAI leads on distribution.', citations: [], createdAt: new Date().toISOString() },
      ],
    }] as unknown as RepoSnapshot['threads'];
    const repo = repoWith({ ground, structure } as unknown as LlmClient, snap);

    const report = await repo.saveThreadAsReport('thr_1', null);

    expect(report.kind).toBe('deck');
    // Every call that reached the model: the digest names the formed company and leaves out the one still forming.
    const prompts = ground.mock.calls.map((call) => String(call[0])).join('\n');
    expect(prompts).toContain('OpenAI');
    expect(prompts).toContain('OpenAI leads on distribution.');
    expect(prompts).not.toMatch(/COMPANY \[tier \?\] Anthropic/);
    // The same deck, asked for without a conversation, still waits.
    await expect(repo.generateReport({ kind: 'deck', subjectId: 'deck_1' })).rejects.toThrow(/still forming/);
  });

  it('composes normally once the deck is baked', async () => {
    const ground = vi.fn().mockResolvedValue({
      text: '## Executive summary\nAll good.',
      citations: [{ title: 'Reuters', url: 'https://reuters.com/x' }],
      queries: [],
    });
    const structure = vi.fn();
    const repo = repoWith({ ground, structure } as unknown as LlmClient);

    const report = await repo.generateReport({ kind: 'deck', subjectId: 'deck_1' });
    expect(report.kind).toBe('deck');
    expect(ground).toHaveBeenCalledTimes(1);
  });
});
